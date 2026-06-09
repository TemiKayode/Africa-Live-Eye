'use strict';

// ── Analytics Panel Module ────────────────────────────────────────────────────
// Chart.js charts: fire trends, earthquake stats, summary cards

let analyticsOpen   = false;
let fireChart       = null;
let eqChart         = null;
let analyticsLoaded = false;

function initAnalytics() {
  document.getElementById('analytics-toggle-btn')?.addEventListener('click', toggleAnalytics);
  document.getElementById('analytics-close-btn')?.addEventListener('click', () => setAnalytics(false));
}

function toggleAnalytics() {
  setAnalytics(!analyticsOpen);
}

function setAnalytics(open) {
  analyticsOpen = open;
  const panel = document.getElementById('analytics-panel');
  const btn   = document.getElementById('analytics-toggle-btn');
  panel?.classList.toggle('visible', open);
  btn?.classList.toggle('active-tool', open);

  if (open && !analyticsLoaded) {
    loadAnalyticsData();
  }
}

async function loadAnalyticsData() {
  analyticsLoaded = true;
  document.getElementById('analytics-loading')?.style && (document.getElementById('analytics-loading').style.display = '');

  try {
    const data = await fetch('/api/analytics/fires').then(r => r.json());
    renderFireChart(data);
    renderSummaryCards(data);
  } catch (e) {
    console.error('[Analytics]', e.message);
  }

  renderEqChart();
  document.getElementById('analytics-loading') && (document.getElementById('analytics-loading').style.display = 'none');
}

function renderFireChart(data) {
  const ctx = document.getElementById('fire-chart');
  if (!ctx || typeof Chart === 'undefined') return;

  const dates  = Object.keys(data.byDate || {}).sort();
  const counts = dates.map(d => data.byDate[d]);

  if (fireChart) fireChart.destroy();

  fireChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: dates.map(d => d.slice(5)),   // MM-DD
      datasets: [{
        label: 'Fire Hotspots',
        data: counts,
        backgroundColor: counts.map(c => `rgba(255,${Math.max(40, 180 - c / 3)},30,0.80)`),
        borderColor: 'rgba(255,80,0,0.6)',
        borderWidth: 1,
        borderRadius: 3,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: ctx => `${ctx.parsed.y} hotspots` } },
      },
      scales: {
        x: { ticks: { color: '#6b7a94', font: { size: 10 } }, grid: { color: 'rgba(255,255,255,0.04)' } },
        y: { ticks: { color: '#6b7a94', font: { size: 10 } }, grid: { color: 'rgba(255,255,255,0.05)' }, beginAtZero: true },
      },
    },
  });
}

function renderEqChart() {
  const ctx = document.getElementById('eq-chart');
  if (!ctx || typeof Chart === 'undefined') return;

  const eqs = window.lastEarthquakes ? window.lastEarthquakes() : [];
  const bins = { '2.5-3': 0, '3-4': 0, '4-5': 0, '5-6': 0, '6+': 0 };
  eqs.forEach(eq => {
    const m = eq.magnitude;
    if (m < 3)      bins['2.5-3']++;
    else if (m < 4) bins['3-4']++;
    else if (m < 5) bins['4-5']++;
    else if (m < 6) bins['5-6']++;
    else            bins['6+']++;
  });

  if (eqChart) eqChart.destroy();

  eqChart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: Object.keys(bins),
      datasets: [{
        data: Object.values(bins),
        backgroundColor: ['#4488ff', '#44bbff', '#ffaa00', '#ff6600', '#ff2244'],
        borderColor: 'rgba(0,0,0,0.4)',
        borderWidth: 2,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { position: 'right', labels: { color: '#6b7a94', font: { size: 10 }, padding: 8 } },
        tooltip: { callbacks: { label: ctx => `M${ctx.label}: ${ctx.parsed}` } },
      },
    },
  });
}

function renderSummaryCards(data) {
  const totalEl = document.getElementById('analytics-total-fires');
  const peakEl  = document.getElementById('analytics-peak-day');
  const eqEl    = document.getElementById('analytics-total-eq');

  if (totalEl) totalEl.textContent = (data.total || 0).toLocaleString();

  const byDate = data.byDate || {};
  const peak   = Object.entries(byDate).sort((a, b) => b[1] - a[1])[0];
  if (peakEl && peak) peakEl.textContent = `${peak[0].slice(5)} (${peak[1]})`;

  if (eqEl) eqEl.textContent = (window.lastEarthquakes ? window.lastEarthquakes().length : 0).toLocaleString();
}

// Re-render charts when new earthquake data arrives
window._onNewEarthquakes = function () {
  if (analyticsOpen && analyticsLoaded) renderEqChart();
};

window.initAnalytics   = initAnalytics;
window.toggleAnalytics = toggleAnalytics;
window.refreshAnalytics = function () { analyticsLoaded = false; if (analyticsOpen) loadAnalyticsData(); };
