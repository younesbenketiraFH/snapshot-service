const zlib = require('zlib');
const { promisify } = require('util');

// Promisify compression functions
const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);
const brotliCompress = promisify(zlib.brotliCompress);
const brotliDecompress = promisify(zlib.brotliDecompress);

class CompressionUtils {
    static COMPRESSION_TYPES = {
        NONE: 'none',
        GZIP: 'gzip',
        BROTLI: 'brotli'
    };

    /**
     * Compress text using the specified algorithm
     * @param {string} text - Text to compress
     * @param {string} type - Compression type ('gzip' or 'brotli')
     * @returns {Object} - { compressed: Buffer, originalSize: number, compressedSize: number, compressionRatio: number }
     */
    static async compress(text, type = 'brotli') {
        if (!text || typeof text !== 'string') {
            throw new Error('Text must be a non-empty string');
        }

        const originalBuffer = Buffer.from(text, 'utf8');
        const originalSize = originalBuffer.length;
        
        let compressed;
        
        try {
            switch (type) {
                case this.COMPRESSION_TYPES.GZIP:
                    compressed = await gzip(originalBuffer, {
                        level: zlib.constants.Z_BEST_COMPRESSION,
                        windowBits: 15,
                        memLevel: 8
                    });
                    break;
                    
                case this.COMPRESSION_TYPES.BROTLI:
                    compressed = await brotliCompress(originalBuffer, {
                        params: {
                            [zlib.constants.BROTLI_PARAM_QUALITY]: 11, // Maximum compression
                            [zlib.constants.BROTLI_PARAM_SIZE_HINT]: originalSize
                        }
                    });
                    break;
                    
                default:
                    throw new Error(`Unsupported compression type: ${type}`);
            }
        } catch (error) {
            console.error(`Compression error (${type}):`, error);
            throw new Error(`Failed to compress with ${type}: ${error.message}`);
        }

        const compressedSize = compressed.length;
        const compressionRatio = ((originalSize - compressedSize) / originalSize * 100).toFixed(2);

        console.log(`Compression stats (${type}):`, {
            originalSize,
            compressedSize,
            compressionRatio: `${compressionRatio}%`
        });

        return {
            compressed,
            originalSize,
            compressedSize,
            compressionRatio: parseFloat(compressionRatio),
            type
        };
    }

    /**
     * Decompress data using the specified algorithm
     * @param {Buffer} compressedData - Compressed data buffer
     * @param {string} type - Compression type ('gzip' or 'brotli')
     * @returns {string} - Decompressed text
     */
    static async decompress(compressedData, type = 'brotli') {
        if (!Buffer.isBuffer(compressedData)) {
            throw new Error('Compressed data must be a Buffer');
        }

        let decompressed;
        
        try {
            switch (type) {
                case this.COMPRESSION_TYPES.GZIP:
                    decompressed = await gunzip(compressedData);
                    break;
                    
                case this.COMPRESSION_TYPES.BROTLI:
                    decompressed = await brotliDecompress(compressedData);
                    break;
                    
                default:
                    throw new Error(`Unsupported compression type: ${type}`);
            }
        } catch (error) {
            console.error(`Decompression error (${type}):`, error);
            throw new Error(`Failed to decompress with ${type}: ${error.message}`);
        }

        return decompressed.toString('utf8');
    }

