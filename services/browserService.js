const puppeteer = require('puppeteer');
const Database = require('../database');
const CompressionUtils = require('../compression');

class BrowserService {
  constructor(options = {}) {
    this.poolSize = options.poolSize || 3;
    this.browserPool = [];
    this.busyBrowsers = new Set();
    this.db = null; // Will be injected from outside
    this.isInitialized = false;
    
    // Browser launch options optimized for Docker/Alpine
    this.launchOptions = {
      headless: true,
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--disable-gpu',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
        '--disable-features=TranslateUI',
        '--disable-ipc-flooding-protection',
        '--disable-extensions',
        '--disable-default-apps',
        '--disable-sync',
        '--disable-plugins',
        '--disable-plugins-discovery',
        '--disable-preconnect',
        '--disable-background-networking',
        '--disable-component-update'
      ],
      ...options.launchOptions
    };
  }

  async initialize(db = null) {
    if (this.isInitialized) return;
    
    
    try {
      // Use shared database if provided
      if (db) {
        this.db = db;
      } else if (!this.db) {
        throw new Error('Database must be provided to browser service');
      }
      
      // Create browser pool
      for (let i = 0; i < this.poolSize; i++) {
        const browser = await puppeteer.launch(this.launchOptions);
        this.browserPool.push({
          id: `browser_${i}`,
          browser,
          inUse: false,
          createdAt: new Date()
        });
      }
      
      this.isInitialized = true;
      console.log(`🎯 Browser pool initialized (${this.poolSize} browsers)`);
      
    } catch (error) {
      console.error('❌ Failed to initialize browser pool:', error);
      throw error;
    }
  }

  async getBrowser() {
    if (!this.isInitialized) {
      await this.initialize();
    }

    // Find available browser
    const availableBrowser = this.browserPool.find(b => !b.inUse);
    
    if (!availableBrowser) {
      throw new Error('No available browsers in pool. All browsers are busy.');
    }

    availableBrowser.inUse = true;
    this.busyBrowsers.add(availableBrowser.id);
    
    console.log(`📱 Browser ${availableBrowser.id} acquired`);
    return availableBrowser;
  }

  async releaseBrowser(browserInstance) {
    const browser = this.browserPool.find(b => b.id === browserInstance.id);
    if (browser) {
      browser.inUse = false;
      this.busyBrowsers.delete(browser.id);
      console.log(`📱 Browser ${browser.id} released`);
    }
  }

  async takeSnapshotScreenshot(snapshotId, options = {}) {
    const browserInstance = await this.getBrowser();
    
    try {
      console.log(`📸 Taking screenshot for snapshot ${snapshotId}`);
      
      // Get snapshot data from database
      const snapshot = await this.db.getSnapshot(snapshotId);
      if (!snapshot) {
        throw new Error(`Snapshot ${snapshotId} not found`);
      }

      // Decompress snapshot if compressed
      let decompressedSnapshot = snapshot;
      if (snapshot.html_compressed || snapshot.css_compressed) {
        console.log('🗜️ Decompressing snapshot for browser rendering:', snapshotId);
        decompressedSnapshot = await CompressionUtils.decompressSnapshot(snapshot);
      }

      if (!decompressedSnapshot.html) {
        throw new Error(`No HTML content available for snapshot ${snapshotId}`);
      }

      const page = await browserInstance.browser.newPage();
      
      try {
        // Set viewport to match original capture
        const viewportWidth = snapshot.viewport_width || 1920;
        const viewportHeight = snapshot.viewport_height || 1080;
        
        await page.setViewport({
          width: viewportWidth,
          height: viewportHeight,
          deviceScaleFactor: options.deviceScaleFactor || 1
        });

        // Create the complete HTML with CSS styles
        const fullHtml = this.buildCompleteHtml(decompressedSnapshot, snapshot);
        
        console.log(`🌐 Loading decompressed snapshot directly into browser`);
        
        // Load the HTML content directly into the page
        await page.setContent(fullHtml, {
          waitUntil: 'networkidle0',
          timeout: 30000
        });

        // Wait a moment for any dynamic content to settle
        await page.waitForTimeout(1000);
        
        // Take screenshot
        const screenshotBuffer = await page.screenshot({
          fullPage: options.fullPage || false,
          type: options.format || 'webp',
          quality: options.quality || 90
        });

        // Save screenshot to database
        await this.saveScreenshot(snapshotId, screenshotBuffer, {
          format: options.format || 'webp',
          width: viewportWidth,
          height: viewportHeight,
          fullPage: options.fullPage || false,
          quality: options.quality || 90,
          method: 'direct_html_load'
        });

        console.log(`✅ Screenshot saved for snapshot ${snapshotId} (${screenshotBuffer.length} bytes)`);
        
        return {
          snapshotId,
          screenshotSize: screenshotBuffer.length,
          format: options.format || 'webp',
          viewport: { width: viewportWidth, height: viewportHeight },
          timestamp: new Date().toISOString(),
          method: 'direct_html_load'
        };

      } finally {
        await page.close();
      }
      
    } catch (error) {
      console.error(`❌ Error taking screenshot for ${snapshotId}:`, error);
      throw error;
    } finally {
      await this.releaseBrowser(browserInstance);
    }
  }

  buildCompleteHtml(decompressedSnapshot, originalSnapshot) {
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

    // Build the complete HTML with all styles and content
    return `<!DOCTYPE html>
<html lang="en" data-screenshot-capture="${originalSnapshot.id}" data-capture-time="${originalSnapshot.created_at}">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=${originalSnapshot.viewport_width || 1920}, initial-scale=1.0">
    <meta name="screenshot-capture" content="true">
    <meta name="snapshot-id" content="${originalSnapshot.id}">
    <meta name="capture-timestamp" content="${originalSnapshot.created_at}">
    <meta name="capture-url" content="${originalSnapshot.url || 'unknown'}">
    <meta name="viewport-size" content="${originalSnapshot.viewport_width || 1920}x${originalSnapshot.viewport_height || 1080}">
    
    <!-- Original head content preserved -->
    ${existingHead}
    
    <!-- Captured CSS Styles -->
    <style type="text/css" data-snapshot-styles="true">
/* ========================================= */
/* CAPTURED CSS STYLES                      */  
/* Snapshot ID: ${originalSnapshot.id} */
/* Captured: ${originalSnapshot.created_at} */
/* ========================================= */

${decompressedSnapshot.css || '/* No CSS styles were captured */'}

/* ========================================= */
/* Viewport Setup for Screenshot            */
/* ========================================= */
html {
    width: ${originalSnapshot.viewport_width || 1920}px !important;
    min-height: ${originalSnapshot.viewport_height || 1080}px !important;
    overflow-x: hidden !important;
    overflow-y: hidden !important;
    margin: 0 !important;
    padding: 0 !important;
}

body {
    margin: 0 !important;
    padding: 0 !important;
    min-width: ${originalSnapshot.viewport_width || 1920}px !important;
    min-height: ${originalSnapshot.viewport_height || 1080}px !important;
    box-sizing: border-box !important;
    overflow: hidden !important;
}

/* Prevent any layout shifts */
*, *::before, *::after {
    box-sizing: border-box !important;
}
    </style>
    
    <title>Screenshot Capture - ${originalSnapshot.id}</title>
</head>

${bodyContent || '<body><h1>No content available</h1><p>The snapshot HTML content could not be rendered.</p></body>'}

</html>`;
  }

  async saveScreenshot(snapshotId, screenshotBuffer, metadata) {
    return new Promise((resolve, reject) => {
      const sql = `
        UPDATE snapshots 
        SET screenshot = ?, 
            screenshot_format = ?,
            screenshot_width = ?,
            screenshot_height = ?,
            screenshot_size = ?,
            screenshot_metadata = ?,
            screenshot_taken_at = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `;

      const params = [
        screenshotBuffer,
        metadata.format,
        metadata.width,
        metadata.height,
        screenshotBuffer.length,
        JSON.stringify(metadata),
        snapshotId
      ];

      this.db.db.run(sql, params, function(err) {
        if (err) {
          console.error('Error saving screenshot:', err);
          return reject(err);
        }

        console.log('Screenshot saved to database:', { 
          snapshotId, 
          size: screenshotBuffer.length,
          changes: this.changes 
        });
        resolve({ snapshotId, changes: this.changes });
      });
    });
  }

  async getScreenshot(snapshotId) {
    return new Promise((resolve, reject) => {
      const sql = `
        SELECT screenshot, screenshot_format, screenshot_width, screenshot_height, 
               screenshot_size, screenshot_metadata, screenshot_taken_at
        FROM snapshots 
        WHERE id = ?
      `;
      
      this.db.db.get(sql, [snapshotId], (err, row) => {
        if (err) {
          console.error('Error retrieving screenshot:', err);
          return reject(err);
        }

        if (row && row.screenshot_metadata) {
          try {
            row.screenshot_metadata = JSON.parse(row.screenshot_metadata);
          } catch (e) {
            console.warn('Error parsing screenshot metadata JSON:', e);
          }
        }

        resolve(row);
      });
    });
  }

  async shutdown() {
    console.log('🛑 Shutting down browser pool...');
    
    try {
      // Close all browsers
      for (const browserInstance of this.browserPool) {
        if (browserInstance.browser) {
          await browserInstance.browser.close();
          console.log(`🔒 Browser ${browserInstance.id} closed`);
        }
      }
      
      // Note: Database connection is managed by the main service
      
      this.browserPool = [];
      this.busyBrowsers.clear();
      this.isInitialized = false;
      
      console.log('✅ Browser pool shutdown complete');
    } catch (error) {
      console.error('❌ Error during browser pool shutdown:', error);
    }
  }

  getPoolStats() {
    return {
      totalBrowsers: this.browserPool.length,
      busyBrowsers: this.busyBrowsers.size,
      availableBrowsers: this.browserPool.length - this.busyBrowsers.size,
      isInitialized: this.isInitialized
    };
  }
}

module.exports = BrowserService;