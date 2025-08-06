class SnapshotDashboard {
    constructor() {
        this.snapshots = [];
        this.filteredSnapshots = [];
        this.currentSnapshot = null;
        this.zoomLevel = 1.0;
        
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
        
        // Filters
        document.getElementById('url-filter').addEventListener('input', (e) => this.filterSnapshots());
        document.getElementById('date-filter').addEventListener('change', (e) => this.filterSnapshots());
        
        // Snapshot viewer controls
        document.getElementById('exact-viewport').addEventListener('change', (e) => this.toggleExactViewport());
        document.getElementById('zoom-in').addEventListener('click', () => this.adjustZoom(0.1));
        document.getElementById('zoom-out').addEventListener('click', () => this.adjustZoom(-0.1));
        document.getElementById('zoom-reset').addEventListener('click', () => this.resetZoom());
        document.getElementById('fullscreen-btn').addEventListener('click', () => this.toggleFullscreen());
        document.getElementById('download-btn').addEventListener('click', () => this.downloadSnapshot());
        document.getElementById('open-direct-btn').addEventListener('click', () => this.openDirect());
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
                    <div class="snapshot-timestamp">${this.formatTimestamp(snapshot.created_at)}</div>
                </div>
                <div class="snapshot-url">${snapshot.url || 'No URL available'}</div>
                <div class="snapshot-meta">
                    <div class="meta-item">
                        <span class="meta-label">Viewport</span>
                        ${snapshot.viewport_width}x${snapshot.viewport_height}
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
        document.getElementById('original-dimensions').textContent = `${snapshot.viewport_width}x${snapshot.viewport_height}`;
        
        // Render metadata
        const metadataContainer = document.getElementById('snapshot-metadata');
        metadataContainer.innerHTML = `
            <div class="metadata-grid">
                <div class="metadata-item">
                    <div class="metadata-label">Snapshot ID</div>
                    <div class="metadata-value">${snapshot.id}</div>
                </div>
                <div class="metadata-item">
                    <div class="metadata-label">Captured URL</div>
                    <div class="metadata-value">${snapshot.url || 'Not available'}</div>
                </div>
                <div class="metadata-item">
                    <div class="metadata-label">Timestamp</div>
                    <div class="metadata-value">${this.formatTimestamp(snapshot.created_at)}</div>
                </div>
                <div class="metadata-item">
                    <div class="metadata-label">Viewport Size</div>
                    <div class="metadata-value">${snapshot.viewport_width}x${snapshot.viewport_height}px</div>
                </div>
                <div class="metadata-item">
                    <div class="metadata-label">HTML Size</div>
                    <div class="metadata-value">${this.formatBytes(snapshot.html?.length || 0)}</div>
                </div>
                <div class="metadata-item">
                    <div class="metadata-label">CSS Size</div>
                    <div class="metadata-value">${this.formatBytes(snapshot.css?.length || 0)}</div>
                </div>
            </div>
        `;
        
        // Render the exact snapshot in iframe - CRITICAL FOR LEGAL ACCURACY
        this.renderExactSnapshot();
    }

    renderExactSnapshot() {
        const snapshot = this.currentSnapshot;
        const iframe = document.getElementById('snapshot-frame');
        
        console.log('Rendering snapshot via server endpoint:', {
            id: snapshot.id,
            htmlLength: snapshot.html?.length || 0,
            cssLength: snapshot.css?.length || 0,
            viewport: `${snapshot.viewport_width}x${snapshot.viewport_height}`
        });
        
        // Use server-side rendering endpoint for legal accuracy
        const renderUrl = `/render/${snapshot.id}`;
        
        // Configure iframe for exact rendering
        iframe.onload = () => {
            console.log('Snapshot iframe loaded successfully via server endpoint');
            
            // Verify the content loaded correctly
            try {
                const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
                console.log('Iframe document title:', iframeDoc.title);
                console.log('Legal evidence attributes:', {
                    legalSnapshot: iframeDoc.documentElement.getAttribute('data-legal-snapshot'),
                    captureTime: iframeDoc.documentElement.getAttribute('data-capture-time'),
                    legalStatus: iframeDoc.documentElement.getAttribute('data-legal-status')
                });
            } catch (e) {
                console.warn('Could not access iframe content (security restriction):', e.message);
            }
        };
        
        iframe.onerror = (error) => {
            console.error('Iframe loading error:', error);
            // Fallback error display
            iframe.srcdoc = `
                <html>
                <head><title>Rendering Error</title></head>
                <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px; background: #f8f9fa;">
                    <h2>❌ Snapshot Rendering Error</h2>
                    <p>Failed to load snapshot: ${snapshot.id}</p>
                    <p>Error: ${error.message || 'Unknown error'}</p>
                    <button onclick="parent.location.reload()">Retry</button>
                </body>
                </html>
            `;
        };
        
        // Set the server-side rendering URL
        iframe.src = renderUrl;
        
        // Set exact viewport dimensions for 1:1 legal accuracy
        this.setExactViewport();
        
        console.log('Iframe source set to server endpoint:', renderUrl);
    }

    setExactViewport() {
        const snapshot = this.currentSnapshot;
        const container = document.getElementById('snapshot-container');
        const iframe = document.getElementById('snapshot-frame');
        const exactViewportCheckbox = document.getElementById('exact-viewport');
        
        if (exactViewportCheckbox.checked) {
            // Set exact dimensions for legal accuracy
            container.style.width = `${snapshot.viewport_width}px`;
            container.style.height = `${snapshot.viewport_height}px`;
            container.classList.add('exact-viewport');
            
            iframe.style.width = `${snapshot.viewport_width}px`;
            iframe.style.height = `${snapshot.viewport_height}px`;
        } else {
            // Responsive mode
            container.style.width = '100%';
            container.style.height = '80vh';
            container.classList.remove('exact-viewport');
            
            iframe.style.width = '100%';
            iframe.style.height = '100%';
        }
    }

    toggleExactViewport() {
        this.setExactViewport();
    }

    adjustZoom(delta) {
        this.zoomLevel = Math.max(0.1, Math.min(3.0, this.zoomLevel + delta));
        this.applyZoom();
    }

    resetZoom() {
        this.zoomLevel = 1.0;
        this.applyZoom();
    }

    applyZoom() {
        const iframe = document.getElementById('snapshot-frame');
        iframe.style.transform = `scale(${this.zoomLevel})`;
        iframe.style.transformOrigin = 'top left';
        
        document.getElementById('zoom-level').textContent = `${Math.round(this.zoomLevel * 100)}%`;
        
        // Adjust container size for scaling
        const container = document.getElementById('snapshot-container');
        const snapshot = this.currentSnapshot;
        const exactViewportCheckbox = document.getElementById('exact-viewport');
        
        if (exactViewportCheckbox.checked) {
            container.style.width = `${snapshot.viewport_width * this.zoomLevel}px`;
            container.style.height = `${snapshot.viewport_height * this.zoomLevel}px`;
        }
    }

    toggleFullscreen() {
        const snapshotView = document.getElementById('snapshot-view');
        snapshotView.classList.toggle('fullscreen-mode');
        
        const button = document.getElementById('fullscreen-btn');
        if (snapshotView.classList.contains('fullscreen-mode')) {
            button.textContent = '🗗 Exit Fullscreen';
        } else {
            button.textContent = '🔍 Fullscreen';
        }
    }

    downloadSnapshot() {
        const snapshot = this.currentSnapshot;
        if (!snapshot) return;
        
        const snapshotHtml = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=${snapshot.viewport_width}, initial-scale=1.0">
    <title>Legal Snapshot Evidence - ${snapshot.id}</title>
    <style>
        ${snapshot.css || ''}
    </style>
</head>
<body>
    ${snapshot.html || ''}
    <!-- Legal Evidence Metadata -->
    <div id="legal-metadata" style="margin-top: 50px; padding: 20px; background: #f8f9fa; border: 1px solid #dee2e6; font-family: monospace; font-size: 12px;">
        <h3>Legal Evidence Metadata</h3>
        <p><strong>Snapshot ID:</strong> ${snapshot.id}</p>
        <p><strong>Captured URL:</strong> ${snapshot.url || 'Not available'}</p>
        <p><strong>Timestamp:</strong> ${snapshot.created_at}</p>
        <p><strong>Viewport:</strong> ${snapshot.viewport_width}x${snapshot.viewport_height}px</p>
        <p><strong>Generated:</strong> ${new Date().toISOString()}</p>
    </div>
</body>
</html>`;
        
        const blob = new Blob([snapshotHtml], { type: 'text/html' });
        const url = URL.createObjectURL(blob);
        
        const a = document.createElement('a');
        a.href = url;
        a.download = `snapshot-${snapshot.id}-legal-evidence.html`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    openDirect() {
        const snapshot = this.currentSnapshot;
        if (!snapshot) return;
        
        const directUrl = `/render/${snapshot.id}`;
        window.open(directUrl, '_blank', 'width=1200,height=800,scrollbars=yes,resizable=yes');
    }

    showSnapshotsList() {
        document.getElementById('snapshots-view').style.display = 'block';
        document.getElementById('snapshot-view').style.display = 'none';
        
        // Clean up iframe
        const iframe = document.getElementById('snapshot-frame');
        iframe.src = 'about:blank';
    }

    showSnapshotViewer() {
        document.getElementById('snapshots-view').style.display = 'none';
        document.getElementById('snapshot-view').style.display = 'block';
        
        // Reset zoom
        this.zoomLevel = 1.0;
        this.applyZoom();
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

    // Utility functions
    truncateId(id) {
        return id.length > 20 ? id.substring(0, 20) + '...' : id;
    }

    formatTimestamp(timestamp) {
        const date = new Date(timestamp);
        return date.toLocaleString();
    }

    formatBytes(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }
}

// Initialize dashboard when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    new SnapshotDashboard();
});