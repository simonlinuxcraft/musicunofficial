'use strict';

const $ = (id) => document.getElementById(id);

// UI strings follow the language setting, like the hybrid window.
const STRINGS = {
  en: {
    nothing: 'Nothing playing',
    previous: 'Previous',
    playpause: 'Play / Pause',
    next: 'Next',
    restore: 'Back to the full window',
    quit: 'Quit Music',
    like: 'Like',
  },
  de: {
    nothing: 'Es läuft nichts',
    previous: 'Vorheriger Titel',
    playpause: 'Wiedergabe / Pause',
    next: 'Nächster Titel',
    restore: 'Zurück zum großen Fenster',
    quit: 'Music beenden',
    like: 'Mag ich',
  },
};
const T = STRINGS[window.mini.language] || STRINGS.en;
for (const id of ['previous', 'playpause', 'next', 'restore', 'quit', 'like']) $(id).title = T[id];
$('title').textContent = T.nothing;
let lastArt = null;
let lastWidth = null;
let lastTime = null;
let track = null;

const fmt = (s) => Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0');

function drawProgress() {
  let width = '0%';
  let time = '';
  if (track && track.duration > 0) {
    // Projected from when the page measured it, so the IPC hop does not count as playback.
    const at = Number.isFinite(track.at) ? track.at : Date.now();
    const elapsed = track.playing ? Math.max(0, Date.now() - at) / 1000 : 0;
    const pos = Math.min(track.duration, track.position + elapsed);
    // One decimal is a third of a pixel at this width; finer only produces invisible writes.
    width = ((pos / track.duration) * 100).toFixed(1) + '%';
    time = fmt(pos) + ' / ' + fmt(track.duration);
  }
  if (time !== lastTime) $('time').textContent = lastTime = time;
  if (width === lastWidth) return;
  lastWidth = width;
  $('fill').style.width = width;
}

window.mini.onTrack((t) => {
  const has = !!(t && t.title);
  track = has ? t : null;

  document.body.classList.toggle('has-track', has);
  document.body.classList.toggle('playing', has && !!t.playing);
  document.body.classList.toggle('ad', has && !!t.ad);

  $('title').textContent = has ? t.title : T.nothing;
  $('artist').textContent = has ? t.artist || '' : '';
  document.title = has ? t.title + (t.artist ? ' - ' + t.artist : '') : 'Music';

  const art = has ? t.art || '' : '';
  // Reassigning the same url makes the tile flicker.
  if (art !== lastArt) {
    lastArt = art;
    $('art').classList.toggle('empty', !art);
    // Quoted and escaped so a stray quote cannot end the value; main only passes https urls anyway.
    $('art').style.backgroundImage = $('glow').style.backgroundImage = art ? 'url("' + art.replace(/["\\]/g, encodeURIComponent) + '")' : '';
  }
  $('like').setAttribute('aria-pressed', String(has && t.like === 'LIKE'));

  drawProgress();
});

// Four steps a second move the bar at most a pixel at a time; a per-frame loop kept the GPU busy.
setInterval(drawProgress, 250);

for (const id of ['previous', 'playpause', 'next']) {
  $(id).addEventListener('click', () => window.mini.command(id));
}
$('restore').addEventListener('click', () => window.mini.restore());
$('quit').addEventListener('click', () => window.mini.quit());
$('like').addEventListener('click', () => window.mini.like());

// Pull rather than wait for a push, or a mini player opened mid-song stays empty until the next change.
window.mini.request();
