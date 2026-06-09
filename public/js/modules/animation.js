'use strict';

// ── Time Animation Module ──────────────────────────────────────────────────
// Animates GIBS imagery through a sequence of dates

let isAnimating   = false;
let animTimer     = null;
let animDates     = [];
let animIndex     = 0;
let animSpeed     = 900;   // ms per frame

function buildAnimDates(spanDays) {
  const arr = [];
  for (let i = spanDays; i >= 0; i--) arr.push(offsetDateStr(i)); // i=0 = today
  return arr;
}

function initAnimation() {
  const bar      = document.getElementById('anim-bar');
  const playBtn  = document.getElementById('anim-play');
  const stopBtn  = document.getElementById('anim-stop');
  const speedSel = document.getElementById('anim-speed');
  const spanSel  = document.getElementById('anim-span');
  const label    = document.getElementById('anim-date-label');
  const progress = document.getElementById('anim-progress');

  if (!bar) return;

  // Show/hide via toolbar button
  document.getElementById('anim-toggle-btn')?.addEventListener('click', () => {
    bar.classList.toggle('visible');
    document.getElementById('anim-toggle-btn').classList.toggle('active-tool', bar.classList.contains('visible'));
  });

  playBtn?.addEventListener('click', startAnimation);
  stopBtn?.addEventListener('click', stopAnimation);

  speedSel?.addEventListener('change', () => {
    animSpeed = parseInt(speedSel.value);
    if (isAnimating) { stopAnimation(); startAnimation(); }
  });

  function startAnimation() {
    if (isAnimating) return;
    isAnimating = true;
    playBtn.style.display = 'none';
    stopBtn.style.display = '';
    const span = parseInt(spanSel?.value || '30');
    animDates  = buildAnimDates(span);
    animIndex  = 0;
    animSpeed  = parseInt(speedSel?.value || '900');
    step();
  }

  function stopAnimation() {
    isAnimating = false;
    clearTimeout(animTimer);
    playBtn.style.display = '';
    stopBtn.style.display = 'none';
  }

  function step() {
    if (!isAnimating) return;
    if (animIndex >= animDates.length) animIndex = 0;
    const date = animDates[animIndex];
    applyDate(date);
    if (label) label.textContent = date;
    if (progress) progress.style.width = ((animIndex + 1) / animDates.length * 100) + '%';
    animIndex++;
    animTimer = setTimeout(step, animSpeed);
  }

  window.startAnimation = startAnimation;
  window.stopAnimation  = stopAnimation;
}

window.initAnimation = initAnimation;
