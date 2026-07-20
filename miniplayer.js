'use strict';

const $ = (id) => document.getElementById(id);
let lastArt = null;
let track = null;

let lastWidth = null;

function drawProgress() {
  let width = '0%';
  if (track && track.duration > 0) {
    // Projected from when the position was measured in the page, not from when
    // this window received it. The IPC hop and this window's own redraw would
    // otherwise both be counted as playback time and the bar would sit behind.
    // Falls back to now rather than producing NaN if a track ever arrives
    // without a stamp.
    const at = Number.isFinite(track.at) ? track.at : Date.now();
    const elapsed = track.playing ? Math.max(0, Date.now() - at) / 1000 : 0;
    const pos = Math.min(track.duration, track.position + elapsed);
    // One decimal is about a third of a pixel at this window's width. Finer
    // than that only produces writes nobody can see.
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

// Redrawn per frame rather than on a timer, so the bar is never older than one
// frame. The change check above keeps that cheap, and requestAnimationFrame
// stops on its own while the window is hidden.
(function frame() {
  drawProgress();
  requestAnimationFrame(frame);
})();

for (const id of ['previous', 'playpause', 'next']) {
  $(id).addEventListener('click', () => window.mini.command(id));
}
$('restore').addEventListener('click', () => window.mini.restore());
$('quit').addEventListener('click', () => window.mini.quit());

// Pull the current track rather than waiting to be pushed one. Opening the
// window while a song is playing would otherwise show an empty player until
// the next change.
window.mini.request();
