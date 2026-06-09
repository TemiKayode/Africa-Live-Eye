'use strict';

require('dotenv').config();

const express    = require('express');
const http       = require('http');
const { Server } = require('socket.io');
const https      = require('https');
const fs         = require('fs');
const path       = require('path');
const NodeCache  = require('node-cache');
const WebSocket  = require('ws');

// ── Session / location logging ────────────────────────────────────────────────
const SESSION_LOG = path.join(__dirname, 'user_sessions.log');
function logSession(obj) {
  fs.appendFile(SESSION_LOG, JSON.stringify(obj) + '\n', () => {});
}

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, { cors: { origin: '*' } });
const cache  = new NodeCache({ stdTTL: 600 });

const PORT                 = parseInt(process.env.PORT || '3000');
const FIRMS_API_KEY        = process.env.FIRMS_API_KEY || '';
const MAPBOX_TOKEN         = process.env.MAPBOX_TOKEN  || '';
const FIRE_UPDATE_INTERVAL = parseInt(process.env.FIRE_UPDATE_INTERVAL_MS || '10800000');
const AIRCRAFT_INTERVAL    = 45_000;
const EARTHQUAKE_INTERVAL  = 5 * 60_000;   // 5 min
const CYCLONE_INTERVAL     = 30 * 60_000;  // 30 min

// ── HTTP helpers ──────────────────────────────────────────────────────────────

function httpsGet(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 4) { reject(new Error('Too many redirects')); return; }
    const req = https.get(url, { timeout: 20000 }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        resolve(httpsGet(res.headers.location, redirects + 1)); return;
      }
      if (res.statusCode !== 200) { reject(new Error(`HTTP ${res.statusCode}`)); return; }
      let body = '';
      res.on('data', c => (body += c));
      res.on('end', () => resolve(body));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

function httpsGetBuffer(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 4) { reject(new Error('Too many redirects')); return; }
    const req = https.get(url, { timeout: 15000 }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        resolve(httpsGetBuffer(res.headers.location, redirects + 1)); return;
      }
      if (res.statusCode !== 200) { reject(new Error(`HTTP ${res.statusCode}`)); return; }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ buffer: Buffer.concat(chunks), contentType: res.headers['content-type'] || 'image/jpeg' }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

function todayUTC() { return new Date().toISOString().split('T')[0]; }

function offsetDate(daysAgo) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - daysAgo);
  return d.toISOString().split('T')[0];
}

// ── FIRMS fire data ───────────────────────────────────────────────────────────

function parseFIRMSCsv(csv) {
  const lines = csv.trim().split('\n');
  if (lines.length < 2) return [];
  const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/[^a-z0-9_]/g, ''));
  const idx = n => headers.indexOf(n);
  const latI = idx('latitude'), lonI = idx('longitude'), dateI = idx('acq_date'),
        timeI = idx('acq_time'), satI = idx('satellite'), confI = idx('confidence'),
        frpI = idx('frp'), brightI = Math.max(idx('bright_ti4'), idx('brightness'));
  if (latI < 0 || lonI < 0) return [];
  const fires = [];
  for (let i = 1; i < lines.length; i++) {
    const c = lines[i].split(',');
    if (c.length < 2) continue;
    const lat = parseFloat(c[latI]), lon = parseFloat(c[lonI]);
    if (isNaN(lat) || isNaN(lon)) continue;
    fires.push({
      lat, lon,
      date:       c[dateI]?.trim()        || todayUTC(),
      time:       c[timeI]?.trim()        || '0000',
      satellite:  c[satI]?.trim()         || 'VIIRS',
      confidence: c[confI]?.trim()        || 'nominal',
      frp:        parseFloat(c[frpI])     || 0,
      brightness: parseFloat(c[brightI])  || 0,
      type: 'fire',
    });
  }
  return fires;
}

