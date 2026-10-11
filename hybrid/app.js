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

// Space plays and pauses everywhere except while typing. A focused button would
// otherwise press itself again, and a row would restart its track.
document.addEventListener('keydown', (e) => {
  if (e.code !== 'Space' || e.repeat || e.ctrlKey || e.altKey || e.metaKey) return;
  if (e.target.closest('input[type="search"], textarea, [contenteditable], dialog, #menu') || !track) return;
  e.preventDefault();
  api.command('playpause');
});

api.request();
// After a language change the window reloads and returns to the settings it came from.
if (sessionStorage.getItem('reopen') === 'settings') {
  sessionStorage.removeItem('reopen');
  openSettings();
} else {
  root('FEmusic_home', T.home);
}
