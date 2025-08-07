# Legal DOM Snapshot Service

## What This Is

This is a **legal evidence DOM snapshot service** designed for capturing and preserving exact web page states for legal purposes. The service receives full DOM snapshots with inline CSS styles, compresses and stores them in SQLite, processes them through a Redis queue system, and generates high-fidelity screenshots using a Puppeteer browser pool.

**Primary Use Case**: Capturing checkout pages, booking confirmations, and other critical web interactions for legal evidence in travel/booking disputes.

**Key Features**: Compression (80%+ size reduction), exact 1:1 visual reproduction, legal watermarking, screenshot generation, and web dashboard for evidence review.

## Current Implementation Status

### ✅ Completed
- **Express Server**: Running on port 8847 with security middleware
- **Shared Resource Management**: Single database connection and browser pool shared across all services
- **Snapshot API**: `POST /snapshot` - receives, compresses, and queues DOM snapshots
- **SQLite Database**: Persistent storage with Brotli/Gzip compression
- **Redis BullMQ Queue**: Asynchronous job processing with automatic screenshot generation
- **Puppeteer Browser Pool**: 3 headless Chrome instances for screenshot generation
- **Screenshot API**: Generate and retrieve WebP screenshots of snapshots
- **Compression System**: Handles both camelCase and snake_case field names
- **Legal Dashboard**: Web interface with screenshot/DOM view toggle
- **Database APIs**: GET endpoints for snapshots, screenshots, and metadata
- **Legal Evidence Features**: Exact viewport rendering, metadata preservation
- **Queue Management**: Job status tracking and statistics
- **Docker Setup**: Full containerization with Alpine Linux optimizations
- **Service Architecture**: Modular design with browserService, queueService, database

### 🔧 Recent Updates
- **Screenshot Generation**: Automatic screenshot creation during queue processing
- **Browser Service**: Decompresses snapshots and loads them directly into browsers (not URLs)
- **Database Field Compatibility**: Handles both JavaScript camelCase and SQL snake_case naming
- **Resource Optimization**: Single shared database and browser pool across all services
- **Simplified Logging**: Cleaner startup logs without redundant information

### ⚠️ Current Issues - CSS Rendering Problem (August 2025)

#### **Status**: CSS only partially loaded - screenshots show HTML structure but missing most styling

#### **Problem Description**
The snapshot service successfully captures HTML and CSS from the client-side, but when generating screenshots in Docker, only partial CSS styling is applied. The HTML renders correctly with text content visible, but most visual styling (colors, layouts, fonts, etc.) is missing.

#### **Progress Made**
✅ **Client-Side CSS Capture Enhanced** (`SnapshotManager.js.php`)
- Now captures inline `<style>` blocks first (most critical for layout)
- Improved external stylesheet handling with CORS restrictions
- Enhanced computed styles extraction for critical elements

✅ **Server-Side CSS Processing** (`browserService.js`)  
- Fetches external CSS that was blocked by CORS
- Injects CSS as separate blocks rather than one massive block
- Removes original `<link>` tags to prevent CORS conflicts

✅ **Docker Configuration Fixes**
- Added `--disable-web-security` and `--allow-running-insecure-content` browser flags
- Configured `extra_hosts` mapping for `justfly.dev` domains
- Increased `shm_size` to 1g for large bitmap rendering
- Installed system fonts (`ttf-dejavu`, `ttf-liberation`)

✅ **CSS-in-JS Framework Support**
- Temporarily enables JavaScript for CSS-in-JS frameworks
- Detects Emotion/styled-components style injection
- Disables JavaScript after CSS processing for security

#### **Current Symptoms**
- ✅ HTML structure renders correctly (9,647 elements detected)
- ✅ Text content visible (headers, navigation, forms)
- ✅ 43 style elements detected and loaded
- ✅ External CSS successfully fetched (1.8MB+ of CSS)
- ❌ Visual styling largely missing (colors, backgrounds, layouts)
- ❌ Typography not applying correctly despite font loading

