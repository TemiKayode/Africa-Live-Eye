'use strict';

// ── Alert Zones Module ─────────────────────────────────────────────────────────
// Draw polygons → browser notifications when fire/earthquake detected inside

let alertZones        = [];   // {id, name, coords, triggers, polygon}
let drawingAlert      = false;
let alertDrawPoints   = [];
let alertDrawPoly     = null;
let alertsEnabled     = false;
const ALERTS_STORAGE  = 'ale_alert_zones';

function initAlerts() {
  loadZonesFromStorage();
  document.getElementById('alerts-toggle-btn')?.addEventListener('click', toggleAlertsPanel);
  document.getElementById('alerts-panel-close')?.addEventListener('click', () => setAlertsPanel(false));
  document.getElementById('alerts-draw-btn')?.addEventListener('click', startAlertDraw);
  document.getElementById('alerts-cancel-draw')?.addEventListener('click', cancelAlertDraw);
  document.getElementById('alerts-finish-draw')?.addEventListener('click', finishAlertDraw);
  document.getElementById('alerts-enable-notif')?.addEventListener('click', requestNotifications);

  // Re-draw all saved zones on the map
  alertZones.forEach(z => drawZoneOnMap(z));
  renderZoneList();

  // Listen for map clicks during draw (map is a global let from app.js)
  if (typeof map !== 'undefined' && map) {
    map.on('click', e => {
      if (!drawingAlert) return;
      alertDrawPoints.push([e.latlng.lat, e.latlng.lng]);
      if (alertDrawPoly) map.removeLayer(alertDrawPoly);
      if (alertDrawPoints.length > 1) {
        alertDrawPoly = L.polygon(alertDrawPoints, {
          color: '#00d4ff', weight: 2, dashArray: '6,4', fillColor: '#00d4ff', fillOpacity: 0.08,
        }).addTo(map);
      } else {
        alertDrawPoly = L.circleMarker(alertDrawPoints[0], { radius: 5, color: '#00d4ff', fillOpacity: 1 }).addTo(map);
      }
      document.getElementById('alerts-draw-hint').textContent =
        `${alertDrawPoints.length} points — click map to add more, or press Finish`;
    });
  }
}

function toggleAlertsPanel() {
  const panel = document.getElementById('alerts-panel');
  const open  = panel?.classList.toggle('visible');
  document.getElementById('alerts-toggle-btn')?.classList.toggle('active-tool', !!open);
}

function setAlertsPanel(open) {
  document.getElementById('alerts-panel')?.classList.toggle('visible', open);
  document.getElementById('alerts-toggle-btn')?.classList.toggle('active-tool', open);
}

function startAlertDraw() {
  if (drawingAlert) return;
  drawingAlert    = true;
  alertDrawPoints = [];
  document.getElementById('alerts-draw-btn').style.display      = 'none';
  document.getElementById('alerts-cancel-draw').style.display   = '';
  document.getElementById('alerts-finish-draw').style.display   = '';
  document.getElementById('alerts-draw-hint').style.display     = '';
  document.getElementById('alerts-draw-hint').textContent       = 'Click map to place polygon vertices';
  showToast('Alert zone draw mode — click map points, then press Finish.', 'info');
  map.getContainer().style.cursor = 'crosshair';
}

function cancelAlertDraw() {
  drawingAlert = false;
  alertDrawPoints = [];
  if (alertDrawPoly) { map.removeLayer(alertDrawPoly); alertDrawPoly = null; }
  resetDrawUI();
}

function finishAlertDraw() {
  if (alertDrawPoints.length < 3) {
    showToast('Draw at least 3 points to create a zone.', 'error'); return;
  }

  const name = prompt('Name this alert zone:', `Zone ${alertZones.length + 1}`);
  if (!name) { cancelAlertDraw(); return; }

  if (alertDrawPoly) { map.removeLayer(alertDrawPoly); alertDrawPoly = null; }

  const zone = {
    id:      Date.now(),
    name,
    coords:  [...alertDrawPoints],
    triggers: ['fires', 'earthquakes'],
  };
  alertZones.push(zone);
  drawZoneOnMap(zone);
  saveZonesToStorage();
  renderZoneList();
  cancelAlertDraw();
  showToast(`Alert zone "${name}" created! You'll be notified of events inside.`, 'success');
  requestNotifications();
}

function drawZoneOnMap(zone) {
  if (zone.polygon) { try { map.removeLayer(zone.polygon); } catch (_) {} }
  zone.polygon = L.polygon(zone.coords, {
    color: '#00d4ff', weight: 2, fillColor: '#00d4ff', fillOpacity: 0.06,
    dashArray: '8,5',
  }).bindTooltip(`🔔 ${zone.name}`, { permanent: false }).addTo(map);
}

