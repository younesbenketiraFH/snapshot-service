async function loadDbStats() {
  const container = document.getElementById('db-stats');
  try {
    const resp = await fetch('/db/stats');
    const data = await resp.json();
    if (!data.success) throw new Error('Failed to fetch stats');
    const s = data.stats || {};

    const bytes = (n) => {
      if (!n || n === 0) return '0 B';
      const k = 1024; const sizes = ['B','KB','MB','GB'];
      const i = Math.floor(Math.log(n)/Math.log(k));
      return `${(n/Math.pow(k,i)).toFixed(2)} ${sizes[i]}`;
    };

    container.innerHTML = `
      <div class="metadata-item"><div class="metadata-label">Total Snapshots</div><div class="metadata-value">${s.total_snapshots || 0}</div></div>
      <div class="metadata-item"><div class="metadata-label">Total HTML</div><div class="metadata-value">${bytes(s.total_html_bytes || 0)}</div></div>
      <div class="metadata-item"><div class="metadata-label">Total CSS</div><div class="metadata-value">${bytes(s.total_css_bytes || 0)}</div></div>
      <div class="metadata-item"><div class="metadata-label">Screenshots Count</div><div class="metadata-value">${s.screenshots_count || 0}</div></div>
      <div class="metadata-item"><div class="metadata-label">Total Screenshots Size</div><div class="metadata-value">${bytes(s.total_screenshot_bytes || 0)}</div></div>
      <div class="metadata-item"><div class="metadata-label">Oldest</div><div class="metadata-value">${s.oldest || 'N/A'}</div></div>
      <div class="metadata-item"><div class="metadata-label">Newest</div><div class="metadata-value">${s.newest || 'N/A'}</div></div>
    `;
  } catch (e) {
    container.innerHTML = `<div class="error">Failed to load DB stats</div>`;
  }
}

async function loadRecentSnapshots() {
  const container = document.getElementById('recent-snapshots');
  try {
    const resp = await fetch('/snapshots?limit=24');
    const data = await resp.json();
    if (!data.success) throw new Error('Failed to fetch snapshots');
    const list = data.snapshots || [];
    if (list.length === 0) {
      container.innerHTML = '<div class="loading">No snapshots found</div>';
      return;
    }
    container.innerHTML = list.map(s => `
      <div class="snapshot-card">
        <div class="snapshot-card-header">
          <div class="snapshot-id">${s.id}</div>
          <div class="snapshot-timestamp">${new Date(s.created_at).toLocaleString()}</div>
        </div>
        <div class="snapshot-url">${s.url || ''}</div>
        <div class="snapshot-meta">
          <div class="meta-item"><span class="meta-label">Viewport</span>${s.viewport_width}x${s.viewport_height}</div>
          <div class="meta-item"><span class="meta-label">HTML</span>${(s.html_size/1024).toFixed(1)} KB</div>
          <div class="meta-item"><span class="meta-label">CSS</span>${(s.css_size/1024).toFixed(1)} KB</div>
        </div>
      </div>
    `).join('');
  } catch (e) {
    container.innerHTML = '<div class="error">Failed to load snapshots</div>';
  }
}

document.addEventListener('DOMContentLoaded', () => {
  loadDbStats();
  loadRecentSnapshots();
});