#### **Debug Output Analysis**
```
🔍 Rendering debug info:
  totalElements: 9647
  visibleElements: 6787 (good - elements are visible)
  elementsWithColor: 501 (some colors applying)
  elementsWithBackground: 508 (some backgrounds applying)

🔍 CSS Debug Info:
  totalStyleElements: 43 (all CSS loaded)
  styleDetails: [shows 1.8MB external CSS + inline styles loaded]
```

#### **Files Currently Involved in CSS Flow**

**Client-Side Capture:**
- `/Users/younesbenketira/Code/travel/solar/include/Mv/Ota/OtaCommon/View/Partials/Js/SnapshotManager.js.php` - Enhanced CSS capture
- `/Users/younesbenketira/Code/travel/solar/include/Mv/Ota/Jfly/App/Checkout/View/billing_dark_headers.php` - Source page with critical inline styles

**Server-Side Processing:**
- `/Users/younesbenketira/Code/travel/snapshot-service/services/browserService.js` - CSS injection and screenshot generation
- `/Users/younesbenketira/Code/travel/snapshot-service/Dockerfile` - System fonts and dependencies
- `/Users/younesbenketira/Code/travel/snapshot-service/docker-compose.yml` - Network and memory configuration

#### **Hypothesis for Partial CSS Loading**
1. **CSS Cascade Conflicts**: Injected external CSS might be conflicting with inline styles
2. **Font Loading Issues**: Web fonts may not be loading properly despite CORS fixes
3. **CSS Specificity Problems**: Order of CSS injection affecting rule precedence  
4. **Missing Dev CSS Files**: Two critical `.dev` CSS files still failing to fetch
5. **CSS Parser Overload**: Browser struggling with 1.8MB+ CSS blocks

#### **Next Investigation Steps**
1. Debug CSS rule application in browser console
2. Check font loading status with `document.fonts.ready`  
3. Analyze CSS cascade order and specificity conflicts
4. Test with minimal CSS injection to isolate issues
5. Verify if missing dev CSS files contain critical layout rules

## Architecture

```
/Users/younesbenketira/Code/travel/
├── solar/                                    (Main PHP project)
│   ├── include/Mv/Ota/OtaCommon/View/Helper/
│   │   └── SnapshotV3.php                   (PHP helper)
│   └── include/Mv/Ota/OtaCommon/View/Partials/Js/
│       └── SnapshotHelperV3.js.php          (Client-side capture)
└── snapshot-service/                         (Node.js service)
    ├── index.js                              (Express server)
    ├── database.js                           (SQLite database)
    ├── compression.js                        (Brotli/Gzip compression)
    ├── services/
    │   ├── browserService.js                 (🔧 CSS injection & screenshot generation)
    │   └── queueService.js                   (Redis BullMQ queue)
    ├── controllers/
    │   ├── dashboardController.js            (Dashboard routing)
    │   ├── snapshotController.js             (Snapshot & screenshot APIs)
    │   └── queueController.js                (Queue management APIs)
    ├── Dockerfile                            (🔧 System fonts & dependencies)
    ├── docker-compose.yml                    (🔧 Network config & shm_size)
    └── public/
        ├── dashboard.html                    (Legal evidence dashboard)
        ├── dashboard.js                      (Dashboard functionality)
        └── dashboard.css                     (Dashboard styling)
```

## API Endpoints

### Core Snapshot APIs

#### `POST /snapshot`
Receives DOM snapshots, compresses them, and queues for processing with automatic screenshot generation.

**Request Body:**
```json
{
  "html": "<html>...</html>",
  "css": "body { margin: 0; }...",
  "options": {
    "url": "https://example.com/checkout",
    "viewport": { "width": 1920, "height": 1080 },
    "type": "checkout_page_load",
    "checkout_id": "abc123"
  }
}
```

