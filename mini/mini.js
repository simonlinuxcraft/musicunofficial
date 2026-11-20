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

// With the setting on, the line being sung takes the artist's place. One request per track.
let lines = null;
let linesFor = null;
function loadLines(t) {
  // Title and length are part of it: the first reports after a track change can still carry the old ones.
  const id = t && !t.ad && t.videoId && t.duration > 0 ? [t.videoId, t.title, t.artist, Math.round(t.duration)].join('\n') : null;
  if (id === linesFor) return;
  linesFor = id;
  lines = null;
  if (!id) return;
  window.mini.syncedLyrics({ title: t.title, artist: t.artist, duration: t.duration }).then(
    (l) => {
      if (linesFor !== id) return;
      lines = l && l.lines.length ? l.lines : null;
      // A failed lookup is asked again, but not with every track report.
      if (!l) setTimeout(() => linesFor === id && (linesFor = null), 30000);
    },
    () => {}
  );
}

// Switched on or off while a track plays: asked again at once, not with the next track.
window.mini.onLyricsChanged(() => {
  linesFor = null;
  loadLines(track);
});

let shownLine = null;
function drawLine(pos) {
  let text = '';
  if (lines) {
    let i = -1;
    while (i + 1 < lines.length && lines[i + 1].time <= pos + 0.2) i++;
    text = i >= 0 ? lines[i].text : '';
  }
  if (text === shownLine) return;
  shownLine = text;
  $('line').textContent = text;
  $('line').hidden = !text;
  $('artist').hidden = !!text;
}

function drawProgress() {
  let width = '0%';
  let time = '';
  let pos = 0;
  if (track && track.duration > 0) {
    // Projected from when the page measured it, so the IPC hop does not count as playback.
    const at = Number.isFinite(track.at) ? track.at : Date.now();
    const elapsed = track.playing ? Math.max(0, Date.now() - at) / 1000 : 0;
    pos = Math.min(track.duration, track.position + elapsed);
    // One decimal is a third of a pixel at this width; finer only produces invisible writes.
    width = ((pos / track.duration) * 100).toFixed(1) + '%';
    time = fmt(pos) + ' / ' + fmt(track.duration);
  }
  drawLine(pos);
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
  loadLines(has ? t : null);
  document.title = has ? t.title + (t.artist ? ' - ' + t.artist : '') : 'Music';

  const art = has ? t.art || '' : '';
  // Reassigning the same url makes the tile flicker.
  if (art !== lastArt) {
    lastArt = art;
    $('art').classList.toggle('empty', !art);
    // Quoted and escaped so a stray quote cannot end the value; main only passes https urls anyway.
    $('art').style.backgroundImage = art ? 'url("' + art.replace(/["\\]/g, encodeURIComponent) + '")' : '';
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
