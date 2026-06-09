'use strict';

// ── Config ────────────────────────────────────────────────────────────────────

const AFRICA_CENTER = [5.5, 21];
const INIT_ZOOM     = 4;
const GIBS          = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best';

// ── Global state ──────────────────────────────────────────────────────────────

let map, socket;
let currentDate   = offsetDateStr(1);
let activeBaseKey = 'esri';
let activeFeedTab = 'fires';
let lastFires     = [];
let lastAircraft  = [];

// Interaction modes: 'normal' | 'pin' | 'trace'
let interactionMode = 'normal';

// Pins
let pins       = [];
let pinMarkers = [];

// Trace
let traceCoords = [];
let tracePoly   = null;
let traceDots   = [];

// Map layers
let fireLayer, aircraftLayer;
let shipsLayer, thermalLayer, aerosolLayer, lstLayer, ndviLayer, nightLayer, labelsLayer;
let baseLayers = {};

// ── Window-exposed helpers (used by inline popup onclick) ─────────────────────

window.copyText = function (text, msg) {
  navigator.clipboard.writeText(text)
    .then(() => showToast(msg || 'Copied!', 'success'))
    .catch(() => {
      const ta = document.createElement('textarea');
      Object.assign(ta.style, { position: 'fixed', opacity: '0' });
      ta.value = text; document.body.appendChild(ta); ta.focus(); ta.select();
      document.execCommand('copy'); ta.remove();
      showToast(msg || 'Copied!', 'success');
    });
};
window.showToast = showToast; // forward declaration resolved at runtime

// ── Date helpers ──────────────────────────────────────────────────────────────

function offsetDateStr(daysAgo) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - daysAgo);
  return d.toISOString().split('T')[0];
}

// ── GIBS tile factories ───────────────────────────────────────────────────────

function gibsJpg(layer, date) {
  return `${GIBS}/${layer}/default/${date}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg`;
}
function gibsPng(layer, date) {
  return `${GIBS}/${layer}/default/${date}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.png`;
}
function makeTile(url, maxNative, opacity, attr) {
  return L.tileLayer(url, {
    maxNativeZoom: maxNative, maxZoom: 22,
    opacity, attribution: attr,
    crossOrigin: 'anonymous',
    errorTileUrl: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  });
}

// ── Map initialisation ────────────────────────────────────────────────────────

function initMap() {
  fireLayer     = L.layerGroup();
  aircraftLayer = L.layerGroup();

  map = L.map('map', {
    center: AFRICA_CENTER, zoom: INIT_ZOOM,
    zoomControl: false, attributionControl: false,
    preferCanvas: true,
    doubleClickZoom: false,
  });

  L.control.zoom({ position: 'bottomright' }).addTo(map);
  L.control.scale({ metric: true, imperial: false, position: 'bottomleft', maxWidth: 110 }).addTo(map);

  // Base layers
  baseLayers.esri   = makeTile('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', 19, 1, 'Esri');
  baseLayers.mapbox = makeTile('/tiles/mapbox/{z}/{x}/{y}', 22, 1, 'Mapbox / Maxar');
  baseLayers.viirs  = makeTile(gibsJpg('VIIRS_SNPP_CorrectedReflectance_TrueColor', currentDate), 9, 0.95, 'NASA GIBS / VIIRS');
  baseLayers.modisT = makeTile(gibsJpg('MODIS_Terra_CorrectedReflectance_TrueColor', currentDate), 9, 0.95, 'NASA GIBS / MODIS Terra');
  baseLayers.modisA = makeTile(gibsJpg('MODIS_Aqua_CorrectedReflectance_TrueColor', currentDate), 9, 0.95, 'NASA GIBS / MODIS Aqua');

  // Environmental overlays
  thermalLayer = makeTile(gibsPng('MODIS_Terra_Thermal_Anomalies_Day', currentDate), 9, 0.85, 'NASA GIBS Thermal');
  aerosolLayer = makeTile(gibsPng('MODIS_Terra_Aerosol', currentDate), 9, 0.75, 'NASA GIBS Aerosol');
  lstLayer     = makeTile(gibsPng('MODIS_Terra_Land_Surface_Temp_Day', currentDate), 9, 0.75, 'NASA GIBS LST');
  ndviLayer    = makeTile(gibsPng('MODIS_Terra_NDVI_8Day', currentDate), 9, 0.80, 'NASA GIBS NDVI');
  nightLayer   = makeTile(gibsPng('VIIRS_SNPP_DayNightBand_ENCC', currentDate), 8, 0.90, 'NASA GIBS Night Lights');
  labelsLayer  = makeTile('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', 19, 1, 'Esri Labels');
  shipsLayer   = makeTile('https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png', 18, 0.85, 'OpenSeaMap');

  baseLayers.esri.addTo(map);
  fireLayer.addTo(map);
  aircraftLayer.addTo(map);

  map.on('zoomend moveend', () => { onZoomEnd(); syncUrl(); });
  map.on('mousemove', e => {
    document.getElementById('coordinates').textContent =
      `${e.latlng.lat.toFixed(5)}°N  ${e.latlng.lng.toFixed(5)}°E`;
  });
  map.on('zoomend', () => {
    document.getElementById('zoom-level').textContent = `Zoom ${map.getZoom()}`;
  });
  map.on('click',    onMapClick);
  map.on('dblclick', onMapDblClick);
  map.on('contextmenu', e => { L.DomEvent.preventDefault(e); showContextMenu(e); });
  map.on('click', hideContextMenu);
}

function onZoomEnd() {
  if (activeBaseKey === 'esri' || activeBaseKey === 'mapbox') return;
  const z  = map.getZoom();
  const op = z <= 9 ? 0.95 : Math.max(0, 0.95 - (z - 9) * 0.18);
  baseLayers[activeBaseKey]?.setOpacity(op);
}

function onMapClick(e) {
  hideContextMenu();
  if (interactionMode === 'pin')   { addPin(e.latlng.lat, e.latlng.lng, true); return; }
  if (interactionMode === 'trace') { addTracePoint(e.latlng.lat, e.latlng.lng); return; }
}

