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
        document.getElementById('dom-tab').addEventListener('click', () => this.showDomTab());
        document.getElementById('html-tab').addEventListener('click', () => this.showHtmlTab());
        document.getElementById('css-tab').addEventListener('click', () => this.showCssTab());
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
        
        // Load DOM tab by default (instead of screenshot)
        this.loadDomPreview();
    }


    showScreenshotTab() {
        this.setActiveTab('screenshot');
        this.loadScreenshot();
    }

    showDomTab() {
        this.setActiveTab('dom');
        this.loadDomPreview();
    }

    showHtmlTab() {
        this.setActiveTab('html');
        this.loadRawHtml();
    }

    showCssTab() {
        this.setActiveTab('css');
        this.loadRawCss();
    }

    setActiveTab(activeTabName) {
        // Update tab buttons
        const tabs = ['screenshot', 'dom', 'html', 'css'];
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

    async loadDomPreview() {
        const snapshot = this.currentSnapshot;
        const domStatus = document.getElementById('dom-status');
        const domFrame = document.getElementById('dom-frame');
        
        try {
            domStatus.innerHTML = '<div class="loading">Loading DOM preview...</div>';
            domFrame.style.display = 'none';
            
            console.log('🌐 Loading DOM preview for snapshot:', snapshot.id);
            
            // Load the DOM preview directly in iframe
            const domUrl = `/render/${snapshot.id}`;
            
            domFrame.onload = () => {
                console.log('✅ DOM preview loaded successfully');
                domStatus.style.display = 'none';
            };
            
            domFrame.onerror = (error) => {
                console.error('❌ DOM preview failed to load:', error);
                domStatus.innerHTML = `
                    <div class="error">
                        <p>❌ Failed to load DOM preview</p>
                        <p>DOM data may have been cleaned up</p>
                    </div>
                `;
            };
            
            domFrame.src = domUrl;
            domFrame.style.display = 'block';
            
        } catch (error) {
            console.error('Error loading DOM preview:', error);
            domStatus.innerHTML = `
                <div class="error">
                    <p>❌ Error loading DOM preview</p>
                    <p>DOM data may have been cleaned up</p>
                </div>
            `;
        }
    }

    async loadRawHtml() {
        if (!this.currentSnapshot?.id) return;

        try {
            const response = await fetch(`/snapshots/${this.currentSnapshot.id}`);
            const data = await response.json();
            
            if (data.success && data.snapshot) {
                const htmlContent = data.snapshot.html || '';
                const htmlSize = this.formatFileSize(htmlContent.length);
                
                document.getElementById('html-size').textContent = htmlSize;
                document.getElementById('html-content-display').innerHTML = `<code>${this.escapeHtml(htmlContent)}</code>`;
                
                // Add copy and download functionality
                this.setupHtmlActions(htmlContent);
                
            } else {
                document.getElementById('html-content-display').innerHTML = `<div class="empty-state">No HTML content available</div>`;
                document.getElementById('html-size').textContent = '0 bytes';
            }
            
        } catch (error) {
            console.error('Error loading raw HTML:', error);
            document.getElementById('html-content-display').innerHTML = `<div class="error">Error loading HTML content</div>`;
        }
    }

    async loadRawCss() {
        if (!this.currentSnapshot?.id) return;

        try {
            const response = await fetch(`/snapshots/${this.currentSnapshot.id}`);
            const data = await response.json();
            
            if (data.success && data.snapshot) {
                const cssContent = data.snapshot.css || '';
                const cssSize = this.formatFileSize(cssContent.length);
                
                document.getElementById('css-size').textContent = cssSize;
                
                if (cssContent) {
                    document.getElementById('css-content-display').innerHTML = `<code>${this.escapeHtml(cssContent)}</code>`;
                } else {
                    document.getElementById('css-content-display').innerHTML = `<div class="empty-state">No CSS content captured</div>`;
                }
                
                // Add copy and download functionality  
                this.setupCssActions(cssContent);
                
            } else {
                document.getElementById('css-content-display').innerHTML = `<div class="empty-state">No CSS content available</div>`;
                document.getElementById('css-size').textContent = '0 bytes';
            }
            
        } catch (error) {
            console.error('Error loading raw CSS:', error);
            document.getElementById('css-content-display').innerHTML = `<div class="error">Error loading CSS content</div>`;
        }
    }

    setupHtmlActions(htmlContent) {
        const copyBtn = document.getElementById('copy-html-btn');
        const downloadBtn = document.getElementById('download-html-btn');

        copyBtn.onclick = () => this.copyToClipboard(htmlContent, 'HTML');
        downloadBtn.onclick = () => this.downloadContent(htmlContent, `snapshot-${this.currentSnapshot.id}.html`, 'text/html');
    }

    setupCssActions(cssContent) {
        const copyBtn = document.getElementById('copy-css-btn');
        const downloadBtn = document.getElementById('download-css-btn');

        copyBtn.onclick = () => this.copyToClipboard(cssContent, 'CSS');
        downloadBtn.onclick = () => this.downloadContent(cssContent, `snapshot-${this.currentSnapshot.id}.css`, 'text/css');
    }

    async copyToClipboard(content, type) {
        try {
            await navigator.clipboard.writeText(content);
            this.showToast(`${type} content copied to clipboard! 📋`);
        } catch (error) {
            console.error('Failed to copy to clipboard:', error);
            this.showToast(`Failed to copy ${type} content ❌`, 'error');
        }
    }

    downloadContent(content, filename, mimeType) {
        const blob = new Blob([content], { type: mimeType });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        
        this.showToast(`${filename} downloaded! 💾`);
    }

    formatFileSize(bytes) {
        if (bytes === 0) return '0 bytes';
        const k = 1024;
        const sizes = ['bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    showToast(message, type = 'success') {
        // Create toast element
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.textContent = message;
        toast.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: ${type === 'success' ? '#28a745' : '#dc3545'};
            color: white;
            padding: 12px 24px;
            border-radius: 6px;
            font-weight: 500;
            z-index: 10000;
            opacity: 0;
            transform: translateY(-20px);
            transition: all 0.3s ease;
        `;
        
        document.body.appendChild(toast);
        
        // Animate in
        setTimeout(() => {
            toast.style.opacity = '1';
            toast.style.transform = 'translateY(0)';
        }, 10);
        
        // Remove after 3 seconds
        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateY(-20px)';
            setTimeout(() => {
                document.body.removeChild(toast);
            }, 300);
        }, 3000);
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