function demoFires(days = 1) {
  const base = [
    [-4.3, 20.5, 87.2], [-5.1, 22.8, 63.4], [-3.8, 18.2, 41.0], [-6.2, 24.1, 55.8],
    [-11.5, 16.8, 72.1], [-13.2, 18.4, 38.9], [-14.8, 20.9, 91.3], [-14.2, 29.1, 33.7],
    [-18.6, 30.4, 58.2], [-16.3, 35.2, 44.6], [-8.1, 35.5, 31.4], [7.3, 27.8, 19.8],
    [9.1, 30.2, 37.5], [6.4, 8.3, 66.1], [7.8, 11.5, 29.4], [9.5, 6.1, 53.8],
    [-18.9, 46.3, 17.2], [9.8, 38.7, 24.5], [-19.2, 22.5, 15.8], [12.3, 1.5, 11.2],
    [13.8, 8.7, 13.5], [-2.9, 25.3, 28.5], [-19.8, 33.7, 22.3], [-5.6, 38.2, 49.7],
  ];
  const confs = ['high', 'high', 'nominal', 'nominal', 'low'];
  const fires = [];
  for (let d = 1; d <= days; d++) {
    const date = offsetDate(d);
    // vary count by day: 20-80 fires
    const count = Math.round(35 + Math.sin(d * 1.3) * 22);
    for (let i = 0; i < Math.min(count, base.length); i++) {
      const [lat, lon, frp] = base[i % base.length];
      fires.push({
        lat: lat + (Math.random() - 0.5) * 0.8,
        lon: lon + (Math.random() - 0.5) * 0.8,
        frp: frp * (0.7 + Math.random() * 0.6),
        date, time: String(800 + i * 37).padStart(4, '0'),
        satellite: 'DEMO', confidence: confs[i % confs.length],
        brightness: 320 + frp, type: 'fire',
      });
    }
  }
  return fires;
}

async function fetchFIRMS(days = 1) {
  const key = `firms_${offsetDate(1)}_d${days}`;
  const hit = cache.get(key);
  if (hit) return hit;
  if (!FIRMS_API_KEY) { console.log('[FIRMS] Demo mode'); return demoFires(days); }
  const url = `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${FIRMS_API_KEY}/VIIRS_SNPP_NRT/-20,-36,52,38/${days}`;
  try {
    console.log(`[FIRMS] Fetching ${days}-day data…`);
    const body  = await httpsGet(url);
    const fires = parseFIRMSCsv(body);
    console.log(`[FIRMS] ${fires.length} hotspots (${days}d)`);
    if (fires.length > 0) cache.set(key, fires, days === 1 ? 3600 : 86400);
    return fires.length > 0 ? fires : demoFires(days);
  } catch (e) {
    console.error('[FIRMS]', e.message);
    return demoFires(days);
  }
}

// ── Aircraft ──────────────────────────────────────────────────────────────────

const SKY_BOX = 'lamin=-38&lomin=-22&lamax=40&lomax=54';

async function fetchAircraft() {
  const hit = cache.get('opensky');
  if (hit) return hit;
  try {
    const body = await httpsGet(`https://opensky-network.org/api/states/all?${SKY_BOX}`);
    const data = JSON.parse(body);
    const aircraft = (data.states || [])
      .filter(s => s && s[5] != null && s[6] != null && !s[8])
      .map(s => ({
        icao24: s[0] || '', callsign: (s[1] || '').trim() || null, country: s[2] || '',
        lon: s[5], lat: s[6], altitude: s[7], speed: s[9], heading: s[10], vrate: s[11],
        type: 'aircraft',
      }));
    cache.set('opensky', aircraft, 30);
    console.log(`[OpenSky] ${aircraft.length} aircraft`);
    return aircraft;
  } catch (e) { console.error('[OpenSky]', e.message); return cache.get('opensky') || []; }
}

// ── USGS Earthquakes ──────────────────────────────────────────────────────────

async function fetchEarthquakes() {
  const hit = cache.get('earthquakes');
  if (hit) return hit;
  try {
    const url  = 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson';
    const body = await httpsGet(url);
    const data = JSON.parse(body);
    const africa = (data.features || [])
      .filter(f => {
        const [lon, lat] = f.geometry.coordinates;
        return lat >= -38 && lat <= 40 && lon >= -25 && lon <= 56;
      })
      .map(f => ({
        lat:       f.geometry.coordinates[1],
        lon:       f.geometry.coordinates[0],
        depth:     Math.round(f.geometry.coordinates[2]),
        magnitude: f.properties.mag,
        place:     f.properties.place || 'Unknown region',
        time:      f.properties.time,
        usgsUrl:   f.properties.url,
        type: 'earthquake',
      }));
    console.log(`[USGS] ${africa.length} earthquakes`);
    cache.set('earthquakes', africa, 300);
    return africa;
  } catch (e) { console.error('[USGS]', e.message); return cache.get('earthquakes') || []; }
}