function onMapDblClick(e) {
  if (interactionMode === 'trace') finishTrace();
  else map.zoomIn();
}

// ── URL state sync ────────────────────────────────────────────────────────────

let syncTimer;
function syncUrl() {
  clearTimeout(syncTimer);
  syncTimer = setTimeout(_doSyncUrl, 350);
}

function _doSyncUrl() {
  const c = map.getCenter();
  const p = new URLSearchParams();
  p.set('lat',  c.lat.toFixed(6));
  p.set('lon',  c.lng.toFixed(6));
  p.set('z',    map.getZoom());
  p.set('base', activeBaseKey);
  const ov = getActiveOverlays();
  if (ov.length)               p.set('ov',    ov.join(','));
  if (pins.filter(Boolean).length) p.set('pins', pins.filter(Boolean).map(pt => `${pt[0].toFixed(5)},${pt[1].toFixed(5)}`).join('|'));
  if (traceCoords.length > 1)  p.set('trace', traceCoords.map(pt => `${pt[0].toFixed(5)},${pt[1].toFixed(5)}`).join('|'));
  history.replaceState(null, '', '?' + p.toString());
}

function getActiveOverlays() {
  return [...document.querySelectorAll('input[name="overlay"]:checked')].map(el => el.value);
}

function buildShareUrl(lat, lon, z) {
  const base = window.location.origin + window.location.pathname;
  const p = new URLSearchParams();
  p.set('lat',  (lat ?? map.getCenter().lat).toFixed(6));
  p.set('lon',  (lon ?? map.getCenter().lng).toFixed(6));
  p.set('z',    z ?? map.getZoom());
  p.set('base', activeBaseKey);
  const ov = getActiveOverlays();
  if (ov.length) p.set('ov', ov.join(','));
  if (lat != null) p.set('pins', `${lat.toFixed(5)},${lon.toFixed(5)}`);
  return base + '?' + p.toString();
}

function restoreFromUrl() {
  const p = new URLSearchParams(location.search);
  const lat  = parseFloat(p.get('lat'));
  const lon  = parseFloat(p.get('lon'));
  const z    = parseInt(p.get('z'));
  const base = p.get('base');
  const ov   = p.get('ov');
  const pstr = p.get('pins');
  const tstr = p.get('trace');

  if (!isNaN(lat) && !isNaN(lon)) map.setView([lat, lon], isNaN(z) ? INIT_ZOOM : z, { animate: false });

  if (base && baseLayers[base]) {
    const radio = document.querySelector(`input[name="base-layer"][value="${base}"]`);
    if (radio) { radio.checked = true; selectBase(base, false); }
  }

  if (ov) {
    ov.split(',').forEach(key => {
      const cb = document.querySelector(`input[name="overlay"][value="${key}"]`);
      if (cb && !cb.checked) { cb.checked = true; addOverlay(key); }
    });
  }

  if (pstr) {
    pstr.split('|').forEach(coord => {
      const [plat, plon] = coord.split(',').map(Number);
      if (!isNaN(plat) && !isNaN(plon)) addPin(plat, plon, false);
    });
  }

  if (tstr) {
    const pts = tstr.split('|').map(c => c.split(',').map(Number)).filter(pt => !isNaN(pt[0]));
    if (pts.length > 1) restoreTrace(pts);
  }
}

// ── Date slider ───────────────────────────────────────────────────────────────

function initDateSlider() {
  const slider  = document.getElementById('date-slider');
  const chip    = document.getElementById('slider-date');
  const todayBtn = document.getElementById('today-btn');

  function update() {
    const daysAgo = 7 - parseInt(slider.value);   // slider 7→today, 0→7 days ago
    const date    = offsetDateStr(daysAgo);        // daysAgo=0 gives today
    chip.textContent = daysAgo === 0 ? 'Today' : date;
    applyDate(date);
  }

  slider.addEventListener('input', update);

  // "Today" quick-jump button
  todayBtn?.addEventListener('click', () => {
    slider.value = '7';   // max = today
    update();
    showToast('Imagery date set to today — tiles update ~3 h after overpass', 'info');
  });

  update();
}

// ── Live UTC clock ─────────────────────────────────────────────────────────────

function startClock() {
  const el = document.getElementById('utc-clock');
  if (!el) return;
  function tick() {
    const n = new Date();
    const hh = String(n.getUTCHours()).padStart(2, '0');
    const mm = String(n.getUTCMinutes()).padStart(2, '0');
    const ss = String(n.getUTCSeconds()).padStart(2, '0');
    el.textContent = `${hh}:${mm}:${ss} UTC`;
  }
  tick();
  setInterval(tick, 1000);
}

function applyDate(dateStr) {
  currentDate = dateStr;
  baseLayers.viirs.setUrl(gibsJpg('VIIRS_SNPP_CorrectedReflectance_TrueColor', dateStr));
  baseLayers.modisT.setUrl(gibsJpg('MODIS_Terra_CorrectedReflectance_TrueColor', dateStr));
  baseLayers.modisA.setUrl(gibsJpg('MODIS_Aqua_CorrectedReflectance_TrueColor', dateStr));
  thermalLayer.setUrl(gibsPng('MODIS_Terra_Thermal_Anomalies_Day', dateStr));
  aerosolLayer.setUrl(gibsPng('MODIS_Terra_Aerosol', dateStr));
  lstLayer.setUrl(gibsPng('MODIS_Terra_Land_Surface_Temp_Day', dateStr));
  ndviLayer.setUrl(gibsPng('MODIS_Terra_NDVI_8Day', dateStr));
  nightLayer.setUrl(gibsPng('VIIRS_SNPP_DayNightBand_ENCC', dateStr));
  // Update precipitation date too
  if (window.precipLayer) window.precipLayer.setUrl(
    `${GIBS}/GPM_3IMERGHH_06_precipitationCal/default/${dateStr}/2km/{z}/{y}/{x}.png`
  );
  document.getElementById('imagery-timestamp').textContent = `Imagery: ${dateStr} UTC`;
}