**Response:**
```json
{
  "success": true,
  "message": "Snapshot compressed, saved, and queued for processing",
  "id": "snapshot_1754493166944_y916bfk7w",
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

#### `GET /snapshots`
Retrieves recent snapshots with metadata.

**Query Parameters:**
- `limit`: Number of snapshots (default: 50)

#### `GET /snapshots/:id`
Retrieves specific snapshot with decompressed HTML/CSS content.

### Screenshot APIs

#### `POST /snapshots/:id/screenshot`
Generates a screenshot of the snapshot by loading decompressed DOM directly into browser.

**Request Body (optional):**
```json
{
  "format": "webp",
  "quality": 90,
  "fullPage": false
}
```

#### `GET /snapshots/:id/screenshot`
Retrieves the screenshot image (WebP format).

**Response Headers:**
- `Content-Type`: image/webp
- `X-Screenshot-Width`: Screenshot width
- `X-Screenshot-Height`: Screenshot height
- `X-Screenshot-Taken-At`: Generation timestamp

### Dashboard and Utility APIs

#### `GET /` or `GET /dashboard`
Legal evidence dashboard with screenshot/DOM view toggle.

**Features:**
- Screenshot view by default (faster loading)
- DOM view toggle for interactive content
- Generate screenshot button for missing screenshots
- Filtering by URL and date
- Legal metadata display

#### `GET /render/:id`
Server-side rendered snapshot for legal evidence (used by DOM view).

#### `GET /browser/stats`
Browser pool statistics.

#### `GET /queue/stats`
Queue system statistics.

#### `GET /queue/job/:jobId`
Specific job status.

#### `GET /health`
Service health check.

## Database Schema

### snapshots table
```sql
CREATE TABLE snapshots (
  id TEXT PRIMARY KEY,
  html TEXT,                                  -- Nullable (compressed-only storage)
  css TEXT,                                   -- Nullable (compressed-only storage)
  html_compressed BLOB,                       -- Brotli/Gzip compressed HTML
  css_compressed BLOB,                        -- Brotli/Gzip compressed CSS
  compression_type TEXT DEFAULT 'none',
  original_html_size INTEGER DEFAULT 0,
  original_css_size INTEGER DEFAULT 0,
  compressed_html_size INTEGER DEFAULT 0,
  compressed_css_size INTEGER DEFAULT 0,
  url TEXT,
  viewport_width INTEGER,
  viewport_height INTEGER,
  options TEXT,                               -- JSON metadata
  queue_job_id TEXT,
  processing_status TEXT DEFAULT 'pending',
  screenshot BLOB,                            -- WebP screenshot data
  screenshot_format TEXT,                     -- Usually 'webp'
  screenshot_width INTEGER,
  screenshot_height INTEGER,
  screenshot_size INTEGER,
  screenshot_metadata TEXT,                   -- JSON screenshot info
  screenshot_taken_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  processed_at DATETIME
);
```

**Indexes:**
- `idx_snapshots_created_at` - Time-based queries
- `idx_snapshots_url` - URL-based queries  
- `idx_snapshots_status` - Processing status
- `idx_snapshots_job_id` - Job tracking

## Service Architecture

### Resource Management
- **Single Database Connection**: Shared across all services via dependency injection
- **Browser Pool**: 3 Puppeteer instances shared between API and queue processing
- **Service Initialization Order**: Database → BrowserService → QueueService

### Screenshot Generation Process
1. **Snapshot Received** → Compressed and stored in database
2. **Queue Processing** → Decompresses snapshot data
3. **Browser Loading** → Loads HTML/CSS directly into Puppeteer (not via URL)
4. **Screenshot Capture** → Takes WebP screenshot at original viewport size
5. **Database Storage** → Saves screenshot BLOB with metadata

### Compression System
- **Algorithms**: Brotli (default) and Gzip fallback
- **Efficiency**: 70-90% size reduction typical
- **Field Compatibility**: Handles both `htmlCompressed` and `html_compressed` naming
- **Auto-decompression**: Transparent decompression for API responses

### Queue System
- **Redis BullMQ**: Persistent job queue with Redis
- **Concurrency**: 5 concurrent job processors
- **Retry Logic**: 3 attempts with exponential backoff  
- **Auto-cleanup**: Removes old completed/failed jobs
- **Screenshot Integration**: Automatic screenshot generation during processing

## Docker Setup

### Production with Docker Compose
```bash
# Start all services
docker-compose up -d

