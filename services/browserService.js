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

      // Use raw snapshot data
      let decompressedSnapshot = snapshot;

      if (!decompressedSnapshot.html) {
        throw new Error(`No HTML content available for snapshot ${snapshotId}`);
      }

      const page = await browserInstance.browser.newPage();
      
      try {
        // Set viewport to match original capture
        const viewportWidth = snapshot.viewport_width || 1920;
        const viewportHeight = snapshot.viewport_height || 1080;
        
        // Disable JavaScript completely for security - no JS execution allowed
        await page.setJavaScriptEnabled(false);

        await page.setViewport({
          width: viewportWidth,
          height: viewportHeight,
          deviceScaleFactor: options.deviceScaleFactor || 1
        });

        // Create the complete HTML with CSS styles
        const fullHtml = this.buildCompleteHtml(decompressedSnapshot, snapshot);
        
        // Load the HTML content directly into the page
        await page.setContent(fullHtml, {
          waitUntil: 'networkidle0', // Wait for network requests to finish
          timeout: 60000 // Increased timeout for external resources
        });


        // Wait for external resources to load and content to settle
        await new Promise(r => setTimeout(r, 3000));
        
        // Debug: Check what's actually visible on the page
        const renderingDebug = await page.evaluate(() => {
          const body = document.body;
          const allElements = document.querySelectorAll('*');
          let visibleCount = 0;
          let hasColor = 0;
          let hasBackground = 0;
          
          for (let el of allElements) {
            const styles = window.getComputedStyle(el);
            const rect = el.getBoundingClientRect();
            
            if (rect.width > 0 && rect.height > 0) {
              visibleCount++;
              if (styles.color !== 'rgb(0, 0, 0)' && styles.color !== 'rgb(255, 255, 255)') {
                hasColor++;
              }
              if (styles.backgroundColor !== 'rgba(0, 0, 0, 0)' && styles.backgroundColor !== 'rgb(255, 255, 255)') {
                hasBackground++;
              }
            }
          }
          
          return {
            totalElements: allElements.length,
            visibleElements: visibleCount,
            elementsWithColor: hasColor,
            elementsWithBackground: hasBackground,
            bodyBounds: body ? body.getBoundingClientRect() : null,
            firstVisibleElement: document.querySelector('header, main, .container, .content') ? 
              window.getComputedStyle(document.querySelector('header, main, .container, .content')) : null
          };
        });
        
        console.log('🔍 Rendering debug info:', renderingDebug);
        
        // Debug CSS application - check if styles are actually being loaded
        const cssDebug = await page.evaluate(() => {
          const allStylesheets = document.querySelectorAll('style, link[rel="stylesheet"]');
          const styleInfo = [];
          
          for (let sheet of allStylesheets) {
            if (sheet.tagName === 'STYLE') {
              styleInfo.push({
                type: 'inline-style',
                length: sheet.textContent?.length || 0,
                hasContent: !!sheet.textContent?.trim(),
                preview: sheet.textContent?.substring(0, 100) || ''
              });
            } else if (sheet.tagName === 'LINK') {
              try {
                const cssRules = sheet.sheet?.cssRules?.length || 0;
                styleInfo.push({
                  type: 'external-link',
                  href: sheet.href,
                  loaded: cssRules > 0,
                  rulesCount: cssRules
                });
              } catch (e) {
                styleInfo.push({
                  type: 'external-link',
                  href: sheet.href,
                  loaded: false,
                  error: e.message
                });
              }
            }
          }
          
          return {
            totalStyleElements: allStylesheets.length,
            styleDetails: styleInfo,
            documentReady: document.readyState
          };
        });
        
        console.log('🔍 CSS Debug Info:', cssDebug);
        
        // Take PNG screenshot (PNG format works, WebP produces blank images)
        const screenshotBuffer = await page.screenshot({
          fullPage: true,
          type: 'png',
          omitBackground: false
        });
        
        console.log('📸 Screenshot captured:', {
          size: screenshotBuffer.length,
          format: 'png',
          viewport: `${viewportWidth}x${viewportHeight}`
        });

        // Save screenshot to database
        await this.saveScreenshot(snapshotId, screenshotBuffer, {
          format: 'png',
          width: viewportWidth,
          height: viewportHeight,
          fullPage: true,
          quality: 100,
          method: 'direct_html_load'
        });

        console.log(`✅ Screenshot saved for snapshot ${snapshotId} (${screenshotBuffer.length} bytes)`);
        
        return {
          snapshotId,
          screenshotSize: screenshotBuffer.length,
          format: 'png',
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

    // Check if we have valid HTML content
    if (!decompressedSnapshot.html || decompressedSnapshot.html.trim().length === 0) {
      throw new Error('No HTML content available for screenshot generation');
    }

    // Extract existing head content and body content using simple regex
    let existingHead = '';
    let bodyContent = decompressedSnapshot.html;
    
    try {
      // Extract head content
      const headMatch = decompressedSnapshot.html.match(/<head[^>]*>([\s\S]*?)<\/head>/i);
      if (headMatch) {
        existingHead = headMatch[1];
      }
      
      // Extract body content
      const bodyMatch = decompressedSnapshot.html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
      if (bodyMatch) {
        bodyContent = `<body${decompressedSnapshot.html.match(/<body[^>]*>/i)?.[0].slice(5) || '>'}${bodyMatch[1]}</body>`;
      } else {
        // If no body tag, use the whole HTML as body content
        bodyContent = decompressedSnapshot.html;
      }
    } catch (e) {
      console.warn('⚠️ HTML extraction failed, using original content:', e.message);
      existingHead = '';
      bodyContent = decompressedSnapshot.html;
    }

    // Build the complete HTML with all styles and content
    const finalHtml = `<!DOCTYPE html>
<html lang="en" data-screenshot-capture="${originalSnapshot.id}" data-capture-time="${originalSnapshot.created_at}">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=${originalSnapshot.viewport_width || 1920}, initial-scale=1.0">
    <meta name="screenshot-capture" content="true">
    <meta name="snapshot-id" content="${originalSnapshot.id}">
    <meta name="capture-timestamp" content="${originalSnapshot.created_at}">
    <meta name="capture-url" content="${originalSnapshot.url || 'unknown'}">
    <meta name="viewport-size" content="${originalSnapshot.viewport_width || 1920}x${originalSnapshot.viewport_height || 1080}">
    
    <!-- Minimal security headers for screenshot generation - scripts already disabled at browser level -->
    <meta http-equiv="X-Content-Type-Options" content="nosniff">
    <meta http-equiv="Referrer-Policy" content="no-referrer">
    
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

/* Ensure page has a white background by default */
html, body {
    background-color: white !important;
}
    </style>
    
    <title>Screenshot Capture - ${originalSnapshot.id}</title>
</head>

${bodyContent || '<body><h1>No content available</h1><p>The snapshot HTML content could not be rendered.</p></body>'}

</html>`;
    
    return finalHtml;
  }

  buildAlternativeHtml(decompressedSnapshot, originalSnapshot) {
    // Alternative approach: Keep the original HTML structure but inject CSS more directly
    let html = decompressedSnapshot.html;
    
    // If there's CSS, try to inject it at the very beginning of the head
    if (decompressedSnapshot.css) {
      const cssInline = `<style type="text/css">\n${decompressedSnapshot.css}\n</style>`;
      
      // Try to inject right after the opening head tag
      if (html.includes('<head>')) {
        html = html.replace('<head>', `<head>\n${cssInline}`);
      } else if (html.includes('<head ')) {
        html = html.replace(/<head[^>]*>/, match => `${match}\n${cssInline}`);
      } else {
        // If no head tag, add CSS at the very beginning
        html = `<!DOCTYPE html><html><head>${cssInline}</head><body>${html}</body></html>`;
      }
    }
    
    console.log(`🔧 Alternative HTML built: ${html.length} chars, CSS injected: ${!!decompressedSnapshot.css}`);
    return html;
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


  async cleanupSnapshotAfterScreenshot(snapshotId) {
    try {
      console.log(`🧹 Starting cleanup for snapshot: ${snapshotId}`);
      
      // Clean up DOM data from database (keeps metadata and screenshot)
      const result = await this.db.cleanupSnapshotDomData(snapshotId);
      
      console.log(`✅ Snapshot cleanup completed:`, {
        snapshotId,
        domDataRemoved: result.changes > 0,
        timestamp: new Date().toISOString()
      });
      
      return {
        success: true,
        snapshotId,
        domDataRemoved: result.changes > 0,
        cleanupTimestamp: new Date().toISOString()
      };
      
    } catch (error) {
      console.error(`❌ Error during snapshot cleanup for ${snapshotId}:`, error);
      throw error;
    }
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