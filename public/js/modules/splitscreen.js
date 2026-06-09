'use strict';

// ── Split-Screen Comparison Module ────────────────────────────────────────────

let map2        = null;
let splitActive = false;
let map2Base    = null;
let _syncing    = false;
let rightDate   = null;

function initSplitScreen() {
  document.getElementById('split-toggle-btn')?.addEventListener('click', toggleSplitScreen);

  document.getElementById('split-right-date')?.addEventListener('change', e => {
    rightDate = e.target.value;
    updateMap2Base();
    document.getElementById('split-date-label-right').textContent = rightDate;
  });

  document.getElementById('date-slider')?.addEventListener('input', () => {
    const lbl = document.getElementById('split-date-label-left');
    if (lbl) lbl.textContent = currentDate || '—';
  });
}

function toggleSplitScreen() {
  splitActive = !splitActive;
  const mapEl   = document.getElementById('map');
  const map2El  = document.getElementById('map2');
  const splitDv = document.getElementById('split-divider');
  const splitCtl = document.getElementById('split-right-controls');
  const btn     = document.getElementById('split-toggle-btn');

  btn?.classList.toggle('active-tool', splitActive);

  if (splitActive) {
    // Calculate initial split position
    const sbW      = document.getElementById('sidebar')?.offsetWidth || 290;
    const midX     = sbW + (window.innerWidth - sbW) / 2;

    // Resize main map
    mapEl.style.right = 'auto';
    mapEl.style.width = (midX - sbW) + 'px';

    // Position map2
    map2El.style.left    = midX + 'px';
    map2El.style.right   = '0';
    map2El.style.width   = 'auto';
    map2El.style.display = '';

    // Divider
    splitDv.style.left    = (midX - 3) + 'px';
    splitDv.style.display = '';

    // Right controls
    if (splitCtl) { splitCtl.style.display = ''; splitCtl.style.left = midX + 'px'; }

    if (!map2) {
      map2 = L.map('map2', {
        center: map.getCenter(), zoom: map.getZoom(),
        zoomControl: false, attributionControl: false, preferCanvas: true,
      });
      rightDate = rightDate || offsetDateStr(7);
      updateMap2Base();
      initMap2Sync();
    } else {
      map2.setView(map.getCenter(), map.getZoom(), { animate: false });
    }

    initSplitDivider();

    setTimeout(() => { map.invalidateSize({ pan: false }); map2?.invalidateSize({ pan: false }); }, 80);

    const rdInput = document.getElementById('split-right-date');
    if (rdInput && !rdInput.value) rdInput.value = offsetDateStr(7);
    document.getElementById('split-date-label-right').textContent = rightDate || offsetDateStr(7);
    document.getElementById('split-date-label-left').textContent  = currentDate || '—';

    showToast('↔ Split-screen — drag the divider to resize panes', 'info');
  } else {
    // Restore main map
    mapEl.style.right = '0';
    mapEl.style.width = '';
    map2El.style.display  = 'none';
    splitDv.style.display = 'none';
    if (splitCtl) splitCtl.style.display = 'none';
    map.invalidateSize({ pan: false });
  }
}

function updateMap2Base() {
  if (!map2) return;
  if (map2Base) map2.removeLayer(map2Base);
  const d = rightDate || offsetDateStr(7);
  map2Base = L.tileLayer(
    `${GIBS}/VIIRS_SNPP_CorrectedReflectance_TrueColor/default/${d}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg`,
    { maxNativeZoom: 9, maxZoom: 22, opacity: 0.95, crossOrigin: 'anonymous',
      errorTileUrl: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7' }
  );
  map2Base.addTo(map2);
}

function initMap2Sync() {
  map.on('moveend', () => {
    if (_syncing || !splitActive || !map2) return;
    _syncing = true;
    map2.setView(map.getCenter(), map.getZoom(), { animate: false });
    setTimeout(() => { _syncing = false; }, 50);
  });
  map2.on('moveend', () => {
    if (_syncing || !splitActive) return;
    _syncing = true;
    map.setView(map2.getCenter(), map2.getZoom(), { animate: false });
    setTimeout(() => { _syncing = false; }, 50);
  });
}

let dividerListenersAdded = false;
function initSplitDivider() {
  if (dividerListenersAdded) return;
  dividerListenersAdded = true;
  const divider = document.getElementById('split-divider');
  if (!divider) return;

  let dragging = false;

  divider.addEventListener('mousedown', e => { dragging = true; e.preventDefault(); });
  document.addEventListener('mousemove', e => {
    if (!dragging || !splitActive) return;
    const mapEl  = document.getElementById('map');
    const map2El = document.getElementById('map2');
    const splitCtl = document.getElementById('split-right-controls');
    const sbW    = document.getElementById('sidebar')?.offsetWidth || 290;
    const minX   = sbW + 150;
    const maxX   = window.innerWidth - 150;
    const clamp  = Math.max(minX, Math.min(e.clientX, maxX));

    mapEl.style.width  = (clamp - sbW) + 'px';
    mapEl.style.right  = 'auto';
    map2El.style.left  = clamp + 'px';
    map2El.style.right = '0';
    map2El.style.width = 'auto';
    divider.style.left = (clamp - 3) + 'px';
    if (splitCtl) splitCtl.style.left = clamp + 'px';

    map.invalidateSize({ pan: false });
    map2?.invalidateSize({ pan: false });
  });
  document.addEventListener('mouseup', () => { dragging = false; });
}

window.initSplitScreen   = initSplitScreen;
window.toggleSplitScreen = toggleSplitScreen;
