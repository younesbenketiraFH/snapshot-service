# Snapshot Service

## Project Overview

This is a Node.js Express service that receives DOM snapshots with inline styles and queues jobs with Redis BullMQ for screenshot generation using Puppeteer browser pool.

## Current Implementation Status

### ✅ Completed
- **Basic Express Server**: Running on port 8847
- **Health Check Endpoint**: `GET /health`
- **Snapshot Endpoint**: `POST /snapshot` - receives, compresses, and queues DOM snapshots
- **SQLite Database**: Persistent storage with compression support
- **Redis BullMQ Queue System**: Asynchronous job processing with Redis
- **Compression System**: Brotli/Gzip compression for efficient storage
- **Database API**: GET endpoints for retrieving snapshots (auto-decompresses)
- **Legal Dashboard**: Web interface for viewing snapshots with 1:1 accuracy
- **Exact CSS Rendering**: Preserves all inline styles, computed styles, and external CSS
- **Legal Evidence Features**: Watermarking, metadata, exact viewport rendering
- **Queue Management APIs**: Job status tracking and queue statistics
- **Docker Containerization**: Full Docker setup with Redis
- **Security Middleware**: Helmet, CORS, Morgan logging
- **Large Payload Support**: 10MB limit with compression for efficient storage
- **SnapshotManager Integration**: Enhanced JavaScript client with comprehensive CSS extraction

### 🚧 Planned Features
- Puppeteer browser pool management
- Screenshot generation from DOM snapshots (after job processing)
- Image storage and retrieval system
- Advanced job retry strategies
- Webhook notifications for job completion
- Performance metrics and monitoring

## Architecture

```
/Users/younesbenketira/Code/travel/
├── solar/                              (Main PHP project)
│   └── include/Mv/Ota/OtaCommon/View/Partials/Js/
│       └── SnapshotManager.js.php      (Client-side snapshot capture)
└── snapshot-service/                   (Node.js service)
    ├── index.js                        (Express server)
    ├── package.json
    └── CLAUDE.md                       (This file)
```

## API Endpoints

### `GET /health`
Health check endpoint that returns server status.

**Response:**
```json
{
  "status": "ok",
  "timestamp": "2025-08-06T14:18:32.000Z"
}
```

### `POST /snapshot`
Receives DOM snapshot requests and saves them to SQLite database.

**Request Body:**
```json
{
  "html": "<html>...</html>",
  "css": "body { margin: 0; }...",
  "options": {
    "url": "https://example.com/checkout",
    "timestamp": "2025-08-06T14:18:32.000Z",
    "viewport": { "width": 1920, "height": 1080 },
    "type": "checkout_page_load",
    "checkout_id": "abc123",
    "search_id": "def456"
  }
}
```

**Response:**
```json
{
  "success": true,
  "message": "Snapshot compressed, saved, and queued for processing",
  "id": "snapshot_1725628712000_abc123def",
  "jobId": "12345",
  "queuePosition": 1,
  "compressionStats": {
    "totalOriginalSize": 125000,
    "totalCompressedSize": 25000,
    "overallCompressionRatio": 80.0,
    "compressionTimeMs": 150
  },
  "timestamp": "2025-08-06T14:18:32.000Z"
}
```

### `GET /snapshots`
Retrieves recent snapshots with metadata (excludes HTML/CSS content).

**Query Parameters:**
- `limit`: Number of snapshots to retrieve (default: 50, max: 200)

**Response:**
```json
{
  "success": true,
  "snapshots": [
    {
      "id": "snapshot_1725628712000_abc123def",
      "url": "https://example.com/checkout",
      "viewport_width": 1920,
      "viewport_height": 1080,
      "created_at": "2025-08-06 14:18:32",
      "html_size": 45678,
      "css_size": 12345
    }
  ],
  "count": 1
}
```

### `GET /snapshots/:id`
Retrieves a specific snapshot with full HTML and CSS content.

**Response:**
```json
{
  "success": true,
  "snapshot": {
    "id": "snapshot_1725628712000_abc123def",
    "html": "<html>...</html>",
    "css": "body { margin: 0; }...",
    "url": "https://example.com/checkout",
    "viewport_width": 1920,
    "viewport_height": 1080,
    "options": { "type": "checkout_page_load" },
    "created_at": "2025-08-06 14:18:32",
    "updated_at": "2025-08-06 14:18:32"
  }
}
```

### `GET /` or `GET /dashboard`
Serves the legal dashboard interface for viewing snapshots.

**Features:**
- Lists all captured snapshots with metadata
- Filtering by URL and date
- 1:1 exact rendering of snapshots for legal evidence
- Zoom controls and fullscreen viewing
- Download snapshots as HTML files
- Legal watermarking and metadata preservation

### `GET /queue/stats`
Returns current queue statistics.

**Response:**
```json
{
  "success": true,
  "stats": {
    "waiting": 5,
    "active": 2,
    "completed": 150,
    "failed": 3,
    "total": 160
  }
}
```

### `GET /queue/job/:jobId`
Returns status of a specific job.

**Response:**
```json
{
  "success": true,
  "job": {
    "id": "12345",
    "status": "completed",
    "progress": 100,
    "data": { "snapshotId": "snapshot_123" },
    "processedOn": 1725628712000,
    "finishedOn": 1725628715000
  }
}
```

## Client Integration

The service integrates with the solar PHP project through `SnapshotManager.js.php` which:

- Captures full DOM by default (when no selector provided)
- Extracts inline CSS from all stylesheets
- Includes metadata (URL, viewport, timestamp)
- Sends snapshots to `http://localhost:8847/snapshot`

