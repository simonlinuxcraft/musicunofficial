'use strict';

// Mouse wheels move in coarse notches; those glide to their target instead of
// jumping. Touchpads already scroll in fine steps and pass through untouched.
function smoothWheel(e) {
  const el = e.currentTarget;
  const dy = e.deltaMode === 1 ? e.deltaY * 40 : e.deltaMode === 2 ? e.deltaY * el.clientHeight : e.deltaY;
  if (e.ctrlKey || e.shiftKey || Math.abs(e.deltaX) > Math.abs(dy) || (e.deltaMode === 0 && Math.abs(dy) < 50)) return;
  e.preventDefault();
  // Notches during a glide add up instead of restarting from wherever it is.
  const max = el.scrollHeight - el.clientHeight;
  el.glideTo = Math.max(0, Math.min(max, (el.glideTo ?? el.scrollTop) + dy));
  el.scrollTo({ top: el.glideTo, behavior: 'smooth' });
}
for (const el of [main, $('queue-list'), $('lyrics-pane')]) {
  el.addEventListener('wheel', smoothWheel, { passive: false });
  el.addEventListener('scrollend', () => (el.glideTo = null));
}

// Player keys work everywhere except in form fields and menus. A focused button
// would otherwise press itself again on Space, and a row would restart its track.
// The list is shown on the settings page (T.keys).
const KEYS = {
  ' ': () => api.command('playpause'),
  ArrowLeft: () => seekTo(positionNow() - 10),
  ArrowRight: () => seekTo(positionNow() + 10),
  'Shift+ArrowLeft': () => api.command('previous'),
  'Shift+ArrowRight': () => api.command('next'),
  '+': () => volumeBy(5),
  '-': () => volumeBy(-5),
  m: () => $('mute').click(),
  l: () => $('like').click(),
};
// Held down, these would fire again and again.
const ONCE = [' ', 'm', 'l'];
document.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.altKey || e.metaKey) return;
  if (e.target.closest('input, select, textarea, [contenteditable], dialog, #menu')) return;
  if (e.key === '/') {
    e.preventDefault();
    $('search').querySelector('input').focus();
    return;
  }
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  const run = KEYS[(e.shiftKey && key.startsWith('Arrow') ? 'Shift+' : '') + key];
  if (!run || !track || (e.repeat && ONCE.includes(key))) return;
  e.preventDefault();
  run();
});

api.request();
// After a language change the window reloads and returns to the settings it came from.
if (sessionStorage.getItem('reopen') === 'settings') {
  sessionStorage.removeItem('reopen');
  openSettings();
} else {
  restoreRoot();
}
