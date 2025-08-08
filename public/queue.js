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

let LAST_JOBS_DATA = null;
let CUSTOM_RANGE = null; // { startMs, endMs }

function getTimeRangeConfig() {
  const select = document.getElementById('time-range');
  const val = select ? select.value : '15m';
  if (val === 'custom' && CUSTOM_RANGE) {
    const windowMs = CUSTOM_RANGE.endMs - CUSTOM_RANGE.startMs;
    // Auto bin size: target ~ 24-36 bins depending on width
    const targetBins = 30;
    let binMs = Math.max(60 * 1000, Math.floor(windowMs / targetBins));
    const MAX_BINS = 240;
    let bins = Math.max(1, Math.ceil(windowMs / binMs));
    if (bins > MAX_BINS) {
      binMs = Math.ceil(windowMs / MAX_BINS);
      bins = Math.max(1, Math.ceil(windowMs / binMs));
    }
    return { windowMs, bins, binMs, label: binMs >= 60 * 60 * 1000 ? 'hour' : 'time', startMs: CUSTOM_RANGE.startMs, endMs: CUSTOM_RANGE.endMs };
  }
  switch (val) {
    case '1h':
      return { windowMs: 60 * 60 * 1000, bins: 12, binMs: 5 * 60 * 1000, label: 'time' };
    case '3h':
      return { windowMs: 3 * 60 * 60 * 1000, bins: 18, binMs: 10 * 60 * 1000, label: 'time' };
    case '24h':
      return { windowMs: 24 * 60 * 60 * 1000, bins: 24, binMs: 60 * 60 * 1000, label: 'hour' };
    case '15m':
    default:
      return { windowMs: 15 * 60 * 1000, bins: 15, binMs: 60 * 1000, label: 'time' };
  }
}

function renderLegend() {
  const legend = document.getElementById('chart-legend');
  legend.innerHTML = Object.entries(COLORS).map(([k, v]) => `<span style="display:inline-flex;align-items:center;gap:6px;">
    <span style="display:inline-block;width:12px;height:12px;background:${v};border-radius:2px;"></span>
    <span style="font-size:0.9rem;color:#555;text-transform:capitalize;">${k}</span>
  </span>`).join(' ');
}

function computeWindowCounts(jobsGrouped, cfg) {
  const now = Date.now();
  const start = cfg.startMs || ( (cfg.endMs || now) - cfg.windowMs );
  const end = cfg.endMs || now;
  const result = { waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0, total: 0 };
  const add = (list, key, accessor) => {
    for (const j of list || []) {
      const t = accessor(j);
      if (!t) continue;
      const ts = typeof t === 'number' ? t : new Date(t).getTime();
      if (ts >= start && ts < end) {
        result[key]++;
      }
    }
  };
  add(jobsGrouped.waiting, 'waiting', j => j.timestamp);
  add(jobsGrouped.active, 'active', j => j.processedOn || j.timestamp);
  add(jobsGrouped.completed, 'completed', j => j.finishedOn || j.processedOn || j.timestamp);
  add(jobsGrouped.failed, 'failed', j => j.finishedOn || j.processedOn || j.timestamp);
  add(jobsGrouped.delayed, 'delayed', j => j.timestamp);
  result.total = result.waiting + result.active + result.completed + result.failed + result.delayed;
  return result;
}