**Usage in PHP templates:**
```javascript
// Take snapshot of entire page (default)
SnapshotManager.takeSnapshot();

// Take snapshot with options
SnapshotManager.takeSnapshot(null, {
    type: 'checkout_page_load',
    checkout_id: '12345'
});
```

## Docker Setup

### Development with Docker Compose

```bash
# Build and start all services (snapshot-service + Redis)
docker-compose up --build

# Start in background
docker-compose up -d

# View logs
docker-compose logs -f snapshot-service
docker-compose logs -f redis

# Stop services
docker-compose down

# Stop and remove volumes
docker-compose down -v
```

### Individual Docker Commands

```bash
# Build the image
docker build -t snapshot-service .

# Run the container
docker run -p 8847:8847 \
  -e DATABASE_PATH=/usr/src/app/data/snapshots.db \
  -v $(pwd)/data:/usr/src/app/data \
  snapshot-service
```

## Development Commands

```bash
# Start the service locally
npm start

# Development mode (same as start currently)
npm run dev

# Install dependencies
npm install
```

## Environment Variables

- `PORT`: Server port (default: 8847)
- `DATABASE_PATH`: SQLite database file path (default: ./data/snapshots.db)
- `REDIS_URL`: Redis connection URL (default: redis://localhost:6379)
- `NODE_ENV`: Environment (development/production)

## Dependencies

- **express**: ^5.1.0 - Web framework
- **cors**: ^2.8.5 - CORS middleware
- **helmet**: ^8.1.0 - Security middleware
- **morgan**: ^1.10.1 - Request logging
- **sqlite3**: ^5.1.6 - SQLite database driver
- **ioredis**: ^5.3.2 - Redis client
- **bullmq**: ^5.1.0 - Redis-based job queue
- **jsdom**: ^24.0.0 - Server-side DOM parsing
- **dotenv**: ^16.3.1 - Environment variable management

## Database Schema

### snapshots table
```sql
CREATE TABLE snapshots (
  id TEXT PRIMARY KEY,                    -- Unique snapshot identifier
  html TEXT,                              -- Full HTML content (nullable for compressed-only)
  css TEXT,                               -- Inline CSS styles (nullable for compressed-only)
  html_compressed BLOB,                   -- Compressed HTML content
  css_compressed BLOB,                    -- Compressed CSS styles  
  compression_type TEXT DEFAULT 'none',  -- Compression algorithm used
  original_html_size INTEGER DEFAULT 0,  -- Original HTML size in bytes
  original_css_size INTEGER DEFAULT 0,   -- Original CSS size in bytes
  compressed_html_size INTEGER DEFAULT 0,-- Compressed HTML size in bytes
  compressed_css_size INTEGER DEFAULT 0, -- Compressed CSS size in bytes
  url TEXT,                               -- Source URL
  viewport_width INTEGER,                 -- Viewport width
  viewport_height INTEGER,                -- Viewport height
  options TEXT,                           -- JSON options object
  queue_job_id TEXT,                      -- BullMQ job identifier
  processing_status TEXT DEFAULT 'pending', -- Job processing status
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  processed_at DATETIME                   -- When job completed processing
);
```

**Indexes:**
- `idx_snapshots_created_at` - For time-based queries
- `idx_snapshots_url` - For URL-based queries
- `idx_snapshots_status` - For processing status queries
- `idx_snapshots_job_id` - For job tracking queries

## Queue System Architecture

### Flow Overview
1. **Snapshot Received** → HTML/CSS captured by SnapshotManager
2. **Compression** → Data compressed using Brotli/Gzip (80%+ reduction)
3. **Database Storage** → Compressed data saved to SQLite with metadata
4. **Queue Job Created** → BullMQ job created with snapshot reference
5. **Job Processing** → Worker decompresses data and processes (placeholder for screenshots)
6. **Status Updates** → Processing status tracked in database

### Compression Benefits
- **Storage Efficiency**: 70-90% size reduction typical
- **Network Performance**: Faster data transfer
- **Cost Savings**: Reduced storage requirements
- **Scalability**: Handle larger volumes efficiently

### Queue Features
- **Concurrency**: 5 concurrent job processors
- **Retry Logic**: 3 attempts with exponential backoff
- **Job Persistence**: Jobs survive server restarts
- **Status Tracking**: Real-time job progress monitoring
- **Cleanup**: Automatic removal of old completed/failed jobs

## Next Steps

1. **Redis BullMQ Integration**
   - Add Redis connection
   - Implement job queue for snapshot processing
   - Add job status endpoints

2. **Puppeteer Implementation**
   - Browser pool management
   - DOM rendering from snapshot data
   - Screenshot capture and optimization

3. **Storage System**
   - Image file storage (local/cloud)
   - Metadata persistence
   - Cleanup/retention policies

## Important Notes

⚠️ **KEEP THIS FILE UPDATED**: This CLAUDE.md file should be updated whenever changes are made to the snapshot service. This helps Claude understand the current state and architecture for future development.

## File Locations

- **Service**: `/Users/younesbenketira/Code/travel/snapshot-service/`
- **Client**: `/Users/younesbenketira/Code/travel/solar/include/Mv/Ota/OtaCommon/View/Partials/Js/SnapshotManager.js.php`
- **Integration**: `/Users/younesbenketira/Code/travel/solar/include/Mv/Ota/Jfly/App/Checkout/View/billing_dark_headers.php`

## Container Architecture

```
docker-compose.yml
├── snapshot-service (Node.js Express API)
│   ├── Port: 8847
│   ├── Database: SQLite (persistent volume)
│   └── Networks: snapshot-network
└── redis (Redis 7 Alpine)
    ├── Port: 6379
    ├── Data: Persistent volume
    └── Networks: snapshot-network
```

Last Updated: 2025-08-06