// ── Layer controls ────────────────────────────────────────────────────────────

// Overlay map — modules add their entries after init
const overlayMap = {
  fires:       () => fireLayer,
  aircraft:    () => aircraftLayer,
  ships:       () => shipsLayer,
  thermal:     () => thermalLayer,
  aerosol:     () => aerosolLayer,
  lst:         () => lstLayer,
  ndvi:        () => ndviLayer,
  nightlights: () => nightLayer,
  labels:      () => labelsLayer,
  // lightning, earthquakes, cyclones, precip registered by overlays.js
};

function initLayerControls() {
  document.querySelectorAll('input[name="base-layer"]').forEach(r => {
    r.addEventListener('change', e => selectBase(e.target.value, true));
  });
  document.querySelectorAll('input[name="overlay"]').forEach(cb => {
    cb.addEventListener('change', e => {
      e.target.checked ? addOverlay(e.target.value) : removeOverlay(e.target.value);
      // Show stat pills for new layers when enabled
      if (e.target.value === 'earthquakes') document.getElementById('quake-stat-pill').style.display = '';
      if (e.target.value === 'cyclones')    document.getElementById('cyclone-stat-pill').style.display = '';
      syncUrl();
    });
  });
}

function selectBase(key, doSync = true) {
  Object.values(baseLayers).forEach(l => { if (map.hasLayer(l)) map.removeLayer(l); });
  document.querySelectorAll('.layer-option').forEach(el => el.classList.remove('active'));
  baseLayers[key]?.addTo(map);
  activeBaseKey = key;
  bringOverlaysToFront();
  document.querySelector(`.layer-option[data-layer="${key}"]`)?.classList.add('active');
  onZoomEnd();
  if (doSync) syncUrl();
}

function bringOverlaysToFront() {
  [thermalLayer, aerosolLayer, lstLayer, ndviLayer, nightLayer, shipsLayer, labelsLayer,
   window.earthquakeLayer, window.lightningLayer, window.cyclonesLayer, window.precipLayer]
    .forEach(l => { if (l && map.hasLayer(l)) l.bringToFront?.(); });
  fireLayer?.bringToFront?.();
  aircraftLayer?.bringToFront?.();
}

function addOverlay(key) {
  const l = overlayMap[key]?.();
  if (l && !map.hasLayer(l)) { l.addTo(map); bringOverlaysToFront(); }
}
function removeOverlay(key) {
  const l = overlayMap[key]?.();
  if (l && map.hasLayer(l)) map.removeLayer(l);
}

// ── Capabilities ──────────────────────────────────────────────────────────────

async function checkCapabilities() {
  try {
    const caps = await fetch('/api/capabilities').then(r => r.json());
    if (caps.mapbox) {
      document.getElementById('mapbox-option').style.display = '';
      showToast('Mapbox Satellite enabled — sub-meter imagery at zoom 22', 'success');
    }
    if (!caps.firms) document.getElementById('mode-badge').style.display = 'inline-flex';
  } catch (_) {}
}

// ── Context menu ──────────────────────────────────────────────────────────────

let contextLatLng = null;

function showContextMenu(e) {
  contextLatLng = e.latlng;
  const menu    = document.getElementById('context-menu');
  const mapRect = document.getElementById('map').getBoundingClientRect();
  let x = e.originalEvent.clientX - mapRect.left;
  let y = e.originalEvent.clientY - mapRect.top;
  if (x + 170 > mapRect.width)  x = mapRect.width  - 175;
  if (y + 140 > mapRect.height) y = mapRect.height - 145;
  menu.style.left = x + 'px'; menu.style.top = y + 'px'; menu.style.display = 'block';
}

function hideContextMenu() { document.getElementById('context-menu').style.display = 'none'; }

function initContextMenu() {
  document.getElementById('ctx-pin').addEventListener('click', () => {
    if (contextLatLng) addPin(contextLatLng.lat, contextLatLng.lng, true);
    hideContextMenu();
  });
  document.getElementById('ctx-copy-coords').addEventListener('click', () => {
    if (contextLatLng) window.copyText(`${contextLatLng.lat.toFixed(6)}, ${contextLatLng.lng.toFixed(6)}`, 'Coordinates copied!');
    hideContextMenu();
  });
  document.getElementById('ctx-center').addEventListener('click', () => {
    if (contextLatLng) map.panTo(contextLatLng);
    hideContextMenu();
  });
  document.getElementById('ctx-share').addEventListener('click', () => {
    if (contextLatLng) window.copyText(buildShareUrl(contextLatLng.lat, contextLatLng.lng, map.getZoom()), 'Location link copied!');
    hideContextMenu();
  });
  document.getElementById('ctx-zoom-in').addEventListener('click', () => {
    if (contextLatLng) map.setView(contextLatLng, map.getZoom() + 2);
    hideContextMenu();
  });
  document.addEventListener('click', e => {
    if (!e.target.closest('#context-menu')) hideContextMenu();
  });
}

// ── Pin mode ──────────────────────────────────────────────────────────────────

function setMode(mode) {
  interactionMode = mode;
  const mc = map.getContainer();
  mc.classList.remove('pin-cursor', 'trace-cursor');
  document.getElementById('pin-btn').classList.remove('active-tool');
  document.getElementById('trace-btn').classList.remove('active-tool');

  if (mode === 'pin') {
    mc.classList.add('pin-cursor');
    document.getElementById('pin-btn').classList.add('active-tool');
    showToast('Pin mode — click the map to drop a pin', 'info');
  } else if (mode === 'trace') {
    mc.classList.add('trace-cursor');
    document.getElementById('trace-btn').classList.add('active-tool');
    showToast('Trace mode — click waypoints; double-click or Finish to complete', 'info');
    if (!tracePoly) {
      tracePoly = L.polyline([], { color: '#00d4ff', weight: 2.5, dashArray: '7,5', opacity: 0.9 }).addTo(map);
    }
  }
}

