'use strict';

// ── PDF Report Generator ──────────────────────────────────────────────────────
// jsPDF + jsPDF-autotable + html2canvas → structured PDF

function initReport() {
  document.getElementById('report-btn')?.addEventListener('click', openReportModal);
  document.getElementById('report-modal-close')?.addEventListener('click', closeReportModal);
  document.getElementById('report-modal-backdrop')?.addEventListener('click', closeReportModal);
  document.getElementById('generate-report-btn')?.addEventListener('click', generateReport);
}

function openReportModal() {
  document.getElementById('report-modal').style.display = 'flex';
  // Fill in current stats
  document.getElementById('rpt-fire-count').textContent    = lastFires.length;
  document.getElementById('rpt-aircraft-count').textContent = lastAircraft.length;
  const eqs = window.lastEarthquakes ? window.lastEarthquakes() : [];
  document.getElementById('rpt-eq-count').textContent      = eqs.length;
  document.getElementById('rpt-date').textContent          = currentDate;
}

function closeReportModal() {
  document.getElementById('report-modal').style.display = 'none';
}

async function generateReport() {
  const genBtn = document.getElementById('generate-report-btn');
  genBtn.disabled = true;
  genBtn.textContent = '⏳ Generating…';

  try {
    if (typeof window.jspdf === 'undefined') {
      throw new Error('jsPDF not loaded — check your internet connection');
    }

    const { jsPDF } = window.jspdf;
    const doc       = new jsPDF('landscape', 'mm', 'a4');
    const W         = 297, H = 210;
    const now       = new Date();
    const ts        = now.toUTCString();

    // ── Cover / header ──────────────────────────────────────────────────────
    doc.setFillColor(6, 8, 16);
    doc.rect(0, 0, W, H, 'F');

    doc.setTextColor(0, 212, 255);
    doc.setFontSize(22);
    doc.text('Africa Live Eye — Situation Report', 20, 22);

    doc.setTextColor(110, 120, 148);
    doc.setFontSize(10);
    doc.text(`Generated: ${ts}`, 20, 30);
    doc.text(`Imagery Date: ${currentDate} UTC`, 20, 36);
    doc.text(`Map Centre: ${map.getCenter().lat.toFixed(4)}°N, ${map.getCenter().lng.toFixed(4)}°E  |  Zoom: ${map.getZoom()}`, 20, 42);

    // ── Map screenshot ──────────────────────────────────────────────────────
    showToast('Capturing map for report…', 'info');
    let imgData = null;
    if (typeof html2canvas !== 'undefined') {
      try {
        const canvas = await html2canvas(document.getElementById('map'), {
          useCORS: true, allowTaint: true, scale: 1.5, logging: false,
        });
        imgData = canvas.toDataURL('image/jpeg', 0.88);
      } catch (_) {}
    }

    if (imgData) {
      doc.addImage(imgData, 'JPEG', 20, 50, W - 40, H - 70);
    } else {
      doc.setFillColor(20, 30, 50);
      doc.rect(20, 50, W - 40, H - 70, 'F');
      doc.setTextColor(0, 212, 255);
      doc.setFontSize(12);
      doc.text('Map screenshot unavailable', W / 2, H / 2, { align: 'center' });
    }

    // ── Page 2 — Fire data ──────────────────────────────────────────────────
    doc.addPage();
    doc.setFillColor(6, 8, 16);
    doc.rect(0, 0, W, H, 'F');

    doc.setTextColor(255, 107, 53);
    doc.setFontSize(14);
    doc.text(`🔥 Active Fire Hotspots (${lastFires.length} total)`, 20, 18);

    doc.setTextColor(110, 120, 148);
    doc.setFontSize(9);
    doc.text('Source: NASA FIRMS VIIRS · Top 60 by Fire Radiative Power', 20, 24);

    const fireSample = [...lastFires]
      .sort((a, b) => (b.frp || 0) - (a.frp || 0))
      .slice(0, 60);

    if (typeof doc.autoTable !== 'undefined') {
      doc.autoTable({
        startY: 28,
        head: [['Latitude', 'Longitude', 'Date', 'Time UTC', 'Satellite', 'Confidence', 'FRP (MW)']],
        body: fireSample.map(f => [
          f.lat.toFixed(4), f.lon.toFixed(4),
          f.date, fmtTime(f.time), f.satellite, f.confidence,
          f.frp ? f.frp.toFixed(1) : 'N/A',
        ]),
        headStyles: { fillColor: [40, 20, 10], textColor: [255, 107, 53], fontSize: 8 },
        bodyStyles: { fillColor: [10, 14, 24], textColor: [180, 190, 210], fontSize: 7.5 },
        alternateRowStyles: { fillColor: [14, 18, 30] },
        margin: { left: 20, right: 20 },
        tableWidth: W - 40,
      });
    } else {
      doc.setTextColor(180, 190, 210);
      doc.setFontSize(9);
      fireSample.slice(0, 20).forEach((f, i) => {
        doc.text(`${f.lat.toFixed(3)}, ${f.lon.toFixed(3)}  |  ${f.date}  |  ${f.confidence}  |  ${f.frp?.toFixed(1) || 'N/A'} MW`, 20, 32 + i * 5);
      });
    }

    // ── Page 3 — Earthquake data ────────────────────────────────────────────
    const eqs = window.lastEarthquakes ? window.lastEarthquakes() : [];
    if (eqs.length > 0) {
      doc.addPage();
      doc.setFillColor(6, 8, 16);
      doc.rect(0, 0, W, H, 'F');

      doc.setTextColor(68, 136, 255);
      doc.setFontSize(14);
      doc.text(`🌊 Recent Earthquakes M2.5+ (${eqs.length} total)`, 20, 18);

      doc.setTextColor(110, 120, 148);
      doc.setFontSize(9);
      doc.text('Source: USGS Earthquake API · Last 24 hours · Africa region', 20, 24);

      const eqSorted = [...eqs].sort((a, b) => b.magnitude - a.magnitude).slice(0, 50);

      if (typeof doc.autoTable !== 'undefined') {
        doc.autoTable({
          startY: 28,
          head: [['Magnitude', 'Depth (km)', 'Location', 'Lat', 'Lon', 'Time UTC']],
          body: eqSorted.map(e => [
            `M${e.magnitude.toFixed(1)}`, e.depth, e.place.slice(0, 40),
            e.lat.toFixed(4), e.lon.toFixed(4),
            new Date(e.time).toUTCString().slice(0, 22),
          ]),
          headStyles: { fillColor: [10, 20, 50], textColor: [68, 136, 255], fontSize: 8 },
          bodyStyles: { fillColor: [10, 14, 24], textColor: [180, 190, 210], fontSize: 7.5 },
          alternateRowStyles: { fillColor: [14, 18, 30] },
          margin: { left: 20, right: 20 },
          tableWidth: W - 40,
        });
      }
    }

    // ── Page 4 — Summary ────────────────────────────────────────────────────
    doc.addPage();
    doc.setFillColor(6, 8, 16);
    doc.rect(0, 0, W, H, 'F');

    doc.setTextColor(0, 232, 135);
    doc.setFontSize(16);
    doc.text('Summary Statistics', 20, 20);

    const stats = [
      ['Fire Hotspots (24h)', lastFires.length, '#ff6b35'],
      ['Confirmed High-Confidence Fires', lastFires.filter(f => String(f.confidence).toLowerCase() === 'high').length, '#ff2200'],
      ['Live Aircraft (Africa)', lastAircraft.length, '#00d4ff'],
      ['Earthquakes M2.5+ (24h)', eqs.length, '#4488ff'],
      ['M5+ Significant Events', eqs.filter(e => e.magnitude >= 5).length, '#ff8800'],
    ];

    doc.setFontSize(11);
    stats.forEach(([label, value, color], i) => {
      doc.setTextColor(...hexToRgb(color));
      doc.text(`${label}: ${value}`, 20, 36 + i * 12);
    });

    doc.setTextColor(60, 70, 90);
    doc.setFontSize(8);
    doc.text('Generated by Africa Live Eye — Real-Time Satellite Monitoring Platform', W / 2, H - 10, { align: 'center' });

    // ── Save ───────────────────────────────────────────────────────────────
    const filename = `africa-live-eye-report-${now.toISOString().slice(0, 10)}.pdf`;
    doc.save(filename);
    showToast('PDF report saved!', 'success');
    closeReportModal();

  } catch (e) {
    showToast(`Report failed: ${e.message}`, 'error');
    console.error('[Report]', e);
  } finally {
    genBtn.disabled = false;
    genBtn.textContent = '📄 Generate & Download PDF';
  }
}

function hexToRgb(hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return [r, g, b];
}

window.initReport  = initReport;
window.generateReport = generateReport;
