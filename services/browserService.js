const puppeteer = require('puppeteer');
const Database = require('../database');
const CompressionUtils = require('../compression');
const { logger } = require('../logger');

class BrowserService {
  constructor(options = {}) {
    this.poolSize = options.poolSize || 3;
    this.browserPool = [];
    this.busyBrowsers = new Set();
    this.db = null; // Will be injected from outside
    this.isInitialized = false;
    
    // Browser launch options optimized for Docker/Alpine
    this.launchOptions = {
      headless: process.env.DEBUG_HEADLESS !== 'false', // Set DEBUG_HEADLESS=false for visual debugging
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
      logger.info(`🎯 Browser pool initialized (${this.poolSize} browsers)`);
      
    } catch (error) {
      logger.error('❌ Failed to initialize browser pool:', error);
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

    // Check if browser is still healthy before using
    const isHealthy = await this.checkBrowserHealth(availableBrowser);
    if (!isHealthy) {
      logger.warn(`⚠️ Browser ${availableBrowser.id} is unhealthy, replacing...`);
      await this.replaceBrowser(availableBrowser);
    }

    availableBrowser.inUse = true;
    this.busyBrowsers.add(availableBrowser.id);
    
    logger.info(`📱 Browser ${availableBrowser.id} acquired`);
    return availableBrowser;
  }

  async checkBrowserHealth(browserInstance) {
    try {
      // Quick health check - try to get browser version
      const browser = browserInstance.browser;
      if (!browser || !browser.isConnected()) {
        return false;
      }
      
      // Try to get browser version with timeout
      await Promise.race([
        browser.version(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Health check timeout')), 3000))
      ]);
      
      return true;
    } catch (error) {
      logger.warn(`🏥 Browser health check failed for ${browserInstance.id}:`, error.message);
      return false;
    }
  }

  async replaceBrowser(oldBrowserInstance) {
    try {
      const oldIndex = this.browserPool.indexOf(oldBrowserInstance);
      if (oldIndex === -1) return;

      logger.info(`🔄 Replacing unhealthy browser ${oldBrowserInstance.id}...`);
      
      // Close old browser
      await this.closeBrowserSafely(oldBrowserInstance);
      
      // Create new browser
      const newBrowser = await puppeteer.launch(this.launchOptions);
      const newBrowserInstance = {
        id: oldBrowserInstance.id, // Keep same ID
        browser: newBrowser,
        inUse: false,
        createdAt: new Date()
      };
      
      // Replace in pool
      this.browserPool[oldIndex] = newBrowserInstance;
      
      logger.info(`✅ Browser ${oldBrowserInstance.id} replaced successfully`);
      
    } catch (error) {
      logger.error(`❌ Failed to replace browser ${oldBrowserInstance.id}:`, error);
      // Remove the broken browser from pool if replacement fails
      const index = this.browserPool.indexOf(oldBrowserInstance);
      if (index > -1) {
        this.browserPool.splice(index, 1);
      }
      throw error;
    }
  }

  async releaseBrowser(browserInstance) {
    const browser = this.browserPool.find(b => b.id === browserInstance.id);
    if (browser) {
      browser.inUse = false;
      this.busyBrowsers.delete(browser.id);
      logger.info(`📱 Browser ${browser.id} released`);
    }
  }

  async takeSnapshotScreenshot(snapshotId, options = {}) {
    const browserInstance = await this.getBrowser();
    
    try {
      logger.info(`📸 Taking screenshot for snapshot ${snapshotId}`);
      
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
      
      // Capture console messages and errors from the page
      page.on('console', msg => {
        const type = msg.type();
        const text = msg.text();
        if (type === 'error' || type === 'warning') {
          logger.debug(`🌐 Browser Console [${type.toUpperCase()}]: ${text}`);
        }
      });
      
      page.on('pageerror', error => {
        logger.error('🚨 Browser Page Error:', error.message);
      });
      
      page.on('requestfailed', request => {
        logger.debug('⚠️ Browser Request Failed:', request.url(), request.failure()?.errorText);
      });
      
      page.on('response', response => {
        if (!response.ok()) {
          logger.debug('⚠️ Browser Response Error:', response.status(), response.url());
        }
      });
      
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
        
        logger.debug('🔧 DEBUG: Final HTML length:', fullHtml.length);
        logger.debug('🔧 DEBUG: About to load HTML into page...');
        
        // Load the HTML content directly into the page
        await page.setContent(fullHtml, {
          waitUntil: 'domcontentloaded',
          timeout: 30000
        });
        
        logger.debug('🔧 DEBUG: HTML loaded into page successfully');

        // Wait for fonts to load (if available)
        try {
          await page.evaluate(() => {
            if (document.fonts && document.fonts.ready) {
              return document.fonts.ready;
            }
            return Promise.resolve();
          });
        } catch (e) {
          logger.warn('Font loading check failed:', e.message);
        }

        // Wait for images to load with timeout
        try {
          await page.evaluate(() => {
            return new Promise(resolve => {
              const images = Array.from(document.querySelectorAll('img'));
              if (images.length === 0) {
                resolve();
                return;
              }
              
              let loadedImages = 0;
              const totalImages = images.length;
              
              const checkComplete = () => {
                loadedImages++;
                if (loadedImages >= totalImages) {
                  resolve();
                }
              };
              
              images.forEach(img => {
                if (img.complete) {
                  checkComplete();
                } else {
                  img.onload = checkComplete;
                  img.onerror = checkComplete;
                  // Force timeout per image
                  setTimeout(checkComplete, 3000);
                }
              });
              
              // Overall timeout
              setTimeout(resolve, 10000);
            });
          });
        } catch (e) {
          logger.warn('Image loading check failed:', e.message);
        }

        // Simple timeout wait for rendering
        await new Promise(r => setTimeout(r, 12000));
        
        
        // DEBUG: Check page content right before screenshot
        const pageContent = await page.content();
        logger.debug('🔧 DEBUG: Page content length before screenshot:', pageContent.length);
        logger.debug('🔧 DEBUG: Page title:', await page.title());
        
        // DEBUG: Check if there's any visible content
        const hasContent = await page.evaluate(() => {
          const body = document.body;
          const allElements = document.querySelectorAll('*');
          return {
            bodyExists: !!body,
            bodyInnerText: body ? body.innerText?.substring(0, 200) : 'no body',
            totalElements: allElements.length,
            documentReady: document.readyState
          };
        });
        logger.debug('🔧 DEBUG: Page content check:', hasContent);
        
        // Export screenshot HTML to file for debugging
        if (process.env.DEBUG_HEADLESS === 'false') {
          const fs = require('fs');
          const path = require('path');
          const screenshotHtmlFile = path.join('/tmp', `screenshot_html_${snapshotId}.html`);
          fs.writeFileSync(screenshotHtmlFile, pageContent);
          logger.debug('🔧 DEBUG: Screenshot HTML exported to:', screenshotHtmlFile);
        }
        
        logger.debug('🔧 DEBUG: Taking screenshot now...');
        
        // Take PNG screenshot (PNG format works, WebP produces blank images)
        const screenshotBuffer = await page.screenshot({
          fullPage: true,
          type: 'png',
          omitBackground: false
        });
        
        logger.info('📸 Screenshot captured:', {
          size: screenshotBuffer.length,
          format: 'png',
          viewport: `${viewportWidth}x${viewportHeight}`
        });
        
        // Export screenshot to file for debugging
        if (process.env.DEBUG_HEADLESS === 'false') {
          const fs = require('fs');
          const path = require('path');
          const screenshotFile = path.join('/tmp', `debug_screenshot_${snapshotId}.png`);
          fs.writeFileSync(screenshotFile, screenshotBuffer);
          logger.debug('🔧 DEBUG: Screenshot exported to:', screenshotFile);
        }

        // Save screenshot to database
        await this.saveScreenshot(snapshotId, screenshotBuffer, {
          format: 'png',
          width: viewportWidth,
          height: viewportHeight,
          fullPage: true,
          quality: 100,
          method: 'direct_html_load'
        });

        logger.info(`✅ Screenshot saved for snapshot ${snapshotId} (${screenshotBuffer.length} bytes)`);
        
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
      logger.error(`❌ Error taking screenshot for ${snapshotId}:`, error);
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

    // Replace justfly.dev URLs with justfly.com to fix connection issues
    let processedHtml = decompressedSnapshot.html;
    const devUrlCount = (processedHtml.match(/justfly\.dev/g) || []).length;
    
    if (devUrlCount > 0) {
      logger.debug(`🔧 DEBUG: Found ${devUrlCount} justfly.dev URLs, replacing with justfly.com`);
      processedHtml = processedHtml.replace(/justfly\.dev/g, 'justfly.com');
      logger.debug('🔧 DEBUG: URL replacement completed');
    }

    logger.debug('🔧 DEBUG: Using processed HTML');
    logger.debug('🔧 DEBUG: HTML length:', processedHtml.length);
    logger.debug('🔧 DEBUG: HTML preview (first 500 chars):', processedHtml.substring(0, 500));
    
    // Export HTML to file for manual inspection if in debug mode
    if (process.env.DEBUG_HEADLESS === 'false') {
      const fs = require('fs');
      const path = require('path');
      const debugFile = path.join('/tmp', `debug_html_${originalSnapshot.id}.html`);
      fs.writeFileSync(debugFile, processedHtml);
      logger.debug('🔧 DEBUG: Processed HTML exported to:', debugFile);
    }
    
    return processedHtml;
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
    
    logger.debug(`🔧 Alternative HTML built: ${html.length} chars, CSS injected: ${!!decompressedSnapshot.css}`);
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
          logger.error('Error saving screenshot:', err);
          return reject(err);
        }

        logger.debug('Screenshot saved to database:', { 
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
      logger.info(`🧹 Starting cleanup for snapshot: ${snapshotId}`);
      
      // Clean up DOM data from database (keeps metadata and screenshot)
      const result = await this.db.cleanupSnapshotDomData(snapshotId);
      
      logger.info(`✅ Snapshot cleanup completed:`, {
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
      logger.error(`❌ Error during snapshot cleanup for ${snapshotId}:`, error);
      throw error;
    }
  }

  async shutdown() {
    logger.info('🛑 Shutting down browser pool...');
    logger.debug(`🔍 Browsers in pool: ${this.browserPool.length}, Busy browsers: ${this.busyBrowsers.size}`);
    
    try {
      // First, force all busy browsers back to the pool for cleanup
      for (const browserInstance of this.browserPool) {
        if (browserInstance.inUse) {
          logger.warn(`⚠️ Forcing release of busy browser: ${browserInstance.id}`);
          browserInstance.inUse = false;
        }
      }
      this.busyBrowsers.clear();

      // Close all pages first, then browsers
      const closePromises = [];
      
      for (const browserInstance of this.browserPool) {
        if (browserInstance.browser) {
          closePromises.push(this.closeBrowserSafely(browserInstance));
        }
      }

      // Wait for all browsers to close with overall timeout
      await Promise.allSettled(closePromises);
      
      // Clean up internal state
      this.browserPool = [];
      this.busyBrowsers.clear();
      this.isInitialized = false;
      
      // Verification: Check for any remaining Chrome processes
      setTimeout(() => {
        this.verifyCleanup();
      }, 2000);
      
      logger.info('✅ Browser pool shutdown complete');
    } catch (error) {
      logger.error('❌ Error during browser pool shutdown:', error);
    }
  }

  async verifyCleanup() {
    try {
      const { exec } = require('child_process');
      const { promisify } = require('util');
      const execAsync = promisify(exec);
      
      // Check for remaining Chrome processes
      const { stdout } = await execAsync('ps aux | grep -E "(chrome|chromium)" | grep -v grep || echo "No chrome processes found"');
      
      if (stdout.includes('chrome') || stdout.includes('chromium')) {
        logger.warn('⚠️ CLEANUP VERIFICATION: Found remaining Chrome processes:');
        logger.warn(stdout);
      } else {
        logger.info('✅ CLEANUP VERIFICATION: No Chrome processes found - cleanup successful');
      }
    } catch (error) {
      logger.warn('⚠️ Could not verify cleanup:', error.message);
    }
  }

  async closeBrowserSafely(browserInstance) {
    const browserId = browserInstance.id;
    logger.info(`🔒 Closing browser ${browserId}...`);
    
    try {
      const browser = browserInstance.browser;
      
      // Step 1: Close all pages first
      try {
        const pages = await Promise.race([
          browser.pages(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout getting pages')), 3000))
        ]);
        
        logger.debug(`📄 Closing ${pages.length} pages for browser ${browserId}`);
        const pageClosePromises = pages.map(page => 
          Promise.race([
            page.close(),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Page close timeout')), 2000))
          ]).catch(err => logger.warn(`⚠️ Failed to close page in ${browserId}:`, err.message))
        );
        
        await Promise.allSettled(pageClosePromises);
      } catch (error) {
        logger.warn(`⚠️ Failed to close pages for ${browserId}:`, error.message);
      }

      // Step 2: Close browser with timeout
      await Promise.race([
        browser.close(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Browser close timeout')), 5000))
      ]);
      
      logger.info(`✅ Browser ${browserId} closed successfully`);
      
    } catch (error) {
      logger.warn(`⚠️ Failed to close browser ${browserId} gracefully:`, error.message);
      
      // Step 3: Force kill the browser process if graceful close failed
      try {
        const process = browserInstance.browser.process();
        if (process && !process.killed) {
          logger.warn(`💀 Force killing browser process for ${browserId} (PID: ${process.pid})`);
          process.kill('SIGKILL');
          logger.warn(`💀 Browser process ${browserId} force killed`);
        }
      } catch (killError) {
        logger.error(`❌ Failed to force kill browser ${browserId}:`, killError.message);
      }
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