function togglePinMode() { setMode(interactionMode === 'pin' ? 'normal' : 'pin'); }

async function addPin(lat, lon, openPopup = true) {
  pins.push([lat, lon]);
  const icon = L.divIcon({
    html: `<div class="map-pin"><svg viewBox="0 0 24 36" width="24" height="36" xmlns="http://www.w3.org/2000/svg">
      <path d="M12 0C5.4 0 0 5.4 0 12c0 9 12 24 12 24S24 21 24 12C24 5.4 18.6 0 12 0z" fill="#00d4ff" stroke="#0a2040" stroke-width="1.5"/>
      <circle cx="12" cy="12" r="5" fill="#fff"/></svg></div>`,
    className: '', iconSize: [24, 36], iconAnchor: [12, 36], popupAnchor: [0, -38],
  });
  const marker = L.marker([lat, lon], { icon, draggable: true }).addTo(map);
  pinMarkers.push(marker);
  const idx   = pinMarkers.length - 1;
  const place = await reverseGeocode(lat, lon);
  setPinPopup(marker, lat, lon, place, idx);

  marker.on('dragend', async ev => {
    const pos = ev.target.getLatLng();
    pins[idx] = [pos.lat, pos.lng];
    const p2  = await reverseGeocode(pos.lat, pos.lng);
    setPinPopup(marker, pos.lat, pos.lng, p2, idx);
    syncUrl();
  });

  if (openPopup) setTimeout(() => marker.openPopup(), 100);
  syncUrl();
}

function setPinPopup(marker, lat, lon, place, idx) {
  const shareUrl = buildShareUrl(lat, lon, Math.max(map.getZoom(), 12));
  const coordStr = `${lat.toFixed(6)}, ${lon.toFixed(6)}`;
  marker.bindPopup(`
    <div class="pin-popup">
      <h4>📍 Location Pin</h4>
      <div class="pin-place">${place}</div>
      <div class="pin-coords">${lat.toFixed(6)}°N &nbsp; ${lon.toFixed(6)}°E</div>
      <div class="pin-btns">
        <button class="pp-btn" onclick="window.copyText('${coordStr}','Coordinates copied!')">📋 Copy Coords</button>
        <button class="pp-btn pp-share" onclick="window.copyText('${shareUrl}','Share link copied! ✓')">🔗 Share Link</button>
        <button class="pp-btn pp-del" onclick="window.removePin(${idx})">🗑 Remove</button>
      </div>
    </div>`);
}

window.removePin = function (idx) {
  if (pinMarkers[idx]) { map.removeLayer(pinMarkers[idx]); pinMarkers[idx] = null; }
  pins[idx] = null;
  syncUrl();
};

function clearPins() {
  pinMarkers.forEach(m => { if (m) map.removeLayer(m); });
  pinMarkers = []; pins = [];
  syncUrl();
  showToast('All pins cleared', 'info');
}

