'use strict';

const $ = (id) => document.getElementById(id);
let lastArt = null;
let track = null;
// When the position in `track` was measured, so the bar can carry on from there
// between updates instead of standing still and then jumping.
let stamp = 0;

function drawProgress() {
  if (!track || !(track.duration > 0)) {
    $('fill').style.width = '0%';
    return;
  }
  const elapsed = track.playing ? (performance.now() - stamp) / 1000 : 0;
  const pos = Math.min(track.duration, track.position + elapsed);
  $('fill').style.width = (pos / track.duration) * 100 + '%';
}

window.mini.onTrack((t) => {
  const has = !!(t && t.title);
  track = has ? t : null;
  stamp = performance.now();

  document.body.classList.toggle('has-track', has);
  document.body.classList.toggle('playing', has && !!t.playing);

  $('title').textContent = has ? t.title : 'Nothing playing';
  $('artist').textContent = has ? t.artist || '' : '';
  document.title = has ? t.title + (t.artist ? ' - ' + t.artist : '') : 'MusicUnofficial';

  const art = has ? t.art || '' : '';
  // Reassigning the same url makes the tile flicker on every tick.
  if (art !== lastArt) {
    lastArt = art;
    $('art').classList.toggle('empty', !art);
    // The url is quoted, so a stray quote in it would end the value and let
    // the rest through as CSS. It cannot get here (main.js only passes https
    // urls) but the encoding costs nothing.
    $('art').style.backgroundImage = art ? 'url("' + art.replace(/["\\]/g, encodeURIComponent) + '")' : '';
  }

  drawProgress();
});

// Runs the bar forward locally. Every incoming update resets the reference
// point, so this can drift for at most one update interval and never
// accumulates error.
setInterval(() => {
  if (track && track.playing) drawProgress();
}, 250);

for (const id of ['previous', 'playpause', 'next']) {
  $(id).addEventListener('click', () => window.mini.command(id));
}
$('restore').addEventListener('click', () => window.mini.restore());
$('quit').addEventListener('click', () => window.mini.quit());

// Pull the current track rather than waiting to be pushed one. Opening the
// window while a song is playing would otherwise show an empty player until
// the next change.
window.mini.request();
