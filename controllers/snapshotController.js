const express = require('express');
const router = express.Router();
const CompressionUtils = require('../compression');
const { logger } = require('../logger');
const { JSDOM, VirtualConsole } = require('jsdom');

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
  
  logger.info('📥 Received snapshot request:', {
    id: snapshotId,
    htmlLength: html.length,
    cssLength: css ? css.length : 0,
    options: options || {}
  });

  // DEBUGGING: Log the actual HTML and CSS content being captured
  console.log('🧪 DEBUG: First 1000 chars of HTML:', html.substring(0, 1000));
  console.log('🧪 DEBUG: First 500 chars of CSS:', css ? css.substring(0, 500) : 'No CSS provided');
  
  try {
    // DEBUGGING: Skip compression and save raw HTML/CSS to isolate compression issues
    logger.info('🧪 DEBUGGING MODE: Saving raw uncompressed HTML/CSS to test rendering');
    
    // Prepare data for database (raw uncompressed content)
    const snapshotData = {
      id: snapshotId,
      html: html, // Store raw HTML for debugging
      css: css,   // Store raw CSS for debugging
      url: options?.url,
      viewport: options?.viewport,
      options: options,
      htmlCompressed: null, // Skip compression for debugging
      cssCompressed: null,  // Skip compression for debugging
      compressionType: 'none',
      originalHtmlSize: html.length,
      originalCssSize: css ? css.length : 0,
      compressedHtmlSize: 0, // No compression
      compressedCssSize: 0,  // No compression
      processingStatus: 'queued'
    };

    // Save to database
    await db.saveSnapshot(snapshotData);

    // Add job to queue
    const queueJob = await snapshotQueue.addSnapshotJob({
      snapshotId,
      metadata: {
        url: options?.url,
        viewport: options?.viewport,
        compressionType: 'none',
        rawDebugMode: true,
        htmlSize: html.length,
        cssSize: css ? css.length : 0
      }
    });

    // Update snapshot with job ID
    await db.updateSnapshotJobId(snapshotId, queueJob.jobId);

    logger.info('✅ Snapshot saved raw (uncompressed) and queued:', {
      id: snapshotId,
      jobId: queueJob.jobId,
      htmlSize: html.length,
      cssSize: css ? css.length : 0
    });

    res.json({
      success: true,
      message: 'Snapshot saved raw (uncompressed) and queued for processing',
      id: snapshotId,
      jobId: queueJob.jobId,
      queuePosition: queueJob.queuePosition,
      compressionStats: {
        totalOriginalSize: html.length + (css ? css.length : 0),
        totalCompressedSize: html.length + (css ? css.length : 0),
        overallCompressionRatio: 0.0, // No compression for debugging
        compressionTimeMs: 0
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    logger.error('❌ Error processing snapshot:', error);
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
    logger.error('Error retrieving snapshots:', error);
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

    // Decompress if needed for API response, otherwise use raw data
    let responseSnapshot = snapshot;
    if (snapshot.html_compressed || snapshot.css_compressed) {
      logger.info('🗜️ Decompressing snapshot for API response:', snapshot.id);
      responseSnapshot = await CompressionUtils.decompressSnapshot(snapshot);
    } else {
      logger.info('🧪 DEBUG MODE: Returning raw uncompressed snapshot data:', snapshot.id);
    }

    res.json({
      success: true,
      snapshot: responseSnapshot
    });
  } catch (error) {
    logger.error('Error retrieving snapshot:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve snapshot'
    });
  }
});


// POST /snapshots/:id/screenshot - Take screenshot of rendered snapshot
router.post('/snapshots/:id/screenshot', async (req, res) => {
  try {
    const snapshotId = req.params.id;
    const options = req.body || {};

    logger.info(`📸 Screenshot request for snapshot ${snapshotId}`);

    const result = await browserService.takeSnapshotScreenshot(snapshotId, options);

    res.json({
      success: true,
      message: 'Screenshot captured successfully',
      result
    });

  } catch (error) {
    logger.error('Error taking screenshot:', error);
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
    logger.error('Error retrieving screenshot:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve screenshot'
    });
  }
});