// ── GDACS Cyclones ────────────────────────────────────────────────────────────

async function fetchCyclones() {
  const hit = cache.get('cyclones');
  if (hit) return hit;
  try {
    // GDACS event list — GeoJSON feed
    const url  = 'https://www.gdacs.org/gdacsapi/api/events/geteventlist/GDACS?alertlevel=Green,Orange,Red&eventtype=TC&limit=20&status=current';
    const body = await httpsGet(url);
    const data = JSON.parse(body);
    const storms = (data.features || []).map(f => ({
      lat:       f.geometry?.coordinates?.[1] ?? 0,
      lon:       f.geometry?.coordinates?.[0] ?? 0,
      name:      f.properties?.name        || 'Unnamed',
      severity:  f.properties?.alertlevel  || 'Green',
      windSpeed: f.properties?.maxwind     || 0,
      fromDate:  f.properties?.fromdate    || '',
      gdacsUrl:  f.properties?.url         || '',
      type: 'cyclone',
    })).filter(s => s.lat !== 0 || s.lon !== 0);
    console.log(`[GDACS] ${storms.length} active cyclones`);
    cache.set('cyclones', storms, 1800);
    return storms;
  } catch (e) { console.error('[GDACS]', e.message); return cache.get('cyclones') || []; }
}

// ── Blitzortung Lightning WebSocket ───────────────────────────────────────────

let lightningBuffer = [];
let lightningLive   = false;

// Realistic lightning hotspots over Africa (for synthetic fallback)
const LIGHTNING_ZONES = [
  { lat: [0, 5],   lon: [15, 30], w: 38 },   // Congo Basin — world #1
  { lat: [3, 12],  lon: [-5, 10], w: 22 },   // West Africa / Guinea
  { lat: [7, 15],  lon: [30, 42], w: 18 },   // Ethiopia highlands
  { lat: [-8, 0],  lon: [28, 40], w: 12 },   // East Africa lakes
  { lat: [10, 20], lon: [10, 25], w: 10 },   // Sahel transition
];

function pickSyntheticStrike() {
  let r = Math.random() * 100, cumW = 0;
  for (const z of LIGHTNING_ZONES) {
    cumW += z.w;
    if (r < cumW) {
      return {
        lat: z.lat[0] + Math.random() * (z.lat[1] - z.lat[0]),
        lon: z.lon[0] + Math.random() * (z.lon[1] - z.lon[0]),
        time: Date.now(), pol: Math.random() > 0.5 ? 1 : -1, synthetic: true, type: 'lightning',
      };
    }
  }
  return null;
}

let syntheticTimer = null;
function startSyntheticLightning() {
  if (syntheticTimer) return;
  console.log('[Lightning] Using synthetic mode');
  const fire = () => {
    if (lightningLive) { clearInterval(syntheticTimer); syntheticTimer = null; return; }
    const strike = pickSyntheticStrike();
    if (!strike) return;
    lightningBuffer.push(strike);
    const cutoff = Date.now() - 30 * 60_000;
    lightningBuffer = lightningBuffer.filter(s => s.time > cutoff);
    io.emit('lightning-strike', strike);
    // Vary interval 800ms–3s
    clearInterval(syntheticTimer);
    syntheticTimer = setTimeout(fire, 800 + Math.random() * 2200);
  };
  syntheticTimer = setTimeout(fire, 1000);
}

