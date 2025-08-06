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

  try {
    // Prepare data for database (raw content only)
    const snapshotData = {
      id: snapshotId,
      html: html,
      css: css,
      url: options?.url,
      viewport: options?.viewport,
      options: options,
      htmlCompressed: null,
      cssCompressed: null,
      compressionType: 'none',
      originalHtmlSize: html.length,
      originalCssSize: css ? css.length : 0,
      compressedHtmlSize: 0,
      compressedCssSize: 0,
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
        htmlSize: html.length,
        cssSize: css ? css.length : 0
      }
    });

    // Update snapshot with job ID
    await db.updateSnapshotJobId(snapshotId, queueJob.jobId);

    logger.info('✅ Snapshot saved and queued:', {
      id: snapshotId,
      jobId: queueJob.jobId,
      htmlSize: html.length,
      cssSize: css ? css.length : 0
    });

    res.json({
      success: true,
      message: 'Snapshot saved and queued for processing',
      id: snapshotId,
      jobId: queueJob.jobId,
      queuePosition: queueJob.queuePosition,
      size: {
        htmlSize: html.length,
        cssSize: css ? css.length : 0,
        totalSize: html.length + (css ? css.length : 0)
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

    // Use raw snapshot data directly
    let decompressedSnapshot = snapshot;

    // Check if DOM data exists
    if (!decompressedSnapshot.html) {
      return res.status(410).send('DOM data not available');
    }

    // Serve the raw HTML content with FullStory-style security headers
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    
    // FullStory-style CSP: Block all scripts and API requests, allow styles/images
    res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline' https:; img-src 'self' data: blob: https:; font-src 'self' data: https:; connect-src 'none'; script-src 'none'; object-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none';");
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    
    res.send(decompressedSnapshot.html);
    
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