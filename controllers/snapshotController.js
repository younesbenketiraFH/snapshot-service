const express = require('express');
const router = express.Router();
const { logger } = require('../logger');

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
  const { html, options } = req.body;
  
  if (!html) {
    return res.status(400).json(false);
  }
  
  const snapshotId = `snapshot_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  
  logger.info('📥 Received snapshot request:', {
    id: snapshotId,
    htmlLength: html.length,
    options: options || {}
  });

  try {
    // Extract client data from multiple possible shapes
    // 1) Nested: options.clientData or options.clientDataDuringSnapshot (preferred)
    // 2) Flattened directly on options (fallback)
    const clientData = options?.clientData || options?.clientDataDuringSnapshot || null;
    const flatten = options || {};
    const mapped = {
      type: clientData?.type ?? flatten.type,
      searchId: clientData?.searchId ?? clientData?.search_id ?? flatten.searchId ?? flatten.search_id,
      hashKey: clientData?.hashKey ?? clientData?.hash_key ?? flatten.hashKey ?? flatten.hash_key,
      siteId: clientData?.siteId ?? clientData?.sideId ?? clientData?.site_id ?? flatten.siteId ?? flatten.sideId ?? flatten.site_id,
      checkoutId: clientData?.checkoutId ?? clientData?.checkout_id ?? flatten.checkoutId ?? flatten.checkout_id,
      cartId: clientData?.cartId ?? clientData?.cart_id ?? flatten.cartId ?? flatten.cart_id,
      clientData: clientData || (Object.keys(flatten || {}).length ? flatten : null)
    };
    // Prepare data for database
    const snapshotData = {
      id: snapshotId,
      html: html,
      url: options?.url,
      viewport: options?.viewport,
      options: options,
      processingStatus: 'queued',
      type: mapped.type,
      searchId: mapped.searchId,
      hashKey: mapped.hashKey,
      siteId: mapped.siteId,
      checkoutId: mapped.checkoutId,
      cartId: mapped.cartId,
      clientData: mapped.clientData
    };

    // Save to database
    await db.saveSnapshot(snapshotData);

    // Add job to queue
    const queueJob = await snapshotQueue.addSnapshotJob({
      snapshotId,
      metadata: {
        url: options?.url,
        viewport: options?.viewport,
        htmlSize: html.length
      }
    });

    // Update snapshot with job ID
    await db.updateSnapshotJobId(snapshotId, queueJob.jobId);

    logger.info('✅ Snapshot saved and queued:', {
      id: snapshotId,
      jobId: queueJob.jobId,
      searchId: mapped.searchId,
      htmlSize: html.length
    });

    res.json(true);

  } catch (error) {
    logger.error('❌ Error processing snapshot:', error);
    res.status(500).json(false);
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

    // Use raw snapshot data
    let responseSnapshot = snapshot;
    logger.info('Returning snapshot data:', snapshot.id);

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
    res.setHeader('Content-Type', `image/${screenshot.screenshot_format || 'png'}`);
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

// POST /snapshots/:id/replay-screenshot - Replay screenshot generation by re-queuing job
router.post('/snapshots/:id/replay-screenshot', async (req, res) => {
  try {
    const snapshotId = req.params.id;
    
    logger.info(`🔄 Screenshot replay request for snapshot ${snapshotId}`);
    
    // Verify snapshot exists
    const snapshot = await db.getSnapshot(snapshotId);
    if (!snapshot) {
      return res.status(404).json({
        success: false,
        error: 'Snapshot not found'
      });
    }
    
    // Re-queue the screenshot job
    const queueJob = await snapshotQueue.addSnapshotJob({
      snapshotId,
      metadata: {
        url: snapshot.url,
        viewport: { 
          width: snapshot.viewport_width || 1920, 
          height: snapshot.viewport_height || 1080 
        },
        replay: true,
        originalJobId: snapshot.queue_job_id
      }
    });
    
    // Update snapshot with new job ID
    await db.updateSnapshotJobId(snapshotId, queueJob.jobId);
    
    logger.info(`✅ Screenshot replay job queued:`, {
      snapshotId,
      newJobId: queueJob.jobId,
      queuePosition: queueJob.queuePosition
    });
    
    res.json({
      success: true,
      message: 'Screenshot replay job queued successfully',
      snapshotId,
      jobId: queueJob.jobId,
      queuePosition: queueJob.queuePosition,
      isReplay: true,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    logger.error(`❌ Error replaying screenshot for ${req.params.id}:`, error);
    res.status(500).json({
      success: false,
      error: 'Failed to replay screenshot job',
      message: error.message
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

    // Check if DOM data exists
    if (!snapshot.html) {
      return res.status(410).send('DOM data not available');
    }

    // Serve the raw HTML content with FullStory-style security headers
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    
    // FullStory-style CSP: Block all scripts and API requests, allow styles/images
    res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline' https:; img-src 'self' data: blob: https:; font-src 'self' data: https:; connect-src 'none'; script-src 'none'; object-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none';");
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    
    res.send(snapshot.html);
    
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

// GET /db/stats - Get database usage stats
router.get('/db/stats', async (req, res) => {
  try {
    const stats = await db.getDatabaseStats();
    res.json({ success: true, stats });
  } catch (error) {
    logger.error('Error getting database stats:', error);
    res.status(500).json({ success: false, error: 'Failed to get database stats' });
  }
});

module.exports = router;