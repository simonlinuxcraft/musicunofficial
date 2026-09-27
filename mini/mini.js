'use strict';

const $ = (id) => document.getElementById(id);
let lastArt = null;
let lastWidth = null;
let track = null;

function drawProgress() {
  let width = '0%';
  if (track && track.duration > 0) {
    // Projected from when the page measured it, so the IPC hop does not count as playback.
    const at = Number.isFinite(track.at) ? track.at : Date.now();
    const elapsed = track.playing ? Math.max(0, Date.now() - at) / 1000 : 0;
    const pos = Math.min(track.duration, track.position + elapsed);
    // One decimal is a third of a pixel at this width; finer only produces invisible writes.
    width = ((pos / track.duration) * 100).toFixed(1) + '%';
  }
  if (width === lastWidth) return;
  lastWidth = width;
  $('fill').style.width = width;
}

window.mini.onTrack((t) => {
  const has = !!(t && t.title);
  track = has ? t : null;

  document.body.classList.toggle('has-track', has);
  document.body.classList.toggle('playing', has && !!t.playing);

  $('title').textContent = has ? t.title : 'Nothing playing';
  $('artist').textContent = has ? t.artist || '' : '';
  document.title = has ? t.title + (t.artist ? ' - ' + t.artist : '') : 'MusicUnofficial';

  const art = has ? t.art || '' : '';
  // Reassigning the same url makes the tile flicker.
  if (art !== lastArt) {
    lastArt = art;
    $('art').classList.toggle('empty', !art);
    // Quoted and escaped so a stray quote cannot end the value; main only passes https urls anyway.
    $('art').style.backgroundImage = art ? 'url("' + art.replace(/["\\]/g, encodeURIComponent) + '")' : '';
  }

  drawProgress();
});

// Four steps a second move the bar at most a pixel at a time. A per-frame loop
// kept renderer and GPU busy at 6.7 % CPU even while paused.
setInterval(drawProgress, 250);

for (const id of ['previous', 'playpause', 'next']) {
  $(id).addEventListener('click', () => window.mini.command(id));
}
$('restore').addEventListener('click', () => window.mini.restore());
$('quit').addEventListener('click', () => window.mini.quit());

// Pull rather than wait for a push, or a mini player opened mid-song stays empty until the next change.
window.mini.request();
