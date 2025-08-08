const { Queue, Worker } = require('bullmq');
const Redis = require('ioredis');
const Database = require('../database');
const BrowserService = require('./browserService');
const { logger } = require('../logger');

class SnapshotQueue {
    constructor(redisUrl = null) {
        this.redisUrl = redisUrl || process.env.REDIS_URL || 'redis://localhost:6379';
        this.queueName = 'snapshot-processing';
        
        // Create Redis connections
        this.redisConnection = new Redis(this.redisUrl, {
            maxRetriesPerRequest: null, // Required by BullMQ for blocking operations
            retryDelayOnFailure: 1000,
            enableReadyCheck: false,
            lazyConnect: true
        });
        
        // Initialize queue and worker
        this.queue = null;
        this.worker = null;
        this.db = null; // Will be injected from outside
        this.browserService = null; // Will be injected from outside
        
    }

    async initialize(browserService = null, db = null) {
        try {
            // Test Redis connection
            await this.redisConnection.ping();
            logger.info('✅ Redis connection established');
            
            // Use shared database if provided
            if (db) {
                this.db = db;
            } else if (!this.db) {
                throw new Error('Database must be provided to queue system');
            }
            
            // Use shared browser service if provided
            if (browserService) {
                this.browserService = browserService;
            } else if (!this.browserService) {
                throw new Error('Browser service must be provided to queue system');
            }
            
            // Create BullMQ queue
            const defaultAttempts = parseInt(process.env.QUEUE_ATTEMPTS || '', 10) || 5;
            const defaultBackoffMs = parseInt(process.env.QUEUE_BACKOFF_MS || '', 10) || 5000;
            this.queue = new Queue(this.queueName, {
                connection: this.redisConnection.duplicate(),
                defaultJobOptions: {
                    attempts: defaultAttempts,
                    backoff: {
                        type: 'exponential',
                        delay: defaultBackoffMs,
                    },
                    removeOnComplete: 100, // Keep last 100 completed jobs
                    removeOnFail: 50,      // Keep last 50 failed jobs
                }
            });

            // Create BullMQ worker
            const workerConcurrency = parseInt(process.env.QUEUE_CONCURRENCY || '', 10) || (this.browserService?.poolSize || 3);
            this.worker = new Worker(this.queueName, this.processSnapshotJob.bind(this), {
                connection: this.redisConnection.duplicate(),
                concurrency: workerConcurrency, // Align concurrency with browser pool size by default
                removeOnComplete: 100,
                removeOnFail: 50,
            });

            // Worker event listeners
            this.worker.on('ready', () => {
                logger.info('🔄 Snapshot worker is ready');
            });

            this.worker.on('completed', (job) => {
                logger.info('✅ Snapshot job completed:', {
                    id: job.id,
                    snapshotId: job.data.snapshotId,
                    duration: `${job.finishedOn - job.processedOn}ms`
                });
            });

            this.worker.on('failed', (job, err) => {
                logger.error('❌ Snapshot job failed:', {
                    id: job.id,
                    snapshotId: job.data.snapshotId,
                    error: err.message,
                    attempts: job.attemptsMade
                });
            });

            this.worker.on('error', (err) => {
                logger.error('🔥 Worker error:', err);
            });

            // Queue event listeners
            this.queue.on('error', (err) => {
                logger.error('🔥 Queue error:', err);
            });

            
        } catch (error) {
            logger.error('❌ Failed to initialize queue system:', error);
            throw error;
        }
    }

    /**
     * Add a snapshot processing job to the queue
     * @param {Object} jobData - Job data containing snapshot information
     * @returns {Object} - Job information
     */
    async addSnapshotJob(jobData) {
        try {
            const jobOptions = {
                priority: jobData.priority || 0,
                delay: jobData.delay || 0,
            };

            const job = await this.queue.add('process-snapshot', jobData, jobOptions);
            
            logger.info('📝 Added snapshot job to queue:', {
                jobId: job.id,
                snapshotId: jobData.snapshotId,
                priority: jobOptions.priority
            });

            return {
                jobId: job.id,
                snapshotId: jobData.snapshotId,
                queuePosition: null // getPosition() method is not available in current BullMQ version
            };
            
        } catch (error) {
            logger.error('❌ Failed to add snapshot job:', error);
            throw new Error(`Failed to queue snapshot job: ${error.message}`);
        }
    }

