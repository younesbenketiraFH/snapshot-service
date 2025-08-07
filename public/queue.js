function renderStats(stats) {
  const c = document.getElementById('queue-stats');
  c.innerHTML = `
    <div class="metadata-item"><div class="metadata-label">Waiting</div><div class="metadata-value">${stats.waiting}</div></div>
    <div class="metadata-item"><div class="metadata-label">Active</div><div class="metadata-value">${stats.active}</div></div>
    <div class="metadata-item"><div class="metadata-label">Completed</div><div class="metadata-value">${stats.completed}</div></div>
    <div class="metadata-item"><div class="metadata-label">Failed</div><div class="metadata-value">${stats.failed}</div></div>
    <div class="metadata-item"><div class="metadata-label">Delayed</div><div class="metadata-value">${stats.delayed}</div></div>
    <div class="metadata-item"><div class="metadata-label">Total</div><div class="metadata-value">${stats.total}</div></div>
  `;
}

// Simple stacked bar chart without external deps
const COLORS = { waiting: '#0dcaf0', active: '#007bff', completed: '#198754', failed: '#dc3545', delayed: '#fd7e14' };

function renderLegend() {
  const legend = document.getElementById('chart-legend');
  legend.innerHTML = Object.entries(COLORS).map(([k, v]) => `<span style="display:inline-flex;align-items:center;gap:6px;">
    <span style="display:inline-block;width:12px;height:12px;background:${v};border-radius:2px;"></span>
    <span style="font-size:0.9rem;color:#555;text-transform:capitalize;">${k}</span>
  </span>`).join(' ');
}