function connectBlitzortung(attempt = 1) {
  const node = `ws${((attempt - 1) % 8) + 1}.blitzortung.org`;
  const ws   = new WebSocket(`wss://${node}/`, { handshakeTimeout: 8000 });
  let opened = false;

  const failTimeout = setTimeout(() => {
    if (!opened) { ws.terminate(); }
  }, 10000);

  ws.on('open', () => {
    opened = true;
    clearTimeout(failTimeout);
    lightningLive = true;
    if (syntheticTimer) { clearTimeout(syntheticTimer); syntheticTimer = null; }
    console.log(`[Lightning] Live feed from ${node}`);
    // Subscribe to Africa + surrounding ocean
    ws.send(JSON.stringify({ west: -25, east: 55, south: -38, north: 38 }));
  });

  ws.on('message', raw => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.lat == null || msg.lon == null) return;
      const strike = {
        lat: msg.lat, lon: msg.lon,
        time: msg.time ? Math.floor(msg.time / 1e6) : Date.now(),
        pol: msg.pol ?? 0, type: 'lightning',
      };
      lightningBuffer.push(strike);
      const cutoff = Date.now() - 30 * 60_000;
      lightningBuffer = lightningBuffer.filter(s => s.time > cutoff);
      io.emit('lightning-strike', strike);
    } catch (_) {}
  });

  ws.on('close', () => {
    clearTimeout(failTimeout);
    lightningLive = false;
    console.log(`[Lightning] Disconnected from ${node}, retry ${attempt + 1} in 15s`);
    setTimeout(() => connectBlitzortung(attempt + 1), 15000);
    startSyntheticLightning();
  });

  ws.on('error', e => {
    clearTimeout(failTimeout);
    if (opened) return;
    console.error(`[Lightning] ${node}: ${e.message}`);
    ws.terminate();
    startSyntheticLightning();
  });
}

// ── State ─────────────────────────────────────────────────────────────────────

let fireState        = { fires: [], timestamp: null, mode: 'demo' };
let aircraftState    = { aircraft: [], timestamp: null };
let earthquakeState  = { earthquakes: [], timestamp: null };
let cycloneState     = { cyclones: [], timestamp: null };

async function refreshFires() {
  const fires = await fetchFIRMS(1);
  fireState = { fires, timestamp: new Date().toISOString(), mode: FIRMS_API_KEY ? 'live' : 'demo' };
  io.emit('fire-data', fireState);
  console.log(`[WS] Fires: ${fires.length} (${fireState.mode})`);
}

async function refreshAircraft() {
  const aircraft = await fetchAircraft();
  aircraftState  = { aircraft, timestamp: new Date().toISOString() };
  io.emit('aircraft-data', aircraftState);
}

async function refreshEarthquakes() {
  const earthquakes = await fetchEarthquakes();
  earthquakeState   = { earthquakes, timestamp: new Date().toISOString() };
  io.emit('earthquake-data', earthquakeState);
  console.log(`[WS] Earthquakes: ${earthquakes.length}`);
}

async function refreshCyclones() {
  const cyclones = await fetchCyclones();
  cycloneState   = { cyclones, timestamp: new Date().toISOString() };
  io.emit('cyclone-data', cycloneState);
  console.log(`[WS] Cyclones: ${cyclones.length}`);
}

// ── Routes ────────────────────────────────────────────────────────────────────

app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/capabilities', (_req, res) => res.json({
  mapbox: !!MAPBOX_TOKEN, firms: !!FIRMS_API_KEY,
}));

app.get('/api/status', (_req, res) => res.json({
  ok: true,
  fireCount: fireState.fires.length, aircraftCount: aircraftState.aircraft.length,
  earthquakeCount: earthquakeState.earthquakes.length, cycloneCount: cycloneState.cyclones.length,
  lightningLive, lightningBufferSize: lightningBuffer.length,
  lastFireUpdate: fireState.timestamp, lastAircraftUpdate: aircraftState.timestamp,
  mode: fireState.mode, clients: io.engine.clientsCount,
}));

app.get('/api/fires',       (_req, res) => res.json(fireState));
app.get('/api/aircraft',    (_req, res) => res.json(aircraftState));
app.get('/api/earthquakes', (_req, res) => res.json(earthquakeState));
app.get('/api/cyclones',    (_req, res) => res.json(cycloneState));
app.get('/api/lightning/history', (_req, res) => res.json({ strikes: lightningBuffer, live: lightningLive }));