    /**
     * Process a snapshot job (decompresses and processes the snapshot)
     * @param {Object} job - BullMQ job object
     * @returns {Object} - Processing result
     */
    async processSnapshotJob(job) {
        const { snapshotId, metadata } = job.data;
        const startTime = Date.now();
        
        logger.info('🔄 Processing snapshot job:', {
            jobId: job.id,
            snapshotId,
            attempt: job.attemptsMade + 1
        });

        try {
            // Update job progress
            await job.updateProgress(10);

            // Fetch snapshot from database
            const snapshot = await this.db.getSnapshot(snapshotId);
            if (!snapshot) {
                throw new Error(`Snapshot not found: ${snapshotId}`);
            }

            await job.updateProgress(25);

            // Update status to processing
            await this.db.updateSnapshotStatus(snapshotId, 'processing');

            await job.updateProgress(70);

            // Generate screenshot
            let screenshotGenerated = false;
            let domDataCleaned = false;
            // Attempt screenshot. On failure, let error bubble so BullMQ retries with backoff
            const screenshotResult = await this.browserService.takeSnapshotScreenshot(snapshotId);
            screenshotGenerated = true;
            logger.info('✅ Screenshot generated:', screenshotResult.snapshotId);

            // Clean DOM data after successful screenshot
            try {
                const cleanupResult = await this.browserService.cleanupSnapshotAfterScreenshot(snapshotId);
                domDataCleaned = !!cleanupResult?.domDataRemoved;
            } catch (cleanupError) {
                logger.warn(`⚠️ DOM cleanup failed for ${snapshotId}:`, cleanupError.message);
            }

            // DOM data is cleaned immediately above on success

            await job.updateProgress(90);

            // Update status to completed
            await this.db.updateSnapshotStatus(snapshotId, 'completed', new Date().toISOString());

            await job.updateProgress(100);

            const processingTime = Date.now() - startTime;
            const result = {
                snapshotId,
                status: 'completed',
                processingTimeMs: processingTime,
                htmlSize: snapshot.html?.length || 0,
                screenshotGenerated,
                domDataCleaned,
                metadata
            };

            logger.info('✅ Snapshot processing completed:', result);
            return result;

        } catch (error) {
            logger.error('❌ Snapshot processing failed:', {
                jobId: job.id,
                snapshotId,
                error: error.message
            });

            // Update status to failed
            try {
                await this.db.updateSnapshotStatus(snapshotId, 'failed');
            } catch (dbError) {
                logger.error('❌ Failed to update snapshot status to failed:', dbError);
            }

            throw error;
        }
    }

    /**
     * Get queue statistics
     * @returns {Object} - Queue stats
     */
    async getQueueStats() {
        try {
            // Use O(1) counts from Redis to avoid pagination limits on getCompleted/getFailed, etc.
            const counts = await this.queue.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed');
            const waiting = counts.waiting || 0;
            const active = counts.active || 0;
            const completed = counts.completed || 0;
            const failed = counts.failed || 0;
            const delayed = counts.delayed || 0;
            return {
                waiting,
                active,
                completed,
                failed,
                delayed,
                total: waiting + active + completed + failed + delayed
            };
        } catch (error) {
            logger.error('Error getting queue stats:', error);
            return { waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0, total: 0 };
        }
    }

    /**
     * Get job status
     * @param {string} jobId - Job ID
     * @returns {Object} - Job status information
     */
    async getJobStatus(jobId) {
        try {
            const job = await this.queue.getJob(jobId);
            if (!job) {
                return { status: 'not_found' };
            }

            const state = await job.getState();
            
            return {
                id: job.id,
                status: state,
                progress: job.progress,
                data: job.data,
                processedOn: job.processedOn,
                finishedOn: job.finishedOn,
                failedReason: job.failedReason,
                attemptsMade: job.attemptsMade
            };
        } catch (error) {
            logger.error('Error getting job status:', error);
            return { status: 'error', error: error.message };
        }
    }

    /**
     * List jobs grouped by state
     */
    async listJobs({ limit = 100 } = {}) {
        try {
            const [waiting, active, completed, failed, delayed] = await Promise.all([
                this.queue.getWaiting(0, limit - 1),
                this.queue.getActive(0, limit - 1),
                this.queue.getCompleted(0, limit - 1),
                this.queue.getFailed(0, limit - 1),
                this.queue.getDelayed(0, limit - 1)
            ]);

            const mapJob = (job) => ({
                id: job.id,
                name: job.name,
                data: job.data,
                progress: job.progress,
                attemptsMade: job.attemptsMade,
                timestamp: job.timestamp,
                processedOn: job.processedOn,
                finishedOn: job.finishedOn,
                failedReason: job.failedReason
            });

            return {
                waiting: waiting.map(mapJob),
                active: active.map(mapJob),
                completed: completed.map(mapJob),
                failed: failed.map(mapJob),
                delayed: delayed.map(mapJob)
            };
        } catch (error) {
            logger.error('Error listing jobs:', error);
            return { waiting: [], active: [], completed: [], failed: [], delayed: [] };
        }
    }

    /**
     * Clean up old jobs
     * @param {number} maxAge - Max age in milliseconds
     */
    async cleanupJobs(maxAge = 24 * 60 * 60 * 1000) { // 24 hours default
        try {
            await this.queue.clean(maxAge, 100, 'completed');
            await this.queue.clean(maxAge, 50, 'failed');
            logger.info('🧹 Queue cleanup completed');
        } catch (error) {
            logger.error('❌ Queue cleanup failed:', error);
        }
    }

    /**
     * Gracefully shutdown the queue system
     */
    async shutdown() {
        logger.info('🛑 Shutting down queue system...');
        
        try {
            if (this.worker) {
                await this.worker.close();
                logger.info('✅ Worker closed');
            }
            
            if (this.queue) {
                await this.queue.close();
                logger.info('✅ Queue closed');
            }
            
            if (this.redisConnection) {
                this.redisConnection.disconnect();
                logger.info('✅ Redis connection closed');
            }
            
            // Note: Browser service and database shutdown are handled by the main service
            
        } catch (error) {
            logger.error('❌ Error during shutdown:', error);
        }
    }
}

module.exports = SnapshotQueue;