    /**
     * Compress snapshot data (HTML and CSS)
     * @param {Object} snapshotData - Object containing html and css
     * @param {string} compressionType - 'gzip' or 'brotli'
     * @returns {Object} - Compressed snapshot data with metadata
     */
    static async compressSnapshot(snapshotData, compressionType = 'brotli') {
        const { html, css } = snapshotData;
        const startTime = Date.now();
        
        console.log('Compressing snapshot:', {
            htmlSize: html?.length || 0,
            cssSize: css?.length || 0,
            compressionType
        });

        const result = {
            ...snapshotData,
            compressionType,
            originalHtmlSize: html?.length || 0,
            originalCssSize: css?.length || 0
        };

        try {
            // Compress HTML
            if (html) {
                const htmlCompression = await this.compress(html, compressionType);
                result.htmlCompressed = htmlCompression.compressed;
                result.compressedHtmlSize = htmlCompression.compressedSize;
                result.htmlCompressionRatio = htmlCompression.compressionRatio;
            }

            // Compress CSS
            if (css) {
                const cssCompression = await this.compress(css, compressionType);
                result.cssCompressed = cssCompression.compressed;
                result.compressedCssSize = cssCompression.compressedSize;
                result.cssCompressionRatio = cssCompression.compressionRatio;
            }

            const compressionTime = Date.now() - startTime;
            const totalOriginalSize = result.originalHtmlSize + result.originalCssSize;
            const totalCompressedSize = result.compressedHtmlSize + result.compressedCssSize;
            const overallRatio = totalOriginalSize > 0 ? 
                ((totalOriginalSize - totalCompressedSize) / totalOriginalSize * 100).toFixed(2) : 0;

            result.compressionStats = {
                totalOriginalSize,
                totalCompressedSize,
                overallCompressionRatio: parseFloat(overallRatio),
                compressionTimeMs: compressionTime
            };

            console.log('Snapshot compression completed:', {
                totalOriginalSize,
                totalCompressedSize,
                overallRatio: `${overallRatio}%`,
                compressionTimeMs: compressionTime
            });

            return result;

        } catch (error) {
            console.error('Snapshot compression failed:', error);
            throw new Error(`Snapshot compression failed: ${error.message}`);
        }
    }

    /**
     * Decompress snapshot data
     * @param {Object} compressedSnapshot - Compressed snapshot from database
     * @returns {Object} - Decompressed snapshot with html and css as strings
     */
    static async decompressSnapshot(compressedSnapshot) {
        const { 
            htmlCompressed, 
            cssCompressed, 
            compression_type: compressionType 
        } = compressedSnapshot;
        
        const startTime = Date.now();
        
        console.log('Decompressing snapshot:', {
            id: compressedSnapshot.id,
            compressionType,
            hasHtml: !!htmlCompressed,
            hasCss: !!cssCompressed
        });

        try {
            const result = { ...compressedSnapshot };

            // Decompress HTML
            if (htmlCompressed) {
                result.html = await this.decompress(htmlCompressed, compressionType);
            }

            // Decompress CSS
            if (cssCompressed) {
                result.css = await this.decompress(cssCompressed, compressionType);
            }

            const decompressionTime = Date.now() - startTime;
            
            console.log('Snapshot decompression completed:', {
                id: compressedSnapshot.id,
                decompressionTimeMs: decompressionTime,
                htmlLength: result.html?.length || 0,
                cssLength: result.css?.length || 0
            });

            return result;

        } catch (error) {
            console.error('Snapshot decompression failed:', error);
            throw new Error(`Snapshot decompression failed: ${error.message}`);
        }
    }

    /**
     * Get compression statistics for different algorithms
     * @param {string} text - Text to analyze
     * @returns {Object} - Comparison of compression algorithms
     */
    static async getCompressionStats(text) {
        if (!text) return {};

        const originalSize = Buffer.from(text, 'utf8').length;
        const stats = { originalSize };

        try {
            // Test Gzip
            const gzipResult = await this.compress(text, 'gzip');
            stats.gzip = {
                compressedSize: gzipResult.compressedSize,
                compressionRatio: gzipResult.compressionRatio
            };

            // Test Brotli
            const brotliResult = await this.compress(text, 'brotli');
            stats.brotli = {
                compressedSize: brotliResult.compressedSize,
                compressionRatio: brotliResult.compressionRatio
            };

            // Recommend best compression
            stats.recommendation = stats.brotli.compressedSize < stats.gzip.compressedSize ? 'brotli' : 'gzip';

        } catch (error) {
            console.error('Error getting compression stats:', error);
        }

        return stats;
    }
}

module.exports = CompressionUtils;