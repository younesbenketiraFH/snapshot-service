const express = require('express');
const router = express.Router();

// Queue controller will receive dependencies via middleware
let snapshotQueue;

// Middleware to inject dependencies
router.use((req, res, next) => {
  snapshotQueue = req.app.locals.snapshotQueue;
  next();
});

// GET /queue/stats - Get queue statistics
router.get('/stats', async (req, res) => {
  try {
    const stats = await snapshotQueue.getQueueStats();
    res.json({
      success: true,
      stats
    });
  } catch (error) {
    logger.error('Error getting queue stats:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get queue stats'
    });
  }
});

// GET /queue/job/:jobId - Get specific job status
router.get('/job/:jobId', async (req, res) => {
  try {
    const jobStatus = await snapshotQueue.getJobStatus(req.params.jobId);
    res.json({
      success: true,
      job: jobStatus
    });
  } catch (error) {
    logger.error('Error getting job status:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get job status'
    });
  }
});

// POST /queue/cleanup - Clean up old jobs
router.post('/cleanup', async (req, res) => {
  try {
    const maxAge = req.body.maxAge || 24 * 60 * 60 * 1000; // 24 hours default
    await snapshotQueue.cleanupJobs(maxAge);
    res.json({
      success: true,
      message: 'Queue cleanup completed'
    });
  } catch (error) {
    logger.error('Error cleaning up queue:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to cleanup queue'
    });
  }
});

module.exports = router;