// GET /render/:id - Render snapshot as HTML for live DOM viewing
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

    // Use raw snapshot data directly (no decompression needed in debug mode)
    let decompressedSnapshot = snapshot;
    if (snapshot.html_compressed || snapshot.css_compressed) {
      logger.info('🗜️ Decompressing snapshot for DOM viewing:', snapshot.id);
      decompressedSnapshot = await CompressionUtils.decompressSnapshot(snapshot);
    } else {
      logger.info('🧪 DEBUG MODE: Using raw uncompressed HTML/CSS for DOM viewing:', snapshot.id);
    }

    // Check if DOM data exists
    if (!decompressedSnapshot.html) {
      return res.status(410).send('DOM data not available');
    }

    // DEBUGGING: Serve the absolute RAW HTML with minimal modification
    logger.info('🧪 DEBUG: Serving completely raw HTML for DOM debugging');
    
    // Debug what we're actually serving
    console.log('🧪 DEBUG: HTML length from DB:', decompressedSnapshot.html?.length || 0);
    console.log('🧪 DEBUG: CSS length from DB:', decompressedSnapshot.css?.length || 0);
    console.log('🧪 DEBUG: First 500 chars of HTML from DB:', decompressedSnapshot.html?.substring(0, 500) || 'NO HTML');
    console.log('🧪 DEBUG: First 300 chars of CSS from DB:', decompressedSnapshot.css?.substring(0, 300) || 'NO CSS');
    
    // Just add the CSS inline to the original HTML - no other modifications
    let rawHtml = decompressedSnapshot.html;
    
    // If there's CSS, try to inject it into the head
    if (decompressedSnapshot.css) {
      const cssStyleTag = `<style type="text/css">\n${decompressedSnapshot.css}\n</style>`;
      
      // Try to inject CSS into existing head
      if (rawHtml.includes('</head>')) {
        rawHtml = rawHtml.replace('</head>', `${cssStyleTag}\n</head>`);
      } else if (rawHtml.includes('<head>')) {
        rawHtml = rawHtml.replace('<head>', `<head>\n${cssStyleTag}`);
      } else {
        // No head tag, add CSS at the beginning
        rawHtml = `<style>${decompressedSnapshot.css}</style>\n${rawHtml}`;
      }
    }

    const domViewHtml = rawHtml;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.send(domViewHtml);
    
  } catch (error) {
    logger.error('Error rendering snapshot:', error);
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

// GET /debug/:id/raw - Debug endpoint to show raw HTML as text
router.get('/debug/:id/raw', async (req, res) => {
  try {
    const snapshot = await db.getSnapshot(req.params.id);
    
    if (!snapshot) {
      return res.status(404).send('Snapshot not found');
    }

    let decompressedSnapshot = snapshot;
    if (snapshot.html_compressed || snapshot.css_compressed) {
      decompressedSnapshot = await CompressionUtils.decompressSnapshot(snapshot);
    }

    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.send(`=== RAW HTML DEBUG ===\n\nHTML LENGTH: ${decompressedSnapshot.html?.length || 0}\nCSS LENGTH: ${decompressedSnapshot.css?.length || 0}\n\n=== FIRST 2000 CHARS OF HTML ===\n${decompressedSnapshot.html?.substring(0, 2000) || 'NO HTML'}\n\n=== FIRST 1000 CHARS OF CSS ===\n${decompressedSnapshot.css?.substring(0, 1000) || 'NO CSS'}`);
  } catch (error) {
    res.status(500).send(`Error: ${error.message}`);
  }
});

// GET /debug/:id/html - Debug endpoint to check HTML content
router.get('/debug/:id/html', async (req, res) => {
  try {
    const snapshot = await db.getSnapshot(req.params.id);
    
    if (!snapshot) {
      return res.status(404).json({
        success: false,
        error: 'Snapshot not found'
      });
    }

    // Use raw data or decompress snapshot if compressed
    let decompressedSnapshot = snapshot;
    if (snapshot.html_compressed || snapshot.css_compressed) {
      logger.info('🗜️ Decompressing snapshot for debug:', snapshot.id);
      decompressedSnapshot = await CompressionUtils.decompressSnapshot(snapshot);
    } else {
      logger.info('🧪 DEBUG MODE: Using raw uncompressed data for debug:', snapshot.id);
    }

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('X-Debug', 'true');
    
    const debugHtml = `<!DOCTYPE html>
<html>
<head>
  <title>Debug - ${snapshot.id}</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 20px; background: white; }
    .debug-info { background: #f0f0f0; padding: 20px; margin-bottom: 20px; border-radius: 8px; }
    .content-preview { background: #e0e0e0; padding: 15px; margin: 10px 0; border-radius: 4px; }
    pre { white-space: pre-wrap; overflow-wrap: break-word; }
  </style>
</head>
<body>
  <div class="debug-info">
    <h1>🔍 Snapshot Debug Information</h1>
    <p><strong>ID:</strong> ${snapshot.id}</p>
    <p><strong>URL:</strong> ${snapshot.url || 'Not available'}</p>
    <p><strong>Created:</strong> ${snapshot.created_at}</p>
    <p><strong>Has HTML:</strong> ${!!decompressedSnapshot.html}</p>
    <p><strong>Has CSS:</strong> ${!!decompressedSnapshot.css}</p>
    <p><strong>HTML Length:</strong> ${decompressedSnapshot.html?.length || 0}</p>
    <p><strong>CSS Length:</strong> ${decompressedSnapshot.css?.length || 0}</p>
  </div>
  
  <div class="content-preview">
    <h3>HTML Preview (first 2000 chars):</h3>
    <pre>${decompressedSnapshot.html?.substring(0, 2000) || 'No HTML content'}</pre>
  </div>
  
  <div class="content-preview">
    <h3>CSS Preview (first 1000 chars):</h3>
    <pre>${decompressedSnapshot.css?.substring(0, 1000) || 'No CSS content'}</pre>
  </div>
</body>
</html>`;

    res.send(debugHtml);
    
  } catch (error) {
    logger.error('Error in debug endpoint:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve debug information',
      message: error.message
    });
  }
});

// DELETE /snapshots - Delete all snapshots
router.delete('/snapshots', async (req, res) => {
  try {
    logger.info('🗑️ Deleting all snapshots from database');
    const result = await db.deleteAllSnapshots();
    
    res.json({
      success: true,
      message: 'All snapshots deleted successfully',
      deletedCount: result.changes,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Error deleting all snapshots:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete all snapshots',
      message: error.message
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
    logger.error('Error getting browser stats:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get browser statistics'
    });
  }
});

module.exports = router;