async function reverseGeocode(lat, lon) {
  try {
    const url  = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&accept-language=en`;
    const data = await fetch(url, { headers: { 'User-Agent': 'AfricaLiveEye/2.0' } }).then(r => r.json());
    return data.display_name?.split(',').slice(0, 3).join(', ') || `${lat.toFixed(4)}°, ${lon.toFixed(4)}°`;
  } catch (_) { return `${lat.toFixed(4)}°N, ${lon.toFixed(4)}°E`; }
}

// ── Trace mode ────────────────────────────────────────────────────────────────

function toggleTraceMode() {
  if (interactionMode === 'trace') finishTrace();
  else setMode('trace');
}

function addTracePoint(lat, lon) {
  traceCoords.push([lat, lon]);
  tracePoly.setLatLngs(traceCoords);
  const dot = L.circleMarker([lat, lon], {
    radius: 5, fillColor: '#00d4ff', color: '#fff', weight: 1.5, fillOpacity: 1,
  }).addTo(map);
  traceDots.push(dot);
  if (traceCoords.length > 1) updateTraceDistBanner(haversineTotal(traceCoords));
  syncUrl();
}

function finishTrace() {
  if (traceCoords.length > 1) {
    const km = haversineTotal(traceCoords);
    showToast(`Route: ${km.toFixed(1)} km  (${(km * 0.621371).toFixed(1)} mi)`, 'success');
  }
  setMode('normal');
}

function clearTrace() {
  if (tracePoly) { map.removeLayer(tracePoly); tracePoly = null; }
  traceDots.forEach(d => map.removeLayer(d));
  traceDots = []; traceCoords = [];
  document.getElementById('trace-banner')?.remove();
  syncUrl();
  showToast('Route cleared', 'info');
}

function updateTraceDistBanner(km) {
  let el = document.getElementById('trace-banner');
  if (!el) {
    el = document.createElement('div');
    el.id = 'trace-banner'; el.className = 'trace-banner';
    const clearBtn = document.createElement('button');
    clearBtn.className = 'trace-clear-btn'; clearBtn.textContent = '✕ Clear';
    clearBtn.addEventListener('click', clearTrace);
    el.appendChild(clearBtn);
    document.body.appendChild(el);
  }
  const text = `📏 Route: ${km.toFixed(1)} km  (${(km * 0.621371).toFixed(1)} mi)   `;
  const textNode = el.childNodes[0];
  if (textNode && textNode.nodeType === Node.TEXT_NODE) textNode.nodeValue = text;
  else el.insertBefore(document.createTextNode(text), el.firstChild);
}

function restoreTrace(pts) {
  traceCoords = pts;
  tracePoly = L.polyline(pts, { color: '#00d4ff', weight: 2.5, dashArray: '7,5', opacity: 0.9 }).addTo(map);
  pts.forEach(pt => {
    const d = L.circleMarker(pt, { radius: 5, fillColor: '#00d4ff', color: '#fff', weight: 1.5, fillOpacity: 1 }).addTo(map);
    traceDots.push(d);
  });
  updateTraceDistBanner(haversineTotal(pts));
}

function haversineTotal(coords) {
  const R = 6371; let total = 0;
  for (let i = 1; i < coords.length; i++) {
    const [la1, lo1] = coords[i - 1], [la2, lo2] = coords[i];
    const dLat = (la2 - la1) * Math.PI / 180, dLon = (lo2 - lo1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(la1 * Math.PI / 180) * Math.cos(la2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
    total += R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }
  return total;
}

// ── Share modal ───────────────────────────────────────────────────────────────

function openShareModal() {
  const url   = buildShareUrl();
  const input = document.getElementById('share-url-input');
  input.value = url;
  document.getElementById('qr-img').src =
    `https://api.qrserver.com/v1/create-qr-code/?size=190x190&color=00d4ff&bgcolor=080b14&data=${encodeURIComponent(url)}`;
  document.getElementById('share-modal').style.display = 'flex';
  setTimeout(() => input.select(), 50);
}

function initShareModal() {
  document.getElementById('share-btn').addEventListener('click', openShareModal);
  document.getElementById('share-modal-close').addEventListener('click', () => document.getElementById('share-modal').style.display = 'none');
  document.getElementById('share-modal-backdrop').addEventListener('click', () => document.getElementById('share-modal').style.display = 'none');
  document.getElementById('copy-url-btn').addEventListener('click', () => {
    window.copyText(document.getElementById('share-url-input').value, 'Map link copied! ✓');
  });
  document.getElementById('share-url-input').addEventListener('click', e => e.target.select());
}

// ── Export ────────────────────────────────────────────────────────────────────

function initExport() {
  document.getElementById('export-btn').addEventListener('click', () => {
    const dd = document.getElementById('export-dropdown');
    dd.style.display = dd.style.display === 'block' ? 'none' : 'block';
  });
  document.addEventListener('click', e => {
    if (!e.target.closest('.export-wrap')) document.getElementById('export-dropdown').style.display = 'none';
  });
  document.getElementById('exp-png').addEventListener('click', () => {
    exportPng(2); document.getElementById('export-dropdown').style.display = 'none';
  });
  document.getElementById('exp-4k').addEventListener('click', () => {
    export4K();  document.getElementById('export-dropdown').style.display = 'none';
  });
  document.getElementById('exp-print').addEventListener('click', () => {
    window.print(); document.getElementById('export-dropdown').style.display = 'none';
  });
}

function exportPng(scale = 2) {
  if (typeof html2canvas === 'undefined') { showToast('Capture library not loaded', 'error'); return; }
  showToast('Capturing map…', 'info');
  html2canvas(document.getElementById('map'), { useCORS: true, allowTaint: true, scale, logging: false })
    .then(canvas => {
      const ts = new Date().toISOString().slice(0, 16).replace(/[:.]/g, '-');
      const a  = document.createElement('a');
      a.download = `africa-live-eye-${ts}.png`; a.href = canvas.toDataURL('image/png'); a.click();
      showToast('PNG saved!', 'success');
    }).catch(() => showToast('Export failed — use Print instead', 'error'));
}

async function export4K() {
  if (typeof html2canvas === 'undefined') { window.print(); return; }
  const mapEl  = document.getElementById('map');
  const center = map.getCenter(), zoom = map.getZoom();
  showToast('Rendering 4K — please wait ~10 s…', 'info');
  ['topbar','sidebar','bottombar','sidebar-toggle'].forEach(id => { document.getElementById(id).style.visibility = 'hidden'; });
  mapEl.style.cssText += ';position:fixed!important;left:0!important;top:0!important;width:3840px!important;height:2160px!important';
  map.invalidateSize({ pan: false });
  map.setView(center, zoom, { animate: false });
  await new Promise(r => setTimeout(r, 6000));
  try {
    const canvas = await html2canvas(mapEl, { useCORS: true, allowTaint: true, scale: 1, logging: false });
    const ts = new Date().toISOString().slice(0, 16).replace(/[:.]/g, '-');
    const a  = document.createElement('a');
    a.download = `africa-live-eye-4K-${ts}.png`; a.href = canvas.toDataURL('image/png'); a.click();
    showToast('4K PNG saved!', 'success');
  } catch { showToast('4K capture failed — use Print instead', 'error'); }
  finally {
    mapEl.style.cssText = mapEl.style.cssText
      .replace(/position:[^;]+;|left:[^;]+;|top:[^;]+;|width:[^;]+;|height:[^;]+;/g, '');
    map.invalidateSize({ pan: false }); map.setView(center, zoom, { animate: false });
    ['topbar','sidebar','bottombar','sidebar-toggle'].forEach(id => { document.getElementById(id).style.visibility = ''; });
  }
}

// ── Fire rendering ────────────────────────────────────────────────────────────

function renderFires(data) {
  lastFires = data.fires || [];
  fireLayer.clearLayers();

  lastFires.forEach(f => {
    const color  = fireColor(f.confidence);
    const radius = Math.max(4, Math.min(14, 4 + (f.frp || 10) / 11));
    L.circleMarker([f.lat, f.lon], { radius: radius + 5, fillColor: color, color: 'transparent', fillOpacity: 0.13, interactive: false }).addTo(fireLayer);
    L.circleMarker([f.lat, f.lon], { radius, fillColor: color, color: '#1a0800', weight: 0.8, fillOpacity: 0.88 })
      .bindPopup(firePopupHtml(f))
      .bindTooltip(`🔥 ${f.frp ? f.frp.toFixed(0) + ' MW' : ''} · ${f.confidence || ''}`, { direction: 'top', offset: [0, -4] })
      .addTo(fireLayer);
  });

  document.getElementById('stat-fires').textContent = lastFires.length.toLocaleString();
  if (data.mode === 'demo') document.getElementById('mode-badge').style.display = 'inline-flex';
  if (activeFeedTab === 'fires') renderFeed('fires');

  // Run alert zone checks
  const eqs = window.lastEarthquakes ? window.lastEarthquakes() : [];
  if (window.checkAlerts) window.checkAlerts(lastFires, eqs);

  // Refresh analytics if open
  if (window.refreshAnalytics) window.refreshAnalytics();
}

function fireColor(conf) {
  const c = String(conf || '').toLowerCase();
  if (c === 'high'    || parseFloat(c) > 80) return '#ff2200';
  if (c === 'nominal' || parseFloat(c) > 40) return '#ff8800';
  return '#ffd000';
}

function firePopupHtml(f) {
  const shareUrl = buildShareUrl(f.lat, f.lon, 12);
  return `<div class="fire-popup">
    <h4>🔥 Active Fire Hotspot</h4>
    <table>
      <tr><td>Date / Time</td><td>${f.date || '—'} ${fmtTime(f.time)} UTC</td></tr>
      <tr><td>Satellite</td><td>${f.satellite || 'VIIRS'}</td></tr>
      <tr><td>Confidence</td><td class="conf-${String(f.confidence||'').toLowerCase()}">${f.confidence || '—'}</td></tr>
      <tr><td>Fire Power</td><td>${f.frp ? f.frp.toFixed(1) + ' MW' : 'N/A'}</td></tr>
      <tr><td>Coordinates</td><td>${f.lat.toFixed(4)}°N, ${f.lon.toFixed(4)}°E</td></tr>
    </table>
    <div class="popup-actions">
      <button class="pp-btn" onclick="window.copyText('${f.lat.toFixed(6)}, ${f.lon.toFixed(6)}','Copied!')">📋 Coords</button>
      <button class="pp-btn pp-share" onclick="window.copyText('${shareUrl}','Link copied!')">🔗 Share</button>
    </div>
  </div>`;
}

function fmtTime(t) {
  if (!t) return '';
  const s = String(t).padStart(4, '0');
  return `${s.slice(0, 2)}:${s.slice(2)}`;
}

// ── Aircraft rendering ────────────────────────────────────────────────────────

function renderAircraft(data) {
  lastAircraft = data.aircraft || [];
  aircraftLayer.clearLayers();

  lastAircraft.forEach(a => {
    const icon = L.divIcon({
      html: `<div style="transform:rotate(${a.heading || 0}deg);line-height:1">
        <svg viewBox="0 0 24 24" width="15" height="15" fill="#00d4ff" xmlns="http://www.w3.org/2000/svg">
          <path d="M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z"/>
        </svg></div>`,
      className: '', iconSize: [15, 15], iconAnchor: [7, 7],
    });
    const shareUrl = buildShareUrl(a.lat, a.lon, 10);
    const alt   = a.altitude ? Math.round(a.altitude).toLocaleString() + ' m' : 'N/A';
    const speed = a.speed    ? Math.round(a.speed * 3.6) + ' km/h'            : 'N/A';
    const vr    = a.vrate    ? (a.vrate > 0 ? '↑' : '↓') + Math.abs(a.vrate).toFixed(1) + ' m/s' : 'Level';
    L.marker([a.lat, a.lon], { icon })
      .bindPopup(`<div class="aircraft-popup">
        <h4>✈️ ${a.callsign || a.icao24 || 'Unknown'}</h4>
        <table>
          <tr><td>Country</td><td>${a.country || '—'}</td></tr>
          <tr><td>Altitude</td><td>${alt}</td></tr>
          <tr><td>Speed</td><td>${speed}</td></tr>
          <tr><td>Heading</td><td>${a.heading ? Math.round(a.heading) + '°' : '—'}</td></tr>
          <tr><td>Vertical</td><td>${vr}</td></tr>
        </table>
        <div class="popup-actions">
          <button class="pp-btn pp-share" onclick="window.copyText('${shareUrl}','Link copied!')">🔗 Share</button>
        </div>
      </div>`)
      .bindTooltip(`✈️ ${a.callsign || a.icao24} · ${alt}`, { direction: 'top', offset: [0, -4] })
      .addTo(aircraftLayer);
  });

  document.getElementById('stat-aircraft').textContent = lastAircraft.length.toLocaleString();
  if (activeFeedTab === 'aircraft') renderFeed('aircraft');
}

// ── Activity feed ─────────────────────────────────────────────────────────────

function initFeedTabs() {
  document.querySelectorAll('.feed-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.feed-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeFeedTab = btn.dataset.tab;
      renderFeed(activeFeedTab);
    });
  });
}