function resetDrawUI() {
  document.getElementById('alerts-draw-btn').style.display    = '';
  document.getElementById('alerts-cancel-draw').style.display = 'none';
  document.getElementById('alerts-finish-draw').style.display = 'none';
  document.getElementById('alerts-draw-hint').style.display   = 'none';
  map.getContainer().style.cursor = '';
  drawingAlert = false;
}

function removeZone(id) {
  const idx  = alertZones.findIndex(z => z.id === id);
  if (idx < 0) return;
  const zone = alertZones[idx];
  if (zone.polygon) { try { map.removeLayer(zone.polygon); } catch (_) {} }
  alertZones.splice(idx, 1);
  saveZonesToStorage();
  renderZoneList();
}

function renderZoneList() {
  const list = document.getElementById('alerts-zone-list');
  if (!list) return;
  if (!alertZones.length) {
    list.innerHTML = `<div class="alerts-empty">No zones yet. Draw a polygon to start monitoring.</div>`;
    return;
  }
  list.innerHTML = alertZones.map(z => `
    <div class="alert-zone-item">
      <div class="azl-name">🔔 ${z.name}</div>
      <div class="azl-meta">${z.coords.length} vertices · ${z.triggers.join(', ')}</div>
      <button class="azl-del" onclick="window.removeAlertZone(${z.id})">✕ Remove</button>
    </div>`).join('');
}

function saveZonesToStorage() {
  try { localStorage.setItem(ALERTS_STORAGE, JSON.stringify(alertZones.map(z => ({ id: z.id, name: z.name, coords: z.coords, triggers: z.triggers })))); } catch (_) {}
}

function loadZonesFromStorage() {
  try {
    const raw = localStorage.getItem(ALERTS_STORAGE);
    if (raw) alertZones = JSON.parse(raw);
  } catch (_) { alertZones = []; }
}

async function requestNotifications() {
  if (!('Notification' in window)) {
    showToast('Browser notifications not supported', 'error'); return;
  }
  if (Notification.permission === 'granted') {
    alertsEnabled = true;
    showToast('Alert notifications are active', 'success');
    document.getElementById('alerts-notif-status') && (document.getElementById('alerts-notif-status').textContent = '✓ Enabled');
    return;
  }
  const perm = await Notification.requestPermission();
  alertsEnabled = perm === 'granted';
  const status = document.getElementById('alerts-notif-status');
  if (alertsEnabled) {
    showToast('Notifications enabled! You\'ll be alerted for zone events.', 'success');
    if (status) status.textContent = '✓ Enabled';
  } else {
    showToast('Notification permission denied.', 'error');
    if (status) status.textContent = '✗ Denied';
  }
}

// ── Point-in-polygon (ray-casting) ────────────────────────────────────────────

function pointInPolygon(lat, lon, coords) {
  let inside = false;
  for (let i = 0, j = coords.length - 1; i < coords.length; j = i++) {
    const [xi, yi] = coords[i], [xj, yj] = coords[j];
    if (((yi > lon) !== (yj > lon)) && (lat < (xj - xi) * (lon - yi) / (yj - yi) + xi)) {
      inside = !inside;
    }
  }
  return inside;
}

// ── Check live data against alert zones ───────────────────────────────────────

function checkAlerts(fires, earthquakes) {
  if (!alertsEnabled || !alertZones.length) return;

  alertZones.forEach(zone => {
    fires.forEach(f => {
      if (!zone.triggers.includes('fires')) return;
      if (pointInPolygon(f.lat, f.lon, zone.coords)) {
        fireZoneAlert(zone, 'fire', `🔥 Fire hotspot in "${zone.name}" — ${f.lat.toFixed(3)}°, ${f.lon.toFixed(3)}°`);
      }
    });
    earthquakes.forEach(eq => {
      if (!zone.triggers.includes('earthquakes')) return;
      if (pointInPolygon(eq.lat, eq.lon, zone.coords)) {
        fireZoneAlert(zone, 'eq', `🌊 M${eq.magnitude} earthquake in "${zone.name}" — ${eq.place}`);
      }
    });
  });
}

const recentAlerts = {};   // zone+type → last fired timestamp
function fireZoneAlert(zone, type, message) {
  const key = `${zone.id}_${type}`;
  const now = Date.now();
  if (recentAlerts[key] && now - recentAlerts[key] < 10 * 60_000) return; // debounce 10 min
  recentAlerts[key] = now;

  if (alertsEnabled && Notification.permission === 'granted') {
    new Notification('Africa Live Eye Alert', { body: message, icon: '/favicon.ico' });
  }
  showToast(message, 'alert');
}

window.initAlerts      = initAlerts;
window.checkAlerts     = checkAlerts;
window.removeAlertZone = removeZone;
