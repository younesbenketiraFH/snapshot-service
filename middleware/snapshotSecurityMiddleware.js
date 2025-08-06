const { logger } = require('../logger');

/**
 * FullStory-style middleware to block API requests from rendered snapshot DOMs
 * while allowing legitimate dashboard and asset requests.
 * 
 * This prevents snapshot content from making API calls, form submissions,
 * or other network requests that could cause side effects.
 */
class SnapshotSecurityMiddleware {
    constructor() {
        this.allowedPaths = new Set([
            '/health',
            '/dashboard',
            '/snapshot',
            '/latest-snapshot',
            '/'
        ]);

        this.allowedPathPrefixes = [
            '/dashboard',
            '/snapshots',
            '/queue',
            '/browser'
        ];

        this.allowedExtensions = new Set([
            '.css',
            '.js', 
            '.html',
            '.ico',
            '.png',
            '.jpg',
            '.jpeg',
            '.gif',
            '.svg',
            '.webp'
        ]);
    }

    /**
     * Main middleware function
     */
    blockSnapshotRequests = (req, res, next) => {
        // Skip security checks for allowed paths
        if (this.isLegitimateRequest(req)) {
            return next();
        }

        // Check if request appears to come from a rendered snapshot
        if (this.isSnapshotOriginatedRequest(req)) {
            logger.warn('🚫 Blocked API request from snapshot DOM:', {
                path: req.path,
                method: req.method,
                userAgent: req.get('User-Agent'),
                referer: req.get('Referer'),
                origin: req.get('Origin'),
                ip: req.ip,
                timestamp: new Date().toISOString()
            });
            
            return res.status(403).json({
                success: false,
                error: 'Access Denied',
                message: 'API requests from DOM snapshots are not permitted',
                code: 'SNAPSHOT_REQUEST_BLOCKED'
            });
        }
        
        next();
    };

    /**
     * Check if request is legitimate (dashboard, assets, etc.)
     */
    isLegitimateRequest(req) {
        const path = req.path.toLowerCase();
        
        // Check exact path matches
        if (this.allowedPaths.has(path)) {
            return true;
        }

        // Check path prefixes  
        for (const prefix of this.allowedPathPrefixes) {
            if (path.startsWith(prefix)) {
                // Additional check: GET requests to snapshots API are OK unless from render endpoint
                if (prefix === '/snapshots' && req.method === 'GET') {
                    const referer = req.get('Referer') || '';
                    return !referer.includes('/render/');
                }
                return true;
            }
        }

        // Check file extensions (static assets)
        for (const ext of this.allowedExtensions) {
            if (path.endsWith(ext)) {
                return true;
            }
        }

        return false;
    }

    /**
     * Detect if request originated from a rendered snapshot DOM
     */
    isSnapshotOriginatedRequest(req) {
        const userAgent = req.get('User-Agent') || '';
        const referer = req.get('Referer') || '';
        const origin = req.get('Origin') || '';
        
        // Check for snapshot-specific indicators
        const snapshotIndicators = [
            // Referer contains snapshot render endpoint
            referer.includes('/render/'),
            
            // Custom headers that snapshots might set
            req.get('X-Snapshot-Request') === 'true',
            req.get('X-Snapshot-Render') === 'true',
            
            // Requests from data URLs (common in snapshots)
            origin.startsWith('data:'),
            referer.startsWith('data:'),
            
            // HeadlessChrome with data URL referer (screenshot generation)
            userAgent.includes('HeadlessChrome') && referer.includes('data:'),
            
            // Cross-site requests that match snapshot patterns
            req.get('Sec-Fetch-Site') === 'same-origin' && referer.match(/\/render\/snapshot_/i),
            
            // Frame options that indicate snapshot rendering
            req.get('X-Frame-Options') === 'ALLOWALL'
        ];

        return snapshotIndicators.some(indicator => indicator);
    }

    /**
     * Add a custom allowed path
     */
    addAllowedPath(path) {
        this.allowedPaths.add(path);
    }

    /**
     * Add a custom allowed path prefix  
     */
    addAllowedPathPrefix(prefix) {
        this.allowedPathPrefixes.push(prefix);
    }

    /**
     * Get middleware statistics
     */
    getStats() {
        return {
            allowedPaths: Array.from(this.allowedPaths),
            allowedPathPrefixes: [...this.allowedPathPrefixes],
            allowedExtensions: Array.from(this.allowedExtensions)
        };
    }
}

module.exports = SnapshotSecurityMiddleware;