function renderFeed(tab) {
  const list = document.getElementById('events-list');

  if (tab === 'fires') {
    const items = lastFires.slice(0, 16);
    if (!items.length) { list.innerHTML = placeholder(); return; }
    list.innerHTML = '';
    items.forEach(f => {
      const card = document.createElement('div');
      card.className = 'event-card fire';
      card.innerHTML = `
        <span class="event-icon">🔥</span>
        <div class="event-body">
          <div class="event-type">Active Fire · <span style="color:#ff8800">${f.confidence||''}</span></div>
          <div class="event-meta">${f.date} ${fmtTime(f.time)} UTC</div>
          <div class="event-meta">${f.lat.toFixed(3)}°, ${f.lon.toFixed(3)}° · ${f.satellite||'VIIRS'}</div>
          ${f.frp ? `<div class="event-frp">${f.frp.toFixed(1)} MW</div>` : ''}
        </div>`;
      card.addEventListener('click', () => map.setView([f.lat, f.lon], 11, { animate: true }));
      list.appendChild(card);
    });
  } else if (tab === 'aircraft') {
    const items = lastAircraft.slice(0, 16);
    if (!items.length) { list.innerHTML = placeholder(); return; }
    list.innerHTML = '';
    items.forEach(a => {
      const card = document.createElement('div');
      card.className = 'event-card aircraft';
      const alt = a.altitude ? Math.round(a.altitude).toLocaleString() + ' m' : '';
      card.innerHTML = `
        <span class="event-icon">✈️</span>
        <div class="event-body">
          <div class="event-type">${a.callsign || a.icao24 || 'Unknown'}</div>
          <div class="event-meta">${a.country || '—'}${alt ? ' · ' + alt : ''}</div>
          ${a.speed ? `<div class="event-meta">${Math.round(a.speed * 3.6)} km/h · ${a.heading ? Math.round(a.heading) + '°' : ''}</div>` : ''}
        </div>`;
      card.addEventListener('click', () => map.setView([a.lat, a.lon], 10, { animate: true }));
      list.appendChild(card);
    });
  } else if (tab === 'earthquakes') {
    const eqs = window.lastEarthquakes ? window.lastEarthquakes() : [];
    if (!eqs.length) { list.innerHTML = placeholder('No earthquakes loaded. Toggle the Earthquakes overlay.'); return; }
    list.innerHTML = '';
    [...eqs].sort((a, b) => b.magnitude - a.magnitude).slice(0, 16).forEach(eq => {
      const card = document.createElement('div');
      card.className = 'event-card quake';
      const age = Math.round((Date.now() - eq.time) / 60000);
      card.innerHTML = `
        <span class="event-icon">🌊</span>
        <div class="event-body">
          <div class="event-type">M${eq.magnitude.toFixed(1)} · ${eq.depth} km deep</div>
          <div class="event-meta">${eq.place?.slice(0, 40)}</div>
          <div class="event-meta">${age < 60 ? age + ' min ago' : Math.round(age/60) + ' h ago'}</div>
        </div>`;
      card.addEventListener('click', () => map.setView([eq.lat, eq.lon], 9, { animate: true }));
      list.appendChild(card);
    });
  } else if (tab === 'cyclones') {
    const cys = window.lastCyclones ? window.lastCyclones() : [];
    if (!cys.length) { list.innerHTML = placeholder('No active cyclones detected.'); return; }
    list.innerHTML = '';
    cys.forEach(cy => {
      const card = document.createElement('div');
      card.className = 'event-card cyclone';
      card.innerHTML = `
        <span class="event-icon">🌀</span>
        <div class="event-body">
          <div class="event-type">${cy.name} · ${cy.severity}</div>
          <div class="event-meta">${cy.windSpeed ? cy.windSpeed + ' kt' : 'N/A'} · ${cy.lat.toFixed(2)}°, ${cy.lon.toFixed(2)}°</div>
          <div class="event-meta">${cy.fromDate?.slice(0,10) || ''}</div>
        </div>`;
      card.addEventListener('click', () => map.setView([cy.lat, cy.lon], 7, { animate: true }));
      list.appendChild(card);
    });
  }
}

