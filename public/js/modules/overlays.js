'use strict';

// ── Live Threat Overlay Module ─────────────────────────────────────────────
// Handles: Lightning, Earthquakes, Cyclones, Precipitation (GIBS)

let earthquakeLayer, lightningLayer, cyclonesLayer, precipLayer;
let lastEarthquakes = [], lastCyclones = [];
let lightningRecent = [];          // last 5 min shown persistently
const LIGHTNING_PERSIST_MS = 5 * 60_000;

function initOverlays() {
  earthquakeLayer = L.layerGroup();
  lightningLayer  = L.layerGroup();
  cyclonesLayer   = L.layerGroup();

  // GIBS precipitation layer (GPM IMERG)
  precipLayer = L.tileLayer(
    `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/GPM_3IMERGHH_06_precipitationCal/default/${currentDate}/2km/{z}/{y}/{x}.png`,
    { maxNativeZoom: 6, maxZoom: 22, opacity: 0.75, attribution: 'NASA GPM IMERG', crossOrigin: 'anonymous',
      errorTileUrl: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7' }
  );

  // Wire into the global overlay map
  overlayMap.lightning   = () => lightningLayer;
  overlayMap.earthquakes = () => earthquakeLayer;
  overlayMap.cyclones    = () => cyclonesLayer;
  overlayMap.precip      = () => precipLayer;

  // Expose on window so app.js applyDate() can update the tile URL
  window.precipLayer     = precipLayer;
  window.lightningLayer  = lightningLayer;
  window.earthquakeLayer = earthquakeLayer;
  window.cyclonesLayer   = cyclonesLayer;

  // Periodically clean old lightning dots
  setInterval(pruneOldLightning, 30_000);
}

// ── Earthquake rendering ─────────────────────────────────────────────────────

function renderEarthquakes(data) {
  lastEarthquakes = data.earthquakes || [];
  earthquakeLayer.clearLayers();

  lastEarthquakes.forEach(eq => {
    const radius = Math.max(6, Math.min(30, eq.magnitude * 4));
    const color  = eq.depth < 30  ? '#ff2244' :
                   eq.depth < 70  ? '#ff8800' :
                   eq.depth < 300 ? '#ffdd00' : '#8899ff';
    const pulse  = eq.depth < 50 && eq.magnitude >= 5;

    const glow = L.circleMarker([eq.lat, eq.lon], {
      radius: radius + 8, fillColor: color, color: 'transparent', fillOpacity: 0.12, interactive: false,
    });
    const marker = L.circleMarker([eq.lat, eq.lon], {
      radius, fillColor: color, color: '#1a0010', weight: 1, fillOpacity: 0.82,
      className: pulse ? 'eq-pulse' : '',
    });

    const age    = Date.now() - eq.time;
    const ageStr = age < 3600000 ? `${Math.round(age / 60000)} min ago` :
                   age < 86400000 ? `${Math.round(age / 3600000)} h ago` : 'Over 24h ago';

    marker.bindTooltip(`M${eq.magnitude.toFixed(1)} · ${eq.depth}km · ${ageStr}`, { direction: 'top', offset: [0, -4] });
    marker.bindPopup(earthquakePopup(eq));

    glow.addTo(earthquakeLayer);
    marker.addTo(earthquakeLayer);
  });

  updateEqFeed();
}

function earthquakePopup(eq) {
  const d = new Date(eq.time);
  const share = buildShareUrl(eq.lat, eq.lon, 10);
  return `<div class="quake-popup">
    <h4>🌊 Earthquake — M${eq.magnitude.toFixed(1)}</h4>
    <table>
      <tr><td>Location</td><td>${eq.place}</td></tr>
      <tr><td>Depth</td><td>${eq.depth} km</td></tr>
      <tr><td>Time UTC</td><td>${d.toUTCString()}</td></tr>
      <tr><td>Coordinates</td><td>${eq.lat.toFixed(4)}°, ${eq.lon.toFixed(4)}°</td></tr>
    </table>
    <div class="popup-actions">
      <button class="pp-btn" onclick="window.copyText('${eq.lat.toFixed(6)}, ${eq.lon.toFixed(6)}','Copied!')">📋 Coords</button>
      <button class="pp-btn pp-share" onclick="window.copyText('${share}','Link copied!')">🔗 Share</button>
      ${eq.usgsUrl ? `<a class="pp-btn" href="${eq.usgsUrl}" target="_blank" rel="noopener">🔍 USGS</a>` : ''}
    </div>
  </div>`;
}

function updateEqFeed() {
  const countEl = document.getElementById('stat-earthquakes');
  if (countEl) countEl.textContent = lastEarthquakes.length;
}

// ── Lightning rendering ──────────────────────────────────────────────────────

function addLightningStrike(strike) {
  if (!map.hasLayer(lightningLayer)) return;

  // Flash marker (animates out)
  const flashIcon = L.divIcon({
    html: `<div class="lightning-flash ${strike.pol < 0 ? 'neg' : 'pos'}"></div>`,
    className: '', iconSize: [18, 18], iconAnchor: [9, 9],
  });
  const flash = L.marker([strike.lat, strike.lon], { icon: flashIcon, interactive: false });
  flash.addTo(lightningLayer);
  setTimeout(() => { if (lightningLayer.hasLayer(flash)) lightningLayer.removeLayer(flash); }, 1800);

  // Persistent dot for last 5 min
  const dotIcon = L.divIcon({
    html: `<div class="lightning-dot"></div>`,
    className: '', iconSize: [5, 5], iconAnchor: [2, 2],
  });
  const dot = L.marker([strike.lat, strike.lon], { icon: dotIcon, interactive: false });
  dot.addTo(lightningLayer);
  lightningRecent.push({ marker: dot, time: strike.time || Date.now() });
}

function loadLightningHistory(data) {
  const { strikes = [], live } = data;
  const badge = document.getElementById('lightning-badge');
  if (badge) badge.textContent = live ? 'LIVE' : 'DEMO';

  lightningRecent.forEach(r => { if (lightningLayer.hasLayer(r.marker)) lightningLayer.removeLayer(r.marker); });
  lightningRecent = [];

  strikes.forEach(s => addLightningStrike({ ...s, time: s.time }));
}

function pruneOldLightning() {
  const cutoff = Date.now() - LIGHTNING_PERSIST_MS;
  lightningRecent = lightningRecent.filter(r => {
    if (r.time < cutoff) {
      if (lightningLayer.hasLayer(r.marker)) lightningLayer.removeLayer(r.marker);
      return false;
    }
    return true;
  });
}

// ── Cyclone rendering ────────────────────────────────────────────────────────

function renderCyclones(data) {
  lastCyclones = data.cyclones || [];
  cyclonesLayer.clearLayers();

  lastCyclones.forEach(cy => {
    const color = cy.severity === 'Red' ? '#ff2244' : cy.severity === 'Orange' ? '#ff8800' : '#00e887';
    const icon  = L.divIcon({
      html: `<div class="cyclone-icon" style="border-color:${color}">🌀</div>`,
      className: '', iconSize: [36, 36], iconAnchor: [18, 18],
    });
    L.marker([cy.lat, cy.lon], { icon })
      .bindTooltip(`🌀 ${cy.name} — Cat ${severityCat(cy.severity)}`, { direction: 'top' })
      .bindPopup(cyclonePopup(cy))
      .addTo(cyclonesLayer);
  });

  const el = document.getElementById('stat-cyclones');
  if (el) el.textContent = lastCyclones.length;
}

function cyclonePopup(cy) {
  const share = buildShareUrl(cy.lat, cy.lon, 7);
  return `<div class="cyclone-popup">
    <h4>🌀 Tropical Cyclone: ${cy.name}</h4>
    <table>
      <tr><td>Alert Level</td><td style="color:${cy.severity==='Red'?'#ff2244':cy.severity==='Orange'?'#ff8800':'#00e887'}">${cy.severity}</td></tr>
      <tr><td>Wind Speed</td><td>${cy.windSpeed ? cy.windSpeed + ' kt' : 'N/A'}</td></tr>
      <tr><td>Position</td><td>${cy.lat.toFixed(3)}°, ${cy.lon.toFixed(3)}°</td></tr>
      <tr><td>Since</td><td>${cy.fromDate?.slice(0,10) || 'N/A'}</td></tr>
    </table>
    <div class="popup-actions">
      <button class="pp-btn pp-share" onclick="window.copyText('${share}','Link copied!')">🔗 Share</button>
      ${cy.gdacsUrl ? `<a class="pp-btn" href="${cy.gdacsUrl}" target="_blank" rel="noopener">🔍 GDACS</a>` : ''}
    </div>
  </div>`;
}

function severityCat(s) {
  return s === 'Red' ? '3+' : s === 'Orange' ? '2' : '1';
}

// Expose
window.initOverlays       = initOverlays;
window.renderEarthquakes  = renderEarthquakes;
window.renderCyclones     = renderCyclones;
window.addLightningStrike = addLightningStrike;
window.loadLightningHistory = loadLightningHistory;
window.lastEarthquakes    = () => lastEarthquakes;
window.lastCyclones       = () => lastCyclones;
