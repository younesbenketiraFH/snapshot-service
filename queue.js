const { Queue, Worker } = require('bullmq');
const Redis = require('ioredis');
const Database = require('./database');
const CompressionUtils = require('./compression');

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
        this.db = new Database();
        
        console.log('SnapshotQueue initialized with Redis URL:', this.redisUrl);
    }

    async initialize() {
        try {
            // Test Redis connection
            await this.redisConnection.ping();
            console.log('✅ Redis connection established');
            
            // Initialize database
            await this.db.initialize();
            console.log('✅ Database initialized for queue system');
            
            // Create BullMQ queue
            this.queue = new Queue(this.queueName, {
                connection: this.redisConnection.duplicate(),
                defaultJobOptions: {
                    attempts: 3,
                    backoff: {
                        type: 'exponential',
                        delay: 2000,
                    },
                    removeOnComplete: 100, // Keep last 100 completed jobs
                    removeOnFail: 50,      // Keep last 50 failed jobs
                }
            });

            // Create BullMQ worker
            this.worker = new Worker(this.queueName, this.processSnapshotJob.bind(this), {
                connection: this.redisConnection.duplicate(),
                concurrency: 5, // Process up to 5 jobs concurrently
                removeOnComplete: 100,
                removeOnFail: 50,
            });

            // Worker event listeners
            this.worker.on('ready', () => {
                console.log('🔄 Snapshot worker is ready');
            });

            this.worker.on('completed', (job) => {
                console.log('✅ Snapshot job completed:', {
                    id: job.id,
                    snapshotId: job.data.snapshotId,
                    duration: `${job.finishedOn - job.processedOn}ms`
                });
            });

            this.worker.on('failed', (job, err) => {
                console.error('❌ Snapshot job failed:', {
                    id: job.id,
                    snapshotId: job.data.snapshotId,
                    error: err.message,
                    attempts: job.attemptsMade
                });
            });

            this.worker.on('error', (err) => {
                console.error('🔥 Worker error:', err);
            });

            // Queue event listeners
            this.queue.on('error', (err) => {
                console.error('🔥 Queue error:', err);
            });

            console.log('🚀 BullMQ queue system initialized successfully');
            
        } catch (error) {
            console.error('❌ Failed to initialize queue system:', error);
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
            
            console.log('📝 Added snapshot job to queue:', {
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
            console.error('❌ Failed to add snapshot job:', error);
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
        
        console.log('🔄 Processing snapshot job:', {
            jobId: job.id,
            snapshotId,
            attempt: job.attemptsMade + 1
        });

        try {
            // Update job progress
            await job.updateProgress(10);

            // Fetch compressed snapshot from database
            const compressedSnapshot = await this.db.getSnapshot(snapshotId);
            if (!compressedSnapshot) {
                throw new Error(`Snapshot not found: ${snapshotId}`);
            }

            await job.updateProgress(25);

            // Update status to processing
            await this.db.updateSnapshotStatus(snapshotId, 'processing');

            await job.updateProgress(40);

            // Decompress the snapshot data
            console.log('📤 Decompressing snapshot:', snapshotId);
            const decompressedSnapshot = await CompressionUtils.decompressSnapshot(compressedSnapshot);

            await job.updateProgress(70);

            // Here is where we would do actual processing (e.g., screenshot generation)
            // For now, we're just demonstrating the decompression
            console.log('🎯 Snapshot processing placeholder - decompressed sizes:', {
                snapshotId,
                htmlLength: decompressedSnapshot.html?.length || 0,
                cssLength: decompressedSnapshot.css?.length || 0
            });

            // Simulate some processing time
            await new Promise(resolve => setTimeout(resolve, 1000));

            await job.updateProgress(90);

            // Update status to completed
            await this.db.updateSnapshotStatus(snapshotId, 'completed', new Date().toISOString());

            await job.updateProgress(100);

            const processingTime = Date.now() - startTime;
            const result = {
                snapshotId,
                status: 'completed',
                processingTimeMs: processingTime,
                decompressedHtmlSize: decompressedSnapshot.html?.length || 0,
                decompressedCssSize: decompressedSnapshot.css?.length || 0,
                metadata
            };

            console.log('✅ Snapshot processing completed:', result);
            return result;

        } catch (error) {
            console.error('❌ Snapshot processing failed:', {
                jobId: job.id,
                snapshotId,
                error: error.message
            });

            // Update status to failed
            try {
                await this.db.updateSnapshotStatus(snapshotId, 'failed');
            } catch (dbError) {
                console.error('❌ Failed to update snapshot status to failed:', dbError);
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
            const waiting = await this.queue.getWaiting();
            const active = await this.queue.getActive();
            const completed = await this.queue.getCompleted();
            const failed = await this.queue.getFailed();

            return {
                waiting: waiting.length,
                active: active.length,
                completed: completed.length,
                failed: failed.length,
                total: waiting.length + active.length + completed.length + failed.length
            };
        } catch (error) {
            console.error('Error getting queue stats:', error);
            return null;
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
            console.error('Error getting job status:', error);
            return { status: 'error', error: error.message };
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
            console.log('🧹 Queue cleanup completed');
        } catch (error) {
            console.error('❌ Queue cleanup failed:', error);
        }
    }

    /**
     * Gracefully shutdown the queue system
     */
    async shutdown() {
        console.log('🛑 Shutting down queue system...');
        
        try {
            if (this.worker) {
                await this.worker.close();
                console.log('✅ Worker closed');
            }
            
            if (this.queue) {
                await this.queue.close();
                console.log('✅ Queue closed');
            }
            
            if (this.redisConnection) {
                this.redisConnection.disconnect();
                console.log('✅ Redis connection closed');
            }
            
            if (this.db) {
                this.db.close();
                console.log('✅ Database connection closed');
            }
            
        } catch (error) {
            console.error('❌ Error during shutdown:', error);
        }
    }
}

module.exports = SnapshotQueue;