// 7-day fire analytics — group by date
app.get('/api/analytics/fires', async (_req, res) => {
  const key = `analytics_fires_${todayUTC()}`;
  const hit = cache.get(key);
  if (hit) return res.json(hit);
  try {
    const fires = await fetchFIRMS(7);
    const byDate = {};
    for (let d = 1; d <= 7; d++) byDate[offsetDate(d)] = 0;
    fires.forEach(f => { if (byDate[f.date] !== undefined) byDate[f.date]++; });
    const result = { byDate, total: fires.length, timestamp: new Date().toISOString() };
    cache.set(key, result, 3600);
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Mapbox satellite tile proxy
app.get('/tiles/mapbox/:z/:x/:y', async (req, res) => {
  if (!MAPBOX_TOKEN) {
    const blank = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
    return res.set('Content-Type', 'image/gif').set('Cache-Control', 'no-store').send(blank);
  }
  const { z, x, y } = req.params;
  const url = `https://api.mapbox.com/v4/mapbox.satellite/${z}/${x}/${y}@2x.jpg?access_token=${MAPBOX_TOKEN}`;
  try {
    const { buffer, contentType } = await httpsGetBuffer(url);
    res.set('Content-Type', contentType).set('Cache-Control', 'public, max-age=86400').send(buffer);
  } catch (e) { console.error('[Mapbox tile]', e.message); res.status(502).end(); }
});

// ── Socket.IO ─────────────────────────────────────────────────────────────────

io.on('connection', socket => {
  const ip = (socket.handshake.headers['x-forwarded-for'] || socket.handshake.address || '').split(',')[0].trim();
  const ua = socket.handshake.headers['user-agent'] || '';
  console.log(`[WS] Connect: ${socket.id} from ${ip}`);
  logSession({ event: 'connect', id: socket.id, ip, ua, ts: new Date().toISOString() });

  socket.emit('fire-data',      fireState);
  socket.emit('aircraft-data',  aircraftState);
  socket.emit('earthquake-data', earthquakeState);
  socket.emit('cyclone-data',   cycloneState);
  socket.emit('lightning-history', { strikes: lightningBuffer, live: lightningLive });

  socket.on('user-location', data => {
    if (typeof data.lat !== 'number' || typeof data.lon !== 'number') return;
    const entry = {
      event: 'locate', id: socket.id, ip,
      lat: parseFloat(data.lat.toFixed(4)),
      lon: parseFloat(data.lon.toFixed(4)),
      accuracy: data.accuracy ? Math.round(data.accuracy) : null,
      ts: new Date().toISOString(),
    };
    logSession(entry);
    console.log(`[Location] ${ip} → ${entry.lat}, ${entry.lon} ±${entry.accuracy}m`);
  });

  socket.on('request-refresh', async () => {
    cache.del('earthquakes'); cache.del('cyclones');
    await Promise.all([refreshFires(), refreshAircraft(), refreshEarthquakes(), refreshCyclones()]);
  });

  socket.on('disconnect', () => {
    logSession({ event: 'disconnect', id: socket.id, ip, ts: new Date().toISOString() });
    console.log(`[WS] Disconnect: ${socket.id}`);
  });
});

// ── Start ─────────────────────────────────────────────────────────────────────

function printBanner() {
  console.log(`\n🌍  Africa Live Eye  →  http://localhost:${PORT}`);
  console.log(`📡  FIRMS            :  ${FIRMS_API_KEY ? 'LIVE' : 'DEMO'}`);
  console.log(`🗺️   Mapbox Satellite :  ${MAPBOX_TOKEN  ? 'ENABLED' : 'NOT SET'}`);
  console.log(`✈️   Aircraft refresh :  every ${AIRCRAFT_INTERVAL / 1000}s`);
  console.log(`🌊  Earthquakes       :  every ${EARTHQUAKE_INTERVAL / 60000}min via USGS`);
  console.log(`⚡  Lightning         :  Blitzortung WebSocket (synthetic fallback)\n`);
}

async function start() {
  await Promise.all([refreshFires(), refreshAircraft(), refreshEarthquakes(), refreshCyclones()]);

  setInterval(refreshFires,      FIRE_UPDATE_INTERVAL);
  setInterval(refreshAircraft,   AIRCRAFT_INTERVAL);
  setInterval(refreshEarthquakes, EARTHQUAKE_INTERVAL);
  setInterval(refreshCyclones,   CYCLONE_INTERVAL);

  // Start lightning — try live first, fallback to synthetic
  startSyntheticLightning();
  setTimeout(() => connectBlitzortung(1), 3000);

  server.on('error', err => {
    if (err.code === 'EADDRINUSE') {
      console.error(`\n⚠️  Port ${PORT} is already in use.`);
      console.error(`   Quick fix: npx kill-port ${PORT}  then  npm start\n`);
      process.exit(1);
    } else { throw err; }
  });

  server.listen(PORT, printBanner);
}

start().catch(e => { console.error('Fatal:', e); process.exit(1); });