function renderChart(jobsGrouped) {
  renderLegend();
  const svg = document.getElementById('queue-chart-svg');
  if (!svg) return;
  const width = svg.clientWidth || 800;
  const height = svg.clientHeight || 240;
  const padding = { left: 40, right: 10, top: 10, bottom: 28 };
  // Build time bins based on selected range
  const cfg = getTimeRangeConfig();
  const now = Date.now();
  const bins = [];
  // Determine series start and end
  const seriesEnd = cfg.endMs || now;
  const seriesStart = cfg.startMs || (seriesEnd - cfg.windowMs);
  const windowMs = (seriesEnd - seriesStart);

  const formatLabel = (d) => {
    if (windowMs >= 48 * 60 * 60 * 1000) {
      return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
    }
    if (windowMs >= 6 * 60 * 60 * 1000) {
      return d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit' });
    }
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };
  for (let i = 0; i < cfg.bins; i++) {
    const start = seriesStart + i * cfg.binMs;
    const end = Math.min(seriesStart + (i + 1) * cfg.binMs, seriesEnd);
    const labelDate = new Date(start + cfg.binMs / 2);
    const label = formatLabel(labelDate);
    bins.push({
      label,
      start,
      end,
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

  let maxY = Math.max(1, ...bins.map(b => b.waiting + b.active + b.completed + b.failed + b.delayed));
  // Ensure bars never reach full height (add headroom)
  maxY = Math.ceil(maxY * 1.15);
  const innerW = Math.max(300, width - padding.left - padding.right);
  const innerH = height - padding.top - padding.bottom;
  const barW = Math.max(6, innerW / bins.length - 8);

  // Clear svg
  while (svg.firstChild) svg.removeChild(svg.firstChild);

  // Tooltip element
  const tooltip = document.getElementById('chart-tooltip');

  // Axes grid and labels (Y) at 0, 25%, 50%, 75%, 100%
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map(r => Math.round(r * maxY));
  const yUnique = [...new Set(yTicks)];
  for (const y of yUnique) {
    const yPos = padding.top + innerH - (y / maxY) * innerH;
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
      bg.setAttribute('class', 'bar-bg');
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

    // Total label above bar
    if (total > 0) {
      const txTot = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      txTot.setAttribute('x', barX + Math.max(4, barW) / 2);
      txTot.setAttribute('y', Math.max(padding.top + 10, barY - 4));
      txTot.setAttribute('text-anchor', 'middle');
      txTot.setAttribute('class', 'total-label');
      txTot.textContent = String(total);
      svg.appendChild(txTot);
    }

    // Invisible hover hitbox to show aggregated tooltip per bar
    const hit = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    hit.setAttribute('x', barX);
    hit.setAttribute('y', padding.top);
    hit.setAttribute('width', Math.max(4, barW));
    hit.setAttribute('height', innerH);
    hit.setAttribute('fill', 'transparent');
    hit.addEventListener('mouseenter', (e) => {
      if (!tooltip) return;
      if (total <= 0) { tooltip.style.opacity = '0'; return; }
      const rows = [];
      if (b.waiting > 0) rows.push(`<div class="row"><span class="dot" style="background:${COLORS.waiting}"></span>Waiting: ${b.waiting}</div>`);
      if (b.active > 0) rows.push(`<div class="row"><span class="dot" style="background:${COLORS.active}"></span>Active: ${b.active}</div>`);
      if (b.completed > 0) rows.push(`<div class="row"><span class="dot" style="background:${COLORS.completed}"></span>Completed: ${b.completed}</div>`);
      if (b.failed > 0) rows.push(`<div class="row"><span class="dot" style="background:${COLORS.failed}"></span>Failed: ${b.failed}</div>`);
      if (b.delayed > 0) rows.push(`<div class="row"><span class="dot" style="background:${COLORS.delayed}"></span>Delayed: ${b.delayed}</div>`);
      const html = [`<div class="title">${b.label}</div>`, ...rows, `<div class="row total">Total: ${total}</div>`].join('');
      tooltip.innerHTML = html;
      tooltip.style.opacity = '1';
      // position tooltip next to this specific bar (left/right based on space), vertically centered on the bar
      const container = document.getElementById('chart-container');
      const rect = container.getBoundingClientRect();
      // Compute bar metrics in viewport coords
      const barLeft = rect.left + barX;
      const barWidth = Math.max(4, barW);
      const barRight = barLeft + barWidth;
      const barCenterY = rect.top + barY + Math.max(2, totalH) / 2;
      // Measure tooltip size after content
      const tooltipRect = tooltip.getBoundingClientRect();
      const tWidth = tooltipRect.width || 220;
      const tHeight = tooltipRect.height || 120;
      const preferRightX = barRight + 10;
      const preferLeftX = barLeft - tWidth - 10;
      const placeRight = (preferRightX + tWidth) <= window.innerWidth - 8;
      const x = placeRight ? preferRightX : Math.max(8, preferLeftX);
      const y = Math.max(8, Math.min(window.innerHeight - tHeight - 8, barCenterY - tHeight / 2));
      tooltip.style.left = `${Math.round(x)}px`;
      tooltip.style.top = `${Math.round(y)}px`;
    });
    // no mousemove tracking; tooltip is fixed at side
    hit.addEventListener('mouseleave', () => {
      if (!tooltip) return;
      tooltip.style.opacity = '0';
    });
    svg.appendChild(hit);

    // X labels: compute approximately 6 ticks evenly spaced, include first and last
    // We'll add after loop to avoid overlapping logic here
  });

  // X-axis ticks and labels
  const desiredXTicks = Math.min(6, bins.length);
  const step = Math.max(1, Math.round((bins.length - 1) / (desiredXTicks - 1)));
  const tickIdxs = new Set();
  for (let i = 0; i < bins.length; i += step) tickIdxs.add(i);
  tickIdxs.add(bins.length - 1);
  tickIdxs.add(0);
  [...tickIdxs].sort((a,b)=>a-b).forEach(i => {
    const x = padding.left + i * (innerW / bins.length) + 4;
    const label = bins[i].label;
    const tx = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    tx.setAttribute('x', x);
    tx.setAttribute('y', padding.top + innerH + 16);
    tx.setAttribute('class', 'x-label');
    tx.textContent = label;
    svg.appendChild(tx);
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
    const cfg = getTimeRangeConfig();
    // Heuristic: larger window -> fetch more jobs
    const windowMs = (cfg.endMs && cfg.startMs) ? (cfg.endMs - cfg.startMs) : cfg.windowMs;
    const limit = windowMs <= 20 * 60 * 1000 ? 150 : windowMs <= 60 * 60 * 1000 ? 400 : windowMs <= 3 * 60 * 60 * 1000 ? 800 : 1500;
    const jobsResp = await fetch(`/queue/jobs?limit=${limit}&_ts=${Date.now()}`);
    const jobsData = await jobsResp.json();
    if (!jobsData.success) throw new Error('jobs failed');
    LAST_JOBS_DATA = jobsData;
    // Stats reflect window counts to match the chart and lists
    const stats = computeWindowCounts(LAST_JOBS_DATA, cfg);
    renderStats(stats);
    renderChart(LAST_JOBS_DATA);
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
  const range = document.getElementById('time-range');
  if (range) range.addEventListener('change', () => {
    const customControls = ['range-start', 'range-end']
      .map(id => document.getElementById(id));
    if (range.value === 'custom') {
      customControls.forEach(el => el && (el.disabled = false));
    } else {
      customControls.forEach(el => el && (el.disabled = true));
      CUSTOM_RANGE = null;
    }
    if (LAST_JOBS_DATA) renderChart(LAST_JOBS_DATA);
  });
  const startEl = document.getElementById('range-start');
  const endEl = document.getElementById('range-end');

  // Initialize custom controls disabled by default
  [startEl, endEl].forEach(el => el && (el.disabled = true));

  function applyCustomRange() {
    if (!startEl || !endEl) return;
    const startVal = startEl.value ? new Date(startEl.value).getTime() : null;
    const endVal = endEl.value ? new Date(endEl.value).getTime() : null;
    if (!startVal || !endVal || isNaN(startVal) || isNaN(endVal) || endVal <= startVal) {
      return; // ignore until valid
    }
    CUSTOM_RANGE = { startMs: startVal, endMs: endVal };
    if (LAST_JOBS_DATA) renderChart(LAST_JOBS_DATA);
  }

  if (startEl) startEl.addEventListener('change', applyCustomRange);
  if (endEl) endEl.addEventListener('change', applyCustomRange);
  loadQueue();
  // Smooth live chart updates by refreshing more frequently
  setInterval(loadQueue, 3000);
});


