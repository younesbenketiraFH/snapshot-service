const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

class Database {
  constructor(dbPath = null) {
    this.dbPath = dbPath || process.env.DATABASE_PATH || path.join(__dirname, 'database', 'snapshots.db');
    this.db = null;
    
    // Ensure database directory exists
    const databaseDir = path.dirname(this.dbPath);
    if (!fs.existsSync(databaseDir)) {
      fs.mkdirSync(databaseDir, { recursive: true });
      console.log('Created database directory:', databaseDir);
    }
  }

  async initialize() {
    return new Promise((resolve, reject) => {
      this.db = new sqlite3.Database(this.dbPath, (err) => {
        if (err) {
          console.error('Error opening database:', err);
          return reject(err);
        }
        
        console.log('Connected to SQLite database:', this.dbPath);
        this.createTables().then(resolve).catch(reject);
      });
    });
  }

  async createTables() {
    return new Promise((resolve, reject) => {
      const createSnapshotsTable = `
        CREATE TABLE IF NOT EXISTS snapshots (
          id TEXT PRIMARY KEY,
          html TEXT,
          css TEXT,
          html_compressed BLOB,
          css_compressed BLOB,
          compression_type TEXT DEFAULT 'none',
          original_html_size INTEGER DEFAULT 0,
          original_css_size INTEGER DEFAULT 0,
          compressed_html_size INTEGER DEFAULT 0,
          compressed_css_size INTEGER DEFAULT 0,
          url TEXT,
          viewport_width INTEGER,
          viewport_height INTEGER,
          options TEXT,
          queue_job_id TEXT,
          processing_status TEXT DEFAULT 'pending',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          processed_at DATETIME
        )
      `;

      const createIndexes = `
        CREATE INDEX IF NOT EXISTS idx_snapshots_created_at ON snapshots(created_at);
        CREATE INDEX IF NOT EXISTS idx_snapshots_url ON snapshots(url);
        CREATE INDEX IF NOT EXISTS idx_snapshots_status ON snapshots(processing_status);
        CREATE INDEX IF NOT EXISTS idx_snapshots_job_id ON snapshots(queue_job_id);
      `;

      this.db.serialize(() => {
        this.db.run(createSnapshotsTable, (err) => {
          if (err) {
            console.error('Error creating snapshots table:', err);
            return reject(err);
          }
        });

        this.db.run(createIndexes, (err) => {
          if (err) {
            console.error('Error creating indexes:', err);
            return reject(err);
          }
          
          console.log('Database tables created successfully');
          resolve();
        });
      });
    });
  }


  async saveSnapshot(snapshotData) {
    return new Promise((resolve, reject) => {
      const { 
        id, html, css, url, viewport, options,
        htmlCompressed, cssCompressed, compressionType,
        originalHtmlSize, originalCssSize,
        compressedHtmlSize, compressedCssSize,
        queueJobId, processingStatus
      } = snapshotData;
      
      const sql = `
        INSERT INTO snapshots (
          id, html, css, html_compressed, css_compressed,
          compression_type, original_html_size, original_css_size,
          compressed_html_size, compressed_css_size,
          url, viewport_width, viewport_height, options,
          queue_job_id, processing_status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;

      const params = [
        id,
        html || null,
        css || null,
        htmlCompressed || null,
        cssCompressed || null,
        compressionType || 'none',
        originalHtmlSize || 0,
        originalCssSize || 0,
        compressedHtmlSize || 0,
        compressedCssSize || 0,
        url || null,
        viewport?.width || null,
        viewport?.height || null,
        options ? JSON.stringify(options) : null,
        queueJobId || null,
        processingStatus || 'pending'
      ];

      this.db.run(sql, params, function(err) {
        if (err) {
          console.error('Error saving snapshot:', err);
          return reject(err);
        }

        console.log('Snapshot saved with ID:', id);
        resolve({ id, rowid: this.lastID });
      });
    });
  }

  async updateSnapshotStatus(id, status, processedAt = null) {
    return new Promise((resolve, reject) => {
      const sql = `
        UPDATE snapshots 
        SET processing_status = ?, processed_at = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `;

      this.db.run(sql, [status, processedAt, id], function(err) {
        if (err) {
          console.error('Error updating snapshot status:', err);
          return reject(err);
        }

        console.log('Updated snapshot status:', { id, status, changes: this.changes });
        resolve({ id, changes: this.changes });
      });
    });
  }

  async getSnapshot(id) {
    return new Promise((resolve, reject) => {
      const sql = 'SELECT * FROM snapshots WHERE id = ?';
      
      this.db.get(sql, [id], (err, row) => {
        if (err) {
          console.error('Error retrieving snapshot:', err);
          return reject(err);
        }

        if (row && row.options) {
          try {
            row.options = JSON.parse(row.options);
          } catch (e) {
            console.warn('Error parsing options JSON:', e);
          }
        }

        resolve(row);
      });
    });
  }

  async getRecentSnapshots(limit = 50) {
    return new Promise((resolve, reject) => {
      const sql = `
        SELECT id, url, viewport_width, viewport_height, created_at, 
               length(html) as html_size, length(css) as css_size
        FROM snapshots 
        ORDER BY created_at DESC 
        LIMIT ?
      `;
      
      this.db.all(sql, [limit], (err, rows) => {
        if (err) {
          console.error('Error retrieving recent snapshots:', err);
          return reject(err);
        }

        resolve(rows);
      });
    });
  }

  close() {
    if (this.db) {
      this.db.close((err) => {
        if (err) {
          console.error('Error closing database:', err);
        } else {
          console.log('Database connection closed');
        }
      });
    }
  }
}

module.exports = Database;