function renderChart(jobsGrouped) {
  renderLegend();
  const svg = document.getElementById('queue-chart-svg');
  if (!svg) return;
  const width = svg.clientWidth || 800;
  const height = svg.clientHeight || 240;
  const padding = { left: 40, right: 10, top: 10, bottom: 24 };
  // Build time bins (minute buckets over last 15 minutes)
  const now = Date.now();
  const minutes = 15;
  const bins = [];
  for (let i = minutes - 1; i >= 0; i--) {
    const start = now - i * 60 * 1000;
    bins.push({
      label: new Date(start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      start,
      end: start + 60 * 1000,
      waiting: 0,
      active: 0,
      completed: 0,
      failed: 0,
      delayed: 0
    });
  }

  const addToBins = (list, key, timeAccessor) => {
    for (const job of list || []) {
      const t = timeAccessor(job);
      if (!t) continue;
      const ts = typeof t === 'number' ? t : new Date(t).getTime();
      const bin = bins.find(b => ts >= b.start && ts < b.end);
      if (bin) bin[key]++;
    }
  };

  addToBins(jobsGrouped.waiting, 'waiting', j => j.timestamp);
  addToBins(jobsGrouped.active, 'active', j => j.processedOn || j.timestamp);
  addToBins(jobsGrouped.completed, 'completed', j => j.finishedOn || j.processedOn || j.timestamp);
  addToBins(jobsGrouped.failed, 'failed', j => j.finishedOn || j.processedOn || j.timestamp);
  addToBins(jobsGrouped.delayed, 'delayed', j => j.timestamp);

  const maxY = Math.max(1, ...bins.map(b => b.waiting + b.active + b.completed + b.failed + b.delayed));
  const innerW = Math.max(300, width - padding.left - padding.right);
  const innerH = height - padding.top - padding.bottom;
  const barW = Math.max(6, innerW / bins.length - 8);

  // Clear svg
  while (svg.firstChild) svg.removeChild(svg.firstChild);

  // Axes grid and labels (Y)
  for (let y = 0; y <= maxY; y++) {
    const yPos = padding.top + innerH - (y / maxY) * innerH;
    if (y % Math.ceil(maxY / 4) === 0) {
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', padding.left);
      line.setAttribute('x2', padding.left + innerW);
      line.setAttribute('y1', yPos);
      line.setAttribute('y2', yPos);
      line.setAttribute('stroke', '#eee');
      svg.appendChild(line);

      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      text.setAttribute('x', 4);
      text.setAttribute('y', yPos + 4);
      text.setAttribute('font-size', '10');
      text.setAttribute('fill', '#666');
      text.textContent = String(y);
      svg.appendChild(text);
    }
  }

  bins.forEach((b, i) => {
    const x = padding.left + i * (innerW / bins.length) + 4;
    const total = b.waiting + b.active + b.completed + b.failed + b.delayed;
    const totalH = (total / maxY) * innerH;
    const barX = x;
    const barY = padding.top + innerH - totalH;

    // Background rounded bar container for nicer look
    if (total > 0) {
      const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      bg.setAttribute('x', barX);
      bg.setAttribute('y', barY);
      bg.setAttribute('width', Math.max(4, barW));
      bg.setAttribute('height', Math.max(2, totalH));
      bg.setAttribute('rx', '6');
      bg.setAttribute('ry', '6');
      bg.setAttribute('fill', '#f7f9fc');
      bg.setAttribute('stroke', '#e9ecef');
      bg.setAttribute('stroke-width', '1');
      svg.appendChild(bg);
    }

    // Draw stacked segments with slight inset and small gaps
    let yTop = padding.top + innerH;
    const inset = 2;
    const segs = [
      { key: 'delayed', val: b.delayed },
      { key: 'waiting', val: b.waiting },
      { key: 'active', val: b.active },
      { key: 'completed', val: b.completed },
      { key: 'failed', val: b.failed }
    ];
    segs.forEach(seg => {
      if (!seg.val) return;
      let h = (seg.val / maxY) * innerH;
      // minimal visible height
      h = Math.max(h, seg.val > 0 ? 2 : 0);
      yTop -= h;
      const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      rect.setAttribute('x', barX + inset);
      rect.setAttribute('y', yTop + 1); // tiny gap between segments
      rect.setAttribute('width', Math.max(2, barW - inset * 2));
      rect.setAttribute('height', Math.max(1, h - 1));
      rect.setAttribute('fill', COLORS[seg.key]);
      rect.setAttribute('stroke', 'rgba(0,0,0,0.05)');
      rect.setAttribute('stroke-width', '1');

      // Tooltip
      const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
      title.textContent = `${b.label} • ${seg.key}: ${seg.val}`;
      rect.appendChild(title);

      svg.appendChild(rect);
    });

    // X labels sparse
    if (i % 3 === 0 || i === bins.length - 1) {
      const tx = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      tx.setAttribute('x', x);
      tx.setAttribute('y', padding.top + innerH + 14);
      tx.setAttribute('font-size', '10');
      tx.setAttribute('fill', '#666');
      tx.textContent = b.label;
      svg.appendChild(tx);
    }
  });
}

function renderJobs(id, jobs) {
  const c = document.getElementById(id);
  if (!jobs || jobs.length === 0) {
    c.innerHTML = '<div class="loading">No jobs</div>';
    return;
  }
  // Compact styled job cards
  c.innerHTML = jobs.map(j => `
    <div class="job-card">
      <div class="job-header">
        <strong>#${j.id}</strong>
        <span class="job-name">[${j.name}]</span>
      </div>
      <div class="job-meta">
        <span class="job-chip">snapshotId=${j.data?.snapshotId || ''}</span>
        <span class="job-chip">attempts=${j.attemptsMade}</span>
        <span class="job-chip">progress=${j.progress || 0}</span>
        <span class="job-chip">processedOn=${j.processedOn || '-'}</span>
        <span class="job-chip">finishedOn=${j.finishedOn || '-'}</span>
        ${j.failedReason ? `<span class="job-chip error">failedReason=${j.failedReason}</span>` : ''}
      </div>
    </div>
  `).join('');
}

async function loadQueue() {
  try {
    const [statsResp, jobsResp] = await Promise.all([
      fetch('/queue/stats'),
      fetch('/queue/jobs?limit=100')
    ]);
    const statsData = await statsResp.json();
    const jobsData = await jobsResp.json();
    if (!statsData.success) throw new Error('stats failed');
    if (!jobsData.success) throw new Error('jobs failed');
    renderStats(statsData.stats);
    renderChart(jobsData);
    renderJobs('waiting', jobsData.waiting);
    renderJobs('active', jobsData.active);
    renderJobs('completed', jobsData.completed);
    renderJobs('failed', jobsData.failed);
    renderJobs('delayed', jobsData.delayed);
  } catch (e) {
    document.getElementById('queue-stats').innerHTML = '<div class="error">Failed to load queue</div>';
  }
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('refresh').addEventListener('click', loadQueue);
  loadQueue();
  // Smooth live chart updates by refreshing more frequently
  setInterval(loadQueue, 3000);
});


