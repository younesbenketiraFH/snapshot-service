class SnapshotDashboard {
    constructor() {
        this.snapshots = [];
        this.filteredSnapshots = [];
        this.currentSnapshot = null;
        this.zoomLevel = 1.0;
        this.viewMode = 'screenshot';
        
        this.init();
    }

    init() {
        this.bindEvents();
        this.loadSnapshots();
    }

    bindEvents() {
        // Navigation
        document.getElementById('back-btn').addEventListener('click', () => this.showSnapshotsList());
        document.getElementById('refresh-btn').addEventListener('click', () => this.loadSnapshots());
        
        const deleteBtn = document.getElementById('delete-all-btn');
        if (deleteBtn) {
            deleteBtn.addEventListener('click', () => {
                this.deleteAllSnapshots();
            });
        }
        
        // Filters
        document.getElementById('url-filter').addEventListener('input', (e) => this.filterSnapshots());
        document.getElementById('date-filter').addEventListener('change', (e) => this.filterSnapshots());
        
        // Tab controls
        document.getElementById('screenshot-tab').addEventListener('click', () => this.showScreenshotTab());
        document.getElementById('screenshot-data-tab').addEventListener('click', () => this.showScreenshotDataTab());
        
        // Replay screenshot button (will be bound when snapshot is loaded)
        this.replayButtonHandler = null;
    }

    async loadSnapshots() {
        try {
            document.getElementById('results-count').textContent = 'Loading...';
            
            const response = await fetch('/snapshots');
            const data = await response.json();
            
            if (data.success) {
                this.snapshots = data.snapshots;
                this.filteredSnapshots = [...this.snapshots];
                this.renderSnapshots();
                this.updateResultsCount();
            } else {
                this.showError('Failed to load snapshots');
            }
        } catch (error) {
            console.error('Error loading snapshots:', error);
            this.showError('Error loading snapshots');
        }
    }

    filterSnapshots() {
        const urlFilter = document.getElementById('url-filter').value.toLowerCase();
        const dateFilter = document.getElementById('date-filter').value;
        
        let filtered = this.snapshots.filter(snapshot => {
            // URL filter
            const urlMatch = !urlFilter || (snapshot.url && snapshot.url.toLowerCase().includes(urlFilter));
            
            // Date filter
            let dateMatch = true;
            if (dateFilter) {
                const snapshotDate = new Date(snapshot.created_at);
                const now = new Date();
                
                switch (dateFilter) {
                    case 'today':
                        dateMatch = snapshotDate.toDateString() === now.toDateString();
                        break;
                    case 'week':
                        const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
                        dateMatch = snapshotDate >= weekAgo;
                        break;
                    case 'month':
                        const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
                        dateMatch = snapshotDate >= monthAgo;
                        break;
                }
            }
            
            return urlMatch && dateMatch;
        });
        
        this.filteredSnapshots = filtered;
        this.renderSnapshots();
        this.updateResultsCount();
    }

    renderSnapshots() {
        const container = document.getElementById('snapshots-list');
        
        if (this.filteredSnapshots.length === 0) {
            container.innerHTML = '<div class="loading">No snapshots found</div>';
            return;
        }
        
        container.innerHTML = this.filteredSnapshots.map(snapshot => `
            <div class="snapshot-card" data-id="${snapshot.id}">
                <div class="snapshot-card-header">
                    <div class="snapshot-id">${this.truncateId(snapshot.id)}</div>
                    <div class="snapshot-timestamp">${this.formatTimestampEST(snapshot.created_at)}</div>
                </div>
                <div class="snapshot-url">${snapshot.url || 'No URL available'}</div>
                <div class="snapshot-meta">
                    <div class="meta-item">
                        <span class="meta-label">Viewport</span>
                        ${snapshot.viewport_width}x${snapshot.viewport_height}
                    </div>
                    <div class="meta-item">
                        <span class="meta-label">Search ID</span>
                        ${snapshot.search_id || '—'}
                    </div>
                    <div class="meta-item">
                        <span class="meta-label">Type</span>
                        ${snapshot.type || '—'}
                    </div>
                    <div class="meta-item">
                        <span class="meta-label">HTML Size</span>
                        ${this.formatBytes(snapshot.html_size)}
                    </div>
                    <div class="meta-item">
                        <span class="meta-label">CSS Size</span>
                        ${this.formatBytes(snapshot.css_size)}
                    </div>
                </div>
            </div>
        `).join('');
        
        // Add click handlers
        container.querySelectorAll('.snapshot-card').forEach(card => {
            card.addEventListener('click', (e) => {
                const id = card.dataset.id;
                this.viewSnapshot(id);
            });
        });
    }

    async viewSnapshot(id) {
        try {
            const response = await fetch(`/snapshots/${id}`);
            const data = await response.json();
            
            if (data.success) {
                this.currentSnapshot = data.snapshot;
                this.showSnapshotViewer();
                this.renderSnapshotViewer();
            } else {
                this.showError('Failed to load snapshot');
            }
        } catch (error) {
            console.error('Error loading snapshot:', error);
            this.showError('Error loading snapshot');
        }
    }

    renderSnapshotViewer() {
        const snapshot = this.currentSnapshot;
        
        // Update title and metadata
        document.getElementById('snapshot-title').textContent = `Snapshot: ${this.truncateId(snapshot.id)}`;
        
        // Render metadata (hide missing fields and drop HTML/CSS sizes)
        const metadataContainer = document.getElementById('snapshot-metadata');
        const items = [];
        items.push(`
            <div class="metadata-item">
                <div class="metadata-label">Snapshot ID</div>
                <div class="metadata-value">${snapshot.id}</div>
            </div>
        `);
        items.push(`
            <div class="metadata-item">
                <div class="metadata-label">Captured URL</div>
                <div class="metadata-value">${snapshot.url || 'Not available'}</div>
            </div>
        `);
        items.push(`
            <div class="metadata-item">
                <div class="metadata-label">Timestamp</div>
                <div class="metadata-value">
                    <div><strong>UTC</strong></div>
                    <div>${this.formatTimestampUTC(snapshot.created_at)}</div>
                    <div style="margin-top:6px;"><strong>EST/EDT</strong></div>
                    <div>${this.formatTimestampEST(snapshot.created_at)}</div>
                </div>
            </div>
        `);
        if (snapshot.viewport_width && snapshot.viewport_height) {
            items.push(`
                <div class="metadata-item">
                    <div class="metadata-label">Viewport Size</div>
                    <div class="metadata-value">${snapshot.viewport_width}x${snapshot.viewport_height}px</div>
                </div>
            `);
        }
        // Always show key identifiers; display NULL if missing
        items.push(`
            <div class="metadata-item">
                <div class="metadata-label">Type</div>
                <div class="metadata-value">${snapshot.type || 'NULL'}</div>
            </div>
        `);
        // Show all clientDataDuringSnapshot fields if present
        const client = snapshot.options?.clientData || snapshot.options?.clientDataDuringSnapshot;
        if (client) {
            const pairs = Object.entries(client);
            pairs.forEach(([k, v]) => {
                const safeK = String(k);
                let safeV;
                if (v == null) {
                    safeV = 'NULL';
                } else if (typeof v === 'object') {
                    try { safeV = JSON.stringify(v); } catch { safeV = String(v); }
                } else {
                    safeV = String(v);
                }
                items.push(`
                    <div class="metadata-item">
                        <div class="metadata-label">client.${safeK}</div>
                        <div class="metadata-value">${safeV}</div>
                    </div>
                `);
            });
        }
        items.push(`
            <div class="metadata-item">
                <div class="metadata-label">Search ID</div>
                <div class="metadata-value">${snapshot.search_id || 'NULL'}</div>
            </div>
        `);
        items.push(`
            <div class="metadata-item">
                <div class="metadata-label">Checkout ID</div>
                <div class="metadata-value">${snapshot.checkout_id || 'NULL'}</div>
            </div>
        `);
        items.push(`
            <div class="metadata-item">
                <div class="metadata-label">Cart ID</div>
                <div class="metadata-value">${snapshot.cart_id || 'NULL'}</div>
            </div>
        `);
        items.push(`
            <div class="metadata-item">
                <div class="metadata-label">Site ID</div>
                <div class="metadata-value">${snapshot.site_id || 'NULL'}</div>
            </div>
        `);
        items.push(`
            <div class="metadata-item">
                <div class="metadata-label">Hash Key</div>
                <div class="metadata-value">${snapshot.hash_key || 'NULL'}</div>
            </div>
        `);
        metadataContainer.innerHTML = `<div class="metadata-grid">${items.join('\n')}</div>`;
        
        // Load screenshot tab by default
        this.loadScreenshot();
        
        // Bind replay screenshot button
        this.bindReplayScreenshotButton();
    }


    showScreenshotTab() {
        this.setActiveTab('screenshot');
        this.loadScreenshot();
    }

    showScreenshotDataTab() {
        this.setActiveTab('screenshot-data');
        this.loadScreenshotData();
    }

    setActiveTab(activeTabName) {
        // Update tab buttons
        const tabs = ['screenshot', 'screenshot-data'];
        tabs.forEach(tab => {
            const tabBtn = document.getElementById(`${tab}-tab`);
            const tabContent = document.getElementById(`${tab}-content`);
            
            if (tab === activeTabName) {
                tabBtn.classList.add('active');
                tabContent.classList.add('active');
            } else {
                tabBtn.classList.remove('active');
                tabContent.classList.remove('active');
            }
        });
    }



    showSnapshotsList() {
        document.getElementById('snapshots-view').style.display = 'block';
        document.getElementById('snapshot-view').style.display = 'none';
        
        // Clean up screenshot
        const screenshotImage = document.getElementById('screenshot-image');
        screenshotImage.style.display = 'none';
        screenshotImage.src = '';
    }

    showSnapshotViewer() {
        document.getElementById('snapshots-view').style.display = 'none';
        document.getElementById('snapshot-view').style.display = 'block';
        
    }

    updateResultsCount() {
        const count = this.filteredSnapshots.length;
        const total = this.snapshots.length;
        document.getElementById('results-count').textContent = 
            `${count} of ${total} snapshots`;
    }

    showError(message) {
        document.getElementById('snapshots-list').innerHTML = 
            `<div class="loading">Error: ${message}</div>`;
    }

    // Custom confirmation dialog to bypass browser settings
    showConfirmDialog(title, message) {
        return new Promise((resolve) => {
            // Create modal overlay
            const overlay = document.createElement('div');
            overlay.style.cssText = `
                position: fixed;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                background: rgba(0, 0, 0, 0.5);
                display: flex;
                align-items: center;
                justify-content: center;
                z-index: 10000;
                font-family: inherit;
            `;
            
            // Create modal dialog
            const modal = document.createElement('div');
            modal.style.cssText = `
                background: white;
                padding: 2rem;
                border-radius: 12px;
                max-width: 500px;
                width: 90%;
                box-shadow: 0 20px 40px rgba(0, 0, 0, 0.3);
                text-align: center;
            `;
            
            modal.innerHTML = `
                <h3 style="color: #dc3545; margin-bottom: 1rem; font-size: 1.5rem;">${title}</h3>
                <p style="margin-bottom: 2rem; white-space: pre-line; color: #333; line-height: 1.5;">${message}</p>
                <div style="display: flex; gap: 1rem; justify-content: center;">
                    <button id="confirm-cancel" style="
                        padding: 0.75rem 1.5rem;
                        border: 1px solid #6c757d;
                        background: white;
                        color: #6c757d;
                        border-radius: 6px;
                        cursor: pointer;
                        font-size: 1rem;
                    ">Cancel</button>
                    <button id="confirm-ok" style="
                        padding: 0.75rem 1.5rem;
                        border: none;
                        background: #dc3545;
                        color: white;
                        border-radius: 6px;
                        cursor: pointer;
                        font-size: 1rem;
                        font-weight: 600;
                    ">Delete All</button>
                </div>
            `;
            
            overlay.appendChild(modal);
            document.body.appendChild(overlay);
            
            // Handle button clicks
            const handleResult = (result) => {
                document.body.removeChild(overlay);
                resolve(result);
            };
            
            modal.querySelector('#confirm-ok').addEventListener('click', () => handleResult(true));
            modal.querySelector('#confirm-cancel').addEventListener('click', () => handleResult(false));
            
            // Close on overlay click
            overlay.addEventListener('click', (e) => {
                if (e.target === overlay) {
                    handleResult(false);
                }
            });
            
            // Close on Escape key
            const handleKeydown = (e) => {
                if (e.key === 'Escape') {
                    document.removeEventListener('keydown', handleKeydown);
                    handleResult(false);
                }
            };
            document.addEventListener('keydown', handleKeydown);
        });
    }

    // Utility functions
    truncateId(id) {
        return id.length > 20 ? id.substring(0, 20) + '...' : id;
    }

    formatTimestamp(timestamp) {
        const date = new Date(timestamp);
        return date.toLocaleString();
    }

    formatTimestampEST(timestamp) {
        const date = new Date(timestamp);
        return date.toLocaleString('en-US', {
            timeZone: 'America/New_York',
            year: 'numeric', month: 'short', day: '2-digit',
            hour: '2-digit', minute: '2-digit', second: '2-digit'
        });
    }

    formatTimestampUTC(timestamp) {
        const date = new Date(timestamp);
        return date.toLocaleString('en-US', {
            timeZone: 'UTC',
            year: 'numeric', month: 'short', day: '2-digit',
            hour: '2-digit', minute: '2-digit', second: '2-digit'
        });
    }

    formatBytes(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    // Screenshot functionality
    async loadScreenshot() {
        const snapshot = this.currentSnapshot;
        const screenshotStatus = document.getElementById('screenshot-status');
        const screenshotImage = document.getElementById('screenshot-image');
        
        try {
            screenshotStatus.innerHTML = '<div class="loading">Loading screenshot...</div>';
            screenshotImage.style.display = 'none';
            
            const response = await fetch(`/snapshots/${snapshot.id}/screenshot`);
            
            if (response.ok) {
                // Screenshot exists
                const blob = await response.blob();
                const imageUrl = URL.createObjectURL(blob);
                
                screenshotImage.onload = () => {
                    screenshotStatus.style.display = 'none';
                };
                
                screenshotImage.onerror = (error) => {
                    console.error('❌ Screenshot image failed to load:', error);
                    screenshotStatus.innerHTML = `
                        <div class="error">
                            <p>❌ Failed to display screenshot</p>
                            <p>Image may be corrupted</p>
                        </div>
                    `;
                };
                
                screenshotImage.src = imageUrl;
                screenshotImage.style.display = 'block';
                
                console.log('Screenshot loaded successfully');
            } else if (response.status === 404) {
                // No screenshot exists
                screenshotStatus.innerHTML = `
                    <div class="no-screenshot">
                        <p>📷 No screenshot available for this snapshot</p>
                        <p>Screenshot may still be processing...</p>
                    </div>
                `;
            } else {
                throw new Error(`Failed to load screenshot: ${response.status}`);
            }
        } catch (error) {
            console.error('Error loading screenshot:', error);
            screenshotStatus.innerHTML = `
                <div class="error">
                    <p>❌ Error loading screenshot</p>
                    <p>${error.message}</p>
                </div>
            `;
        }
    }




    async deleteAllSnapshots() {
        console.log('🗑️ Delete all button clicked');
        
        // Show custom confirmation dialog to bypass browser "don't ask again" settings
        const confirmed = await this.showConfirmDialog(
            'Delete All Snapshots',
            '⚠️ WARNING: This will permanently delete ALL snapshots from the database.\n\n' +
            'This action cannot be undone. Are you sure you want to continue?'
        );
        
        console.log('Confirmation result:', confirmed);
        
        if (!confirmed) {
            return;
        }
        
        const button = document.getElementById('delete-all-btn');
        const originalText = button.textContent;
        
        try {
            button.disabled = true;
            button.textContent = '⏳ Deleting...';
            
            console.log('Deleting all snapshots...');
            
            const response = await fetch('/snapshots', {
                method: 'DELETE',
                headers: {
                    'Content-Type': 'application/json'
                }
            });
            
            const data = await response.json();
            
            if (data.success) {
                console.log('All snapshots deleted successfully:', data);
                button.textContent = '✅ Deleted!';
                
                // Reload the snapshots list
                setTimeout(() => {
                    this.loadSnapshots();
                    button.textContent = originalText;
                    button.disabled = false;
                    
                    // Show success message
                    alert(`✅ Successfully deleted ${data.deletedCount} snapshots`);
                }, 1000);
            } else {
                throw new Error(data.message || 'Failed to delete snapshots');
            }
        } catch (error) {
            console.error('Error deleting all snapshots:', error);
            button.textContent = '❌ Failed';
            setTimeout(() => {
                button.textContent = originalText;
                button.disabled = false;
            }, 2000);
            
            alert(`❌ Failed to delete snapshots: ${error.message}`);
        }
    }

    async loadScreenshotData() {
        if (!this.currentSnapshot?.id) return;

        try {
            // Load snapshot data with screenshot info
            const response = await fetch(`/snapshots/${this.currentSnapshot.id}`);
            const data = await response.json();
            
            if (data.success && data.snapshot) {
                const snapshot = data.snapshot;
                
                // Update Screenshot Metadata
                this.displayScreenshotMetadata(snapshot);
                
                // Load and analyze screenshot binary data
                await this.loadScreenshotBinaryData(this.currentSnapshot.id);
                
                // Display processing status
                this.displayProcessingStatus(snapshot);
                
                // Set up refresh button
                document.getElementById('refresh-screenshot-data-btn').onclick = () => this.loadScreenshotData();
                
            } else {
                this.displayError('Failed to load snapshot data');
            }
            
        } catch (error) {
            console.error('Error loading screenshot data:', error);
            this.displayError('Error loading screenshot data');
        }
    }
    
    displayScreenshotMetadata(snapshot) {
        const metadata = {
            'Screenshot Size (bytes)': snapshot.screenshot_size || 'NULL',
            'Screenshot Format': snapshot.screenshot_format || 'NULL', 
            'Screenshot Width': snapshot.screenshot_width || 'NULL',
            'Screenshot Height': snapshot.screenshot_height || 'NULL',
            'Screenshot Taken At': snapshot.screenshot_taken_at || 'NULL',
            'Screenshot Metadata': snapshot.screenshot_metadata || 'NULL',
            'Processing Status': snapshot.processing_status || 'NULL',
            'Queue Job ID': snapshot.queue_job_id || 'NULL'
        };
        
        let html = '';
        for (const [key, value] of Object.entries(metadata)) {
            const valueClass = value === 'NULL' ? 'data-null' : (typeof value === 'number' ? 'data-number' : 'data-value');
            html += `<span class="data-key">${key}:</span> <span class="${valueClass}">${value}</span>\n`;
        }
        
        document.getElementById('screenshot-metadata').innerHTML = html;
    }
    
    async loadScreenshotBinaryData(snapshotId) {
        try {
            const response = await fetch(`/snapshots/${snapshotId}/screenshot`);
            
            if (response.ok) {
                const blob = await response.blob();
                const arrayBuffer = await blob.arrayBuffer();
                const uint8Array = new Uint8Array(arrayBuffer);
                
                // Display binary analysis
                const analysis = {
                    'Binary Size': `${arrayBuffer.byteLength} bytes`,
                    'First 4 bytes (hex)': this.bytesToHex(uint8Array.slice(0, 4)),
                    'File signature': this.detectFileType(uint8Array),
                    'Content-Type': response.headers.get('content-type') || 'Unknown'
                };
                
                let html = '';
                for (const [key, value] of Object.entries(analysis)) {
                    html += `<span class="data-key">${key}:</span> <span class="data-value">${value}</span>\n`;
                }
                
                // Add byte preview
                html += '\n\n<span class="data-key">First 64 bytes (hex):</span>\n';
                html += `<div class="byte-preview">${this.bytesToHex(uint8Array.slice(0, 64))}</div>`;
                
                document.getElementById('screenshot-binary-info').innerHTML = html;
                
                // Display raw data preview
                const preview = `URL: /snapshots/${snapshotId}/screenshot
Content-Type: ${response.headers.get('content-type')}
Content-Length: ${response.headers.get('content-length')}
Status: ${response.status} ${response.statusText}

Binary data available: YES
Size: ${arrayBuffer.byteLength} bytes
First 32 bytes: ${this.bytesToHex(uint8Array.slice(0, 32))}`;
                
                document.getElementById('screenshot-raw-preview').innerHTML = preview;
                
            } else {
                document.getElementById('screenshot-binary-info').innerHTML = `<span class="status-error">No screenshot data available</span>\nHTTP Status: ${response.status} ${response.statusText}`;
                document.getElementById('screenshot-raw-preview').innerHTML = `<span class="status-error">Screenshot endpoint returned: ${response.status} ${response.statusText}</span>`;
            }
            
        } catch (error) {
            document.getElementById('screenshot-binary-info').innerHTML = `<span class="status-error">Error loading binary data: ${error.message}</span>`;
            document.getElementById('screenshot-raw-preview').innerHTML = `<span class="status-error">Failed to fetch screenshot data</span>`;
        }
    }
    
    displayProcessingStatus(snapshot) {
        const status = snapshot.processing_status || 'unknown';
        const statusClass = {
            'completed': 'status-success',
            'processing': 'status-info',
            'queued': 'status-warning',
            'pending': 'status-warning',
            'failed': 'status-error'
        }[status] || 'status-warning';
        
        let html = `<span class="data-key">Processing Status:</span> <span class="${statusClass}">${status.toUpperCase()}</span>\n`;
        html += `<span class="data-key">Created At:</span> <span class="data-value">${snapshot.created_at}</span>\n`;
        html += `<span class="data-key">Updated At:</span> <span class="data-value">${snapshot.updated_at || 'NULL'}</span>\n`;
        html += `<span class="data-key">Processed At:</span> <span class="data-value">${snapshot.processed_at || 'NULL'}</span>\n`;
        
        document.getElementById('screenshot-processing-status').innerHTML = html;
    }
    
    displayError(message) {
        document.getElementById('screenshot-metadata').innerHTML = `<span class="status-error">${message}</span>`;
        document.getElementById('screenshot-binary-info').innerHTML = `<span class="status-error">${message}</span>`;
        document.getElementById('screenshot-processing-status').innerHTML = `<span class="status-error">${message}</span>`;
        document.getElementById('screenshot-raw-preview').innerHTML = `<span class="status-error">${message}</span>`;
    }
    
    bytesToHex(bytes) {
        return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join(' ');
    }
    
    detectFileType(bytes) {
        if (bytes.length < 4) return 'Unknown';
        
        // WebP signature
        if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46) {
            return 'WebP (RIFF container)';
        }
        
        // PNG signature
        if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) {
            return 'PNG';
        }
        
        // JPEG signature
        if (bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF) {
            return 'JPEG';
        }
        
        return `Unknown (${this.bytesToHex(bytes.slice(0, 4))})`;
    }
    
    

    bindReplayScreenshotButton() {
        const replayBtn = document.getElementById('replay-screenshot-btn');
        if (replayBtn && this.currentSnapshot) {
            // Remove previous handler if exists
            if (this.replayButtonHandler) {
                replayBtn.removeEventListener('click', this.replayButtonHandler);
            }
            
            // Create new handler
            this.replayButtonHandler = () => this.replayScreenshot();
            replayBtn.addEventListener('click', this.replayButtonHandler);
        }
    }
    
    async replayScreenshot() {
        if (!this.currentSnapshot?.id) {
            console.error('No current snapshot to replay');
            return;
        }
        
        const replayBtn = document.getElementById('replay-screenshot-btn');
        const originalText = replayBtn.textContent;
        
        try {
            replayBtn.disabled = true;
            replayBtn.textContent = '⏳ Replaying...';
            
            console.log(`🔄 Replaying screenshot for snapshot: ${this.currentSnapshot.id}`);
            
            const response = await fetch(`/snapshots/${this.currentSnapshot.id}/replay-screenshot`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                }
            });
            
            const data = await response.json();
            
            if (data.success) {
                console.log('Screenshot replay initiated successfully:', data);
                replayBtn.textContent = '✅ Replayed!';
                
                // Refresh the screenshot after a delay
                setTimeout(() => {
                    this.loadScreenshot();
                    replayBtn.textContent = originalText;
                    replayBtn.disabled = false;
                }, 2000);
            } else {
                throw new Error(data.message || 'Failed to replay screenshot');
            }
            
        } catch (error) {
            console.error('Error replaying screenshot:', error);
            replayBtn.textContent = '❌ Failed';
            setTimeout(() => {
                replayBtn.textContent = originalText;
                replayBtn.disabled = false;
            }, 2000);
            
            alert(`❌ Failed to replay screenshot: ${error.message}`);
        }
    }
}

// Initialize dashboard when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    console.log('DOM loaded, initializing dashboard');
    try {
        const dashboard = new SnapshotDashboard();
        console.log('Dashboard initialized successfully');
    } catch (error) {
        console.error('Failed to initialize dashboard:', error);
    }
});