const express = require('express');
const router = express.Router();
const CompressionUtils = require('../compression');

// Snapshot controller will receive dependencies via middleware
let db, snapshotQueue, browserService;

// Middleware to inject dependencies
router.use((req, res, next) => {
  db = req.app.locals.db;
  snapshotQueue = req.app.locals.snapshotQueue;
  browserService = req.app.locals.browserService;
  next();
});

// POST /snapshot - Create new snapshot
router.post('/snapshot', async (req, res) => {
  const { html, css, options } = req.body;
  
  if (!html) {
    return res.status(400).json({ error: 'HTML content is required' });
  }
  
  const snapshotId = `snapshot_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  
  console.log('📥 Received snapshot request:', {
    id: snapshotId,
    htmlLength: html.length,
    cssLength: css ? css.length : 0,
    options: options || {}
  });
  
  try {
    // Compress the snapshot data
    const compressionType = process.env.COMPRESSION_TYPE || 'brotli';
    console.log('🗜️ Compressing snapshot with', compressionType);
    
    const compressedSnapshot = await CompressionUtils.compressSnapshot({
      id: snapshotId,
      html,
      css,
      url: options?.url,
      viewport: options?.viewport,
      options: options
    }, compressionType);

    // Prepare data for database (with compressed versions)
    const snapshotData = {
      id: snapshotId,
      html: null, // Don't store uncompressed HTML to save space
      css: null,  // Don't store uncompressed CSS to save space
      url: options?.url,
      viewport: options?.viewport,
      options: options,
      htmlCompressed: compressedSnapshot.htmlCompressed,
      cssCompressed: compressedSnapshot.cssCompressed,
      compressionType,
      originalHtmlSize: compressedSnapshot.originalHtmlSize,
      originalCssSize: compressedSnapshot.originalCssSize,
      compressedHtmlSize: compressedSnapshot.compressedHtmlSize,
      compressedCssSize: compressedSnapshot.compressedCssSize,
      processingStatus: 'queued'
    };

    // Add job to queue
    const queueJob = await snapshotQueue.addSnapshotJob({
      snapshotId,
      metadata: {
        url: options?.url,
        viewport: options?.viewport,
        compressionType,
        compressionStats: compressedSnapshot.compressionStats
      }
    });

    // Update snapshot with job ID
    snapshotData.queueJobId = queueJob.jobId;

    // Save to database
    await db.saveSnapshot(snapshotData);

    console.log('✅ Snapshot compressed, saved, and queued:', {
      id: snapshotId,
      jobId: queueJob.jobId,
      compressionStats: compressedSnapshot.compressionStats
    });

    res.json({
      success: true,
      message: 'Snapshot compressed, saved, and queued for processing',
      id: snapshotId,
      jobId: queueJob.jobId,
      queuePosition: queueJob.queuePosition,
      compressionStats: compressedSnapshot.compressionStats,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Error processing snapshot:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to process snapshot',
      message: error.message
    });
  }
});

// GET /snapshots - Get all snapshots
router.get('/snapshots', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const snapshots = await db.getRecentSnapshots(limit);
    res.json({
      success: true,
      snapshots,
      count: snapshots.length
    });
  } catch (error) {
    console.error('Error retrieving snapshots:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve snapshots'
    });
  }
});

// GET /snapshots/:id - Get specific snapshot
router.get('/snapshots/:id', async (req, res) => {
  try {
    const snapshot = await db.getSnapshot(req.params.id);
    
    if (!snapshot) {
      return res.status(404).json({
        success: false,
        error: 'Snapshot not found'
      });
    }

    // Decompress if needed for API response
    let responseSnapshot = snapshot;
    if (snapshot.html_compressed || snapshot.css_compressed) {
      console.log('🗜️ Decompressing snapshot for API response:', snapshot.id);
      responseSnapshot = await CompressionUtils.decompressSnapshot(snapshot);
    }

    res.json({
      success: true,
      snapshot: responseSnapshot
    });
  } catch (error) {
    console.error('Error retrieving snapshot:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve snapshot'
    });
  }
});

// GET /render/:id - Render snapshot as HTML for legal evidence viewing
router.get('/render/:id', async (req, res) => {
  try {
    const snapshot = await db.getSnapshot(req.params.id);
    
    if (!snapshot) {
      return res.status(404).send(`
        <!DOCTYPE html>
        <html>
        <head><title>Snapshot Not Found</title></head>
        <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
          <h1>⚠️ Snapshot Not Found</h1>
          <p>The requested snapshot ID "${req.params.id}" could not be found.</p>
          <a href="/dashboard">← Back to Dashboard</a>
        </body>
        </html>
      `);
    }

    // Decompress snapshot if it's compressed
    let decompressedSnapshot = snapshot;
    if (snapshot.html_compressed || snapshot.css_compressed) {
      console.log('🗜️ Decompressing snapshot for rendering:', snapshot.id);
      decompressedSnapshot = await CompressionUtils.decompressSnapshot(snapshot);
    }

    // Parse the original HTML to extract head and body content
    const DOMParser = require('jsdom').JSDOM;
    let originalDoc;
    
    try {
      const dom = new DOMParser(decompressedSnapshot.html);
      originalDoc = dom.window.document;
    } catch (e) {
      console.error('Error parsing HTML with JSDOM:', e);
      // Fallback to simple parsing
      originalDoc = null;
    }

    // Extract existing head content and body content
    let existingHead = '';
    let bodyContent = decompressedSnapshot.html;

    if (originalDoc) {
      existingHead = originalDoc.head ? originalDoc.head.innerHTML : '';
      bodyContent = originalDoc.body ? originalDoc.body.outerHTML : decompressedSnapshot.html;
    }

    // Create the complete legal evidence HTML
    const legalSnapshotHtml = `<!DOCTYPE html>
<html lang="en" data-legal-snapshot="${snapshot.id}" data-capture-time="${snapshot.created_at}">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=${snapshot.viewport_width || 1920}, initial-scale=1.0">
    <meta name="legal-evidence" content="true">
    <meta name="snapshot-id" content="${snapshot.id}">
    <meta name="capture-timestamp" content="${snapshot.created_at}">
    <meta name="capture-url" content="${snapshot.url || 'unknown'}">
    <meta name="viewport-size" content="${snapshot.viewport_width || 1920}x${snapshot.viewport_height || 1080}">
    
    <!-- Original head content preserved -->
    ${existingHead}
    
    <!-- Legal Evidence CSS Injection -->
    <style type="text/css" data-legal-snapshot-styles="true">
/* ========================================= */
/* LEGAL EVIDENCE - CAPTURED CSS STYLES     */  
/* Snapshot ID: ${snapshot.id} */
/* Captured: ${snapshot.created_at} */
/* ========================================= */

${decompressedSnapshot.css || '/* No CSS styles were captured */'}

/* ========================================= */
/* CRITICAL: Legal Evidence Viewport Setup  */
/* ========================================= */
html {
    width: ${snapshot.viewport_width || 1920}px !important;
    min-height: ${snapshot.viewport_height || 1080}px !important;
    overflow-x: auto !important;
    overflow-y: auto !important;
    margin: 0 !important;
    padding: 0 !important;
}

body {
    margin: 0 !important;
    padding: 0 !important;
    min-width: ${snapshot.viewport_width || 1920}px !important;
    min-height: ${snapshot.viewport_height || 1080}px !important;
    box-sizing: border-box !important;
}

/* Prevent any layout shifts */
*, *::before, *::after {
    box-sizing: border-box !important;
}

/* Legal watermark styling */
#legal-evidence-watermark {
    position: fixed !important;
    top: 10px !important;
    right: 10px !important;
    background: rgba(255, 193, 7, 0.95) !important;
    color: #856404 !important;
    padding: 8px 12px !important;
    border-radius: 4px !important;
    font-family: 'Courier New', monospace !important;
    font-size: 11px !important;
    font-weight: bold !important;
    z-index: 999999 !important;
    pointer-events: none !important;
    box-shadow: 0 2px 8px rgba(0,0,0,0.3) !important;
    border: 1px solid #ffc107 !important;
}
    </style>
    
    <title>Legal Evidence - ${snapshot.id} - ${new Date(snapshot.created_at).toLocaleDateString()}</title>
</head>

${bodyContent || '<body><h1>No content available</h1><p>The snapshot HTML content could not be rendered.</p></body>'}

<!-- Legal Evidence Watermark -->
<div id="legal-evidence-watermark">
    ⚖️ LEGAL EVIDENCE<br>
    ID: ${snapshot.id.substring(0, 12)}...<br>
    Date: ${new Date(snapshot.created_at).toLocaleDateString()}<br>
    Time: ${new Date(snapshot.created_at).toLocaleTimeString()}
</div>

<!-- Legal Evidence Script -->
<script>
(function() {
    'use strict';
    
    // Legal evidence metadata
    window.LEGAL_EVIDENCE = {
        id: '${snapshot.id}',
        capturedAt: '${snapshot.created_at}',
        capturedUrl: '${snapshot.url || 'unknown'}',
        viewport: {
            width: ${snapshot.viewport_width || 1920},
            height: ${snapshot.viewport_height || 1080}
        },
        htmlSize: ${snapshot.original_html_size || 0},
        cssSize: ${snapshot.original_css_size || 0},
        renderedAt: '${new Date().toISOString()}'
    };
    
    console.log('🏛️ Legal Evidence Snapshot Rendered:', window.LEGAL_EVIDENCE);
    
    // Prevent any modifications to the DOM after rendering
    document.addEventListener('DOMContentLoaded', function() {
        console.log('✅ Legal evidence DOM ready - viewport:', window.innerWidth + 'x' + window.innerHeight);
        
        // Mark document as legally preserved
        document.documentElement.setAttribute('data-legal-status', 'preserved');
        document.documentElement.setAttribute('data-render-timestamp', new Date().toISOString());
        
        // Log viewport accuracy
        const expectedWidth = ${snapshot.viewport_width || 1920};
        const expectedHeight = ${snapshot.viewport_height || 1080};
        const actualWidth = window.innerWidth;
        const actualHeight = window.innerHeight;
        
        if (actualWidth !== expectedWidth || actualHeight !== expectedHeight) {
            console.warn('⚠️ Viewport mismatch - Expected: ' + expectedWidth + 'x' + expectedHeight + ', Actual: ' + actualWidth + 'x' + actualHeight);
        } else {
            console.log('✅ Viewport match confirmed - Legal accuracy maintained');
        }
    });
    
    // Disable context menu and right-click for evidence protection
    document.addEventListener('contextmenu', function(e) {
        e.preventDefault();
        console.log('Context menu disabled for legal evidence protection');
    });
})();
</script>

<!-- Legal Metadata Footer (Hidden) -->
<div style="display: none;" id="legal-metadata">
    <h3>Legal Evidence Metadata</h3>
    <table>
        <tr><td>Snapshot ID:</td><td>${snapshot.id}</td></tr>
        <tr><td>Captured URL:</td><td>${snapshot.url || 'Not available'}</td></tr>
        <tr><td>Capture Timestamp:</td><td>${snapshot.created_at}</td></tr>
        <tr><td>Viewport Dimensions:</td><td>${snapshot.viewport_width || 1920}x${snapshot.viewport_height || 1080}px</td></tr>
        <tr><td>HTML Content Size:</td><td>${snapshot.original_html_size || 0} characters</td></tr>
        <tr><td>CSS Styles Size:</td><td>${snapshot.original_css_size || 0} characters</td></tr>
        <tr><td>Rendered Timestamp:</td><td>${new Date().toISOString()}</td></tr>
    </table>
</div>

</html>`;

    // Set appropriate headers for legal evidence
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('X-Legal-Evidence', 'true');
    res.setHeader('X-Snapshot-ID', snapshot.id);
    res.setHeader('X-Capture-Timestamp', snapshot.created_at);
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    
    res.send(legalSnapshotHtml);
    
  } catch (error) {
    console.error('Error rendering snapshot:', error);
    res.status(500).send(`
      <!DOCTYPE html>
      <html>
      <head><title>Rendering Error</title></head>
      <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
        <h1>❌ Rendering Error</h1>
        <p>An error occurred while rendering the snapshot: ${error.message}</p>
        <a href="/dashboard">← Back to Dashboard</a>
      </body>
      </html>
    `);
  }
});

// POST /snapshots/:id/screenshot - Take screenshot of rendered snapshot
router.post('/snapshots/:id/screenshot', async (req, res) => {
  try {
    const snapshotId = req.params.id;
    const options = req.body || {};

    console.log(`📸 Screenshot request for snapshot ${snapshotId}`);

    const result = await browserService.takeSnapshotScreenshot(snapshotId, options);

    res.json({
      success: true,
      message: 'Screenshot captured successfully',
      result
    });

  } catch (error) {
    console.error('Error taking screenshot:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to capture screenshot',
      message: error.message
    });
  }
});

// GET /snapshots/:id/screenshot - Get screenshot of snapshot
router.get('/snapshots/:id/screenshot', async (req, res) => {
  try {
    const snapshotId = req.params.id;
    const screenshot = await browserService.getScreenshot(snapshotId);
    
    if (!screenshot || !screenshot.screenshot) {
      return res.status(404).json({
        success: false,
        error: 'Screenshot not found'
      });
    }

    // Set appropriate headers for image response
    res.setHeader('Content-Type', `image/${screenshot.screenshot_format || 'webp'}`);
    res.setHeader('Content-Length', screenshot.screenshot_size);
    res.setHeader('Cache-Control', 'public, max-age=31536000'); // 1 year cache
    res.setHeader('X-Screenshot-Width', screenshot.screenshot_width);
    res.setHeader('X-Screenshot-Height', screenshot.screenshot_height);
    res.setHeader('X-Screenshot-Taken-At', screenshot.screenshot_taken_at);

    res.send(screenshot.screenshot);

  } catch (error) {
    console.error('Error retrieving screenshot:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve screenshot'
    });
  }
});

// GET /browser/stats - Get browser pool statistics
router.get('/browser/stats', (req, res) => {
  try {
    const stats = browserService.getPoolStats();
    res.json({
      success: true,
      browserPool: stats
    });
  } catch (error) {
    console.error('Error getting browser stats:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get browser statistics'
    });
  }
});

module.exports = router;