# View logs
docker-compose logs -f snapshot-service

# Stop services  
docker-compose down
```

### Development
```bash
# Start locally
npm start

# Install dependencies
npm install
```

## Environment Variables

- `PORT`: Server port (default: 8847)
- `DATABASE_PATH`: SQLite file path (default: ./database/snapshots.db)
- `REDIS_URL`: Redis URL (default: redis://localhost:6379)
- `PUPPETEER_EXECUTABLE_PATH`: Chrome executable for Docker
- `NODE_ENV`: Environment mode

## Dependencies

### Core
- **express**: ^5.1.0 - Web framework
- **sqlite3**: ^5.1.7 - Database
- **puppeteer**: ^24.16.0 - Browser automation
- **bullmq**: ^5.56.9 - Job queue
- **ioredis**: ^5.7.0 - Redis client

### Utilities  
- **jsdom**: ^26.1.0 - DOM parsing
- **helmet**: ^8.1.0 - Security
- **cors**: ^2.8.5 - CORS
- **morgan**: ^1.10.1 - Logging
- **dotenv**: ^17.2.1 - Environment

## Client Integration

### SnapshotHelperV3.js.php
Located at: `/Users/younesbenketira/Code/travel/solar/include/Mv/Ota/OtaCommon/View/Partials/Js/SnapshotHelperV3.js.php`

**Usage:**
```javascript
// Capture full page
SnapshotHelper.takeSnapshot();

// With metadata
SnapshotHelper.takeSnapshot(null, {
    type: 'checkout_confirmation',
    booking_id: 'ABC123'
});
```

### Integration Points
- **Checkout Pages**: Automatic capture on page load
- **Confirmation Pages**: Capture booking confirmations
- **Error States**: Capture error pages for debugging

## Container Architecture

```
Docker Network: snapshot-network
├── snapshot-service
│   ├── Port: 8847
│   ├── Database: SQLite (volume mounted)
│   ├── Browser Pool: 3 Chromium instances
│   └── Features: Compression, Screenshots, Legal Dashboard
└── redis
    ├── Port: 6379
    ├── Data: Persistent Redis volume
    └── Purpose: Job queue and session storage
```

## Legal Evidence Features

### Exact Reproduction
- **1:1 Viewport**: Exact original viewport dimensions preserved
- **CSS Accuracy**: All inline styles, computed styles, and external CSS captured
- **Font Rendering**: Consistent font rendering across environments
- **Screenshot Fidelity**: WebP screenshots at original resolution

### Metadata Preservation  
- **Capture Timestamp**: Precise capture time
- **Source URL**: Original page URL
- **Browser Info**: Viewport size, user agent
- **Legal Watermarks**: Evidence identification on screenshots

### Dashboard Features
- **Dual View**: Screenshot (fast) and DOM (interactive) viewing modes
- **Filtering**: By URL, date range, status
- **Export**: Download HTML files with legal metadata
- **Evidence Trail**: Complete processing history

## Important Notes

⚠️ **File Naming**: The codebase uses both camelCase (JavaScript) and snake_case (database) field names. The compression system handles both automatically.

⚠️ **Browser Dependencies**: Puppeteer requires specific system dependencies in Docker. The Dockerfile includes all necessary packages for Alpine Linux.

⚠️ **Resource Sharing**: All services share single database connection and browser pool for efficiency. Services receive dependencies via injection pattern.

⚠️ **Legal Compliance**: Screenshots and DOM snapshots preserve exact visual state for legal evidence purposes. Do not modify rendering logic without legal review.

## File Locations

- **Service Root**: `/Users/younesbenketira/Code/travel/snapshot-service/`
- **Client Helper**: `/Users/younesbenketira/Code/travel/solar/include/Mv/Ota/OtaCommon/View/Partials/Js/SnapshotHelperV3.js.php`
- **Integration Examples**: Various checkout view files in solar/include/Mv/Ota/*/App/Checkout/View/

Last Updated: 2025-08-06