function placeholder(msg = '') {
  return `<div class="events-placeholder">${msg ? `<span>${msg}</span>` : '<div class="spinner"></div><span>Loading…</span>'}</div>`;
}

// ── Socket.IO ─────────────────────────────────────────────────────────────────

function initSocket() {
  try { socket = io({ transports: ['websocket', 'polling'] }); }
  catch (_) { startPollingFallback(); return; }

  socket.on('connect',    () => setConnStatus(true));
  socket.on('disconnect', () => setConnStatus(false));

  socket.on('fire-data',     data => renderFires(data));
  socket.on('aircraft-data', data => renderAircraft(data));

  socket.on('earthquake-data', data => {
    if (window.renderEarthquakes) window.renderEarthquakes(data);
    if (activeFeedTab === 'earthquakes') renderFeed('earthquakes');
    if (window._onNewEarthquakes) window._onNewEarthquakes();
    // Alert checks
    const eqs = data.earthquakes || [];
    if (window.checkAlerts) window.checkAlerts(lastFires, eqs);
  });

  socket.on('cyclone-data', data => {
    if (window.renderCyclones) window.renderCyclones(data);
    if (activeFeedTab === 'cyclones') renderFeed('cyclones');
  });

  socket.on('lightning-strike', strike => {
    if (window.addLightningStrike) window.addLightningStrike(strike);
  });

  socket.on('lightning-history', data => {
    if (window.loadLightningHistory) window.loadLightningHistory(data);
  });
}

function startPollingFallback() {
  const poll = async () => {
    try {
      const [fr, ar] = await Promise.all([
        fetch('/api/fires').then(r => r.json()),
        fetch('/api/aircraft').then(r => r.json()),
      ]);
      renderFires(fr); renderAircraft(ar);
    } catch (_) {}
  };
  poll();
  setInterval(poll, 45000);
}

function setConnStatus(on) {
  const d = document.getElementById('connection-status');
  if (d) d.className = `status-dot ${on ? 'live' : 'offline'}`;
}

// ── Search ────────────────────────────────────────────────────────────────────

function initSearch() {
  const input = document.getElementById('search-input');
  const btn   = document.getElementById('search-btn');
  const res   = document.getElementById('search-results');
  let debounce;
  const doSearch = () => { if (input.value.trim().length > 1) search(input.value.trim(), res); };
  btn.addEventListener('click', doSearch);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') doSearch(); });
  input.addEventListener('input', () => { clearTimeout(debounce); debounce = setTimeout(doSearch, 420); });
  document.addEventListener('click', e => { if (!e.target.closest('.search-box')) res.classList.remove('open'); });
}

async function search(q, results) {
  results.classList.add('open');
  results.innerHTML = '<div class="search-item hint">Searching…</div>';
  try {
    const url = new URL('https://nominatim.openstreetmap.org/search');
    url.searchParams.set('q', q); url.searchParams.set('format', 'json');
    url.searchParams.set('limit', '6'); url.searchParams.set('viewbox', '-22,-40,54,40');
    url.searchParams.set('accept-language', 'en');
    const data = await fetch(url.toString(), { headers: { 'User-Agent': 'AfricaLiveEye/2.0' } }).then(r => r.json());
    if (!data.length) { results.innerHTML = '<div class="search-item hint">No results</div>'; return; }
    results.innerHTML = '';
    data.forEach(item => {
      const div = document.createElement('div');
      div.className   = 'search-item';
      div.textContent = item.display_name.length > 65 ? item.display_name.slice(0, 65) + '…' : item.display_name;
      div.addEventListener('click', () => {
        map.setView([+item.lat, +item.lon], 13, { animate: true });
        results.classList.remove('open');
        document.getElementById('search-input').value = item.display_name.split(',')[0];
      });
      results.appendChild(div);
    });
  } catch (_) { results.innerHTML = '<div class="search-item hint">Search unavailable</div>'; }
}

// ── Refresh ───────────────────────────────────────────────────────────────────

function initRefresh() {
  document.getElementById('refresh-btn').addEventListener('click', () => {
    document.getElementById('refresh-btn').classList.add('spinning');
    map.eachLayer(l => { if (l.redraw) l.redraw(); });
    socket?.connected ? socket.emit('request-refresh') : startPollingFallback();
    setTimeout(() => document.getElementById('refresh-btn').classList.remove('spinning'), 1800);
    showToast('Refreshing all data sources…', 'info');
  });
}

// ── Sidebar ───────────────────────────────────────────────────────────────────

function initSidebar() {
  const toggle = document.getElementById('sidebar-toggle');
  const isMob  = () => window.innerWidth <= 768;
  toggle.addEventListener('click', () => {
    isMob() ? document.body.classList.toggle('sidebar-open')
            : document.body.classList.toggle('sidebar-collapsed');
    setTimeout(() => { map.invalidateSize(); }, 240);
  });
}

// ── Toolbar ───────────────────────────────────────────────────────────────────

function initToolbar() {
  document.getElementById('pin-btn').addEventListener('click', togglePinMode);
  document.getElementById('trace-btn').addEventListener('click', toggleTraceMode);
  document.getElementById('clear-pins-btn').addEventListener('click', clearPins);
  document.getElementById('clear-trace-btn').addEventListener('click', clearTrace);
}

// ── User Location ─────────────────────────────────────────────────────────────

let userLocationMarker = null;

function initLocateMe() {
  const btn = document.getElementById('locate-btn');
  if (!btn) return;

  btn.addEventListener('click', () => {
    if (!navigator.geolocation) {
      showToast('Geolocation not supported by your browser', 'error');
      return;
    }
    btn.disabled = true;
    btn.innerHTML = '⏳ <span class="tool-label">Locating…</span>';

    navigator.geolocation.getCurrentPosition(
      pos => {
        const { latitude: lat, longitude: lon, accuracy } = pos.coords;
        btn.disabled = false;
        btn.innerHTML = '🎯 <span class="tool-label">Locate Me</span>';

        if (userLocationMarker) map.removeLayer(userLocationMarker);

        const icon = L.divIcon({
          html: '<div class="user-location-marker"><div class="user-location-pulse"></div></div>',
          className: '',
          iconSize:   [20, 20],
          iconAnchor: [10, 10],
        });

        userLocationMarker = L.marker([lat, lon], { icon, zIndexOffset: 1000 })
          .bindPopup(`<div class="pin-popup">
            <h4>🎯 Your Location</h4>
            <div class="pin-coords">${lat.toFixed(5)}°N &nbsp; ${lon.toFixed(5)}°E</div>
            <div class="pin-coords" style="font-size:11px;color:#6b7a94">Accuracy: ±${Math.round(accuracy)} m</div>
            <div class="pin-btns">
              <button class="pp-btn" onclick="window.copyText('${lat.toFixed(6)}, ${lon.toFixed(6)}','Coordinates copied!')">📋 Copy Coords</button>
              <button class="pp-btn pp-share" onclick="window.copyText('${buildShareUrl(lat, lon, 14)}','Location link copied!')">🔗 Share Location</button>
            </div>
          </div>`)
          .addTo(map)
          .openPopup();

        map.setView([lat, lon], Math.max(map.getZoom(), 12), { animate: true });

        if (socket?.connected) socket.emit('user-location', { lat, lon, accuracy, ts: Date.now() });

        showToast(`Location found · ±${Math.round(accuracy)} m`, 'success');
      },
      err => {
        btn.disabled = false;
        btn.innerHTML = '🎯 <span class="tool-label">Locate Me</span>';
        const msgs = { 1: 'Location access denied — allow in browser settings', 2: 'Position unavailable', 3: 'Location request timed out' };
        showToast(msgs[err.code] || 'Could not get location', 'error');
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 }
    );
  });
}

// ── Toast ─────────────────────────────────────────────────────────────────────

function showToast(msg, type = 'info') {
  const wrap = document.getElementById('toast-container');
  const t    = document.createElement('div');
  t.className = `toast toast-${type}`;
  t.textContent = msg;
  wrap.appendChild(t);
  requestAnimationFrame(() => requestAnimationFrame(() => t.classList.add('show')));
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 250); }, 3800);
}
window.showToast = showToast;

// ── Bootstrap ─────────────────────────────────────────────────────────────────

async function init() {
  initMap();
  startClock();
  initDateSlider();
  initLayerControls();
  initFeedTabs();
  initRefresh();
  initSearch();
  initSidebar();
  initToolbar();
  initLocateMe();
  initContextMenu();
  initShareModal();
  initExport();
  await checkCapabilities();
  restoreFromUrl();
  initSocket();
  document.getElementById('zoom-level').textContent = `Zoom ${INIT_ZOOM}`;

  // Initialize feature modules (wait for DOM + deferred scripts)
  setTimeout(() => {
    if (window.initOverlays)   window.initOverlays();
    if (window.initAnimation)  window.initAnimation();
    if (window.initSplitScreen) window.initSplitScreen();
    if (window.initAnalytics)  window.initAnalytics();
    if (window.initAlerts)     window.initAlerts();
    if (window.initReport)     window.initReport();
  }, 300);

  setTimeout(() => showToast('Africa Live Eye v2 ready — right-click map for options', 'success'), 900);
}

document.addEventListener('DOMContentLoaded', init);
