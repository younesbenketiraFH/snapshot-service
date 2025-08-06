require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const { logger, httpLogger } = require('./logger');

const Database = require('./database');
const SnapshotQueue = require('./services/queueService');
const BrowserService = require('./services/browserService');

// Import controllers
const dashboardController = require('./controllers/dashboardController');
const snapshotController = require('./controllers/snapshotController');
const queueController = require('./controllers/queueController');

const app = express();
const PORT = process.env.PORT || 8847;
const db = new Database();
const snapshotQueue = new SnapshotQueue();
const browserService = new BrowserService();

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "data:", "blob:"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      frameSrc: ["'self'", "data:", "blob:"],
      imgSrc: ["'self'", "data:", "blob:", "https:"],
      fontSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'"]
    },
  },
}));
app.use(cors());
app.use(httpLogger);
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Serve static files (dashboard)
app.use(express.static('public'));

// Make database, queue, and browser service available to controllers via app.locals
app.locals.db = db;
app.locals.snapshotQueue = snapshotQueue;
app.locals.browserService = browserService;

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Use controllers
app.use('/', dashboardController);
app.use('/', snapshotController); // Mount at root to handle both /snapshot and /snapshots
app.use('/queue', queueController);


// Initialize database and start server
async function startServer() {
  try {
    await db.initialize();
    logger.info('✅ Database initialized successfully');
    
    await browserService.initialize(db);
    logger.info('✅ Browser service initialized successfully');
    
    await snapshotQueue.initialize(browserService, db);
    logger.info('✅ Queue system initialized successfully');
    
    app.listen(PORT, () => {
      logger.info(`🚀 Snapshot service running on port ${PORT}`);
      logger.info(`📊 Dashboard: http://localhost:${PORT}/dashboard`);
      logger.info(`❤️ Health check: http://localhost:${PORT}/health`);
      logger.info(`📸 Snapshots API: http://localhost:${PORT}/snapshots`);
      logger.info(`📈 Queue stats: http://localhost:${PORT}/queue/stats`);
    });
  } catch (error) {
    logger.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGINT', async () => {
  logger.info('🛑 Received SIGINT, shutting down gracefully...');
  await snapshotQueue.shutdown();
  await browserService.shutdown();
  db.close();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  logger.info('🛑 Received SIGTERM, shutting down gracefully...');
  await snapshotQueue.shutdown();
  await browserService.shutdown();
  db.close();
  process.exit(0);
});

startServer();