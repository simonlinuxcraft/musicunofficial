'use strict';

// Mouse wheels move in coarse notches; those glide to their target instead of
// jumping. Touchpads already scroll in fine steps and pass through untouched.
function smoothWheel(e) {
  const el = e.currentTarget;
  let dy = e.deltaY;
  if (e.deltaMode === WheelEvent.DOM_DELTA_LINE) dy *= 40;
  else if (e.deltaMode === WheelEvent.DOM_DELTA_PAGE) dy *= el.clientHeight;
  if (e.ctrlKey || e.shiftKey || Math.abs(e.deltaX) > Math.abs(dy)) return;
  if (e.deltaMode === WheelEvent.DOM_DELTA_PIXEL && Math.abs(dy) < 50) return;
  e.preventDefault();
  // Notches during a glide add up instead of restarting from wherever it is.
  const max = el.scrollHeight - el.clientHeight;
  el.glideTo = Math.max(0, Math.min(max, (el.glideTo ?? el.scrollTop) + dy));
  el.scrollTo({ top: el.glideTo, behavior: 'smooth' });
}
for (const el of [main, $('queue-list'), $('lyrics-pane'), $('now-pane'), $('lib-list'), $('stage-lyrics')]) {
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
  l: () => !track.ad && $('like').click(),
  d: () => !track.ad && $('dislike').click(),
  p: () => !track.ad && track.videoId && saveToPlaylist([track.videoId]),
  s: () => $('shuffle').click(),
  r: () => $('repeat').click(),
};
// Held down, these would fire again and again.
const ONCE = [' ', 'm', 'l', 'd', 'p', 's', 'r'];
document.addEventListener('keydown', (e) => {
  // Window keys first: they work in fields too.
  if (e.key === 'F11') {
    e.preventDefault();
    return api.window('fullscreen');
  }
  if (e.altKey && !e.ctrlKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
    e.preventDefault();
    return e.key === 'ArrowLeft' ? goBack() : goForward();
  }
  // A menu whose focused entry was replaced (a submenu that finished loading) still closes on Escape.
  if (e.key === 'Escape' && !$('menu').hidden && !$('menu').contains(e.target) && !$('submenu').contains(e.target)) return closeMenu();
  if (e.key === 'Escape' && !e.target.closest('input, select, textarea, dialog, #menu, #submenu')) {
    if (document.documentElement.classList.contains('fullscreen')) return api.window('leave-fullscreen');
    if (slot === 'stage') return toggleStage(false);
  }
  if (e.ctrlKey || e.altKey || e.metaKey) return;
  // A slider keeps the focus after a click and needs only its arrows; the letter keys go on working.
  const slider = e.target.type === 'range' && e.key.length === 1;
  if (!slider && e.target.closest('input, select, textarea, [contenteditable], dialog, #menu, #submenu')) return;
  if (e.key === '/') {
    e.preventDefault();
    $('search').querySelector('input').focus();
    return;
  }
  if (e.key === '?') {
    e.preventDefault();
    return showKeys();
  }
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  const run = KEYS[(e.shiftKey && key.startsWith('Arrow') ? 'Shift+' : '') + key];
  if (!run || !track || (e.repeat && ONCE.includes(key))) return;
  // A focused button keeps Space for itself, and a row of tabs its arrows.
  if (key === ' ' && e.target.closest('button, a, summary')) return;
  if (key === ' ' && e.target.matches('[role=button]')) return e.preventDefault(), e.target.click();
  if (key.startsWith('Arrow') && !e.shiftKey && e.target.matches('[role=tab]')) {
    const next = key === 'ArrowRight' ? e.target.nextElementSibling : key === 'ArrowLeft' ? e.target.previousElementSibling : null;
    if (next) next.focus();
    return e.preventDefault();
  }
  e.preventDefault();
  run();
});

// "?" lists every key in one place, the same list as on the settings page.
function showKeys() {
  const half = Math.ceil(T.keys.length / 2);
  $('keys-cols').replaceChildren(
    ...[T.keys.slice(0, half), T.keys.slice(half)].map((list) => {
      const col = div('');
      for (const [keys, label] of list) {
        const row = div('kr');
        const k = document.createElement('kbd');
        k.textContent = keys;
        row.append(div('', label), k);
        col.append(row);
      }
      return col;
    })
  );
  $('keys-dialog').showModal();
}
// A click beside the box closes it, as Escape does.
$('keys-dialog').addEventListener('click', (e) => e.target === e.currentTarget && e.currentTarget.close());

// The mouse's side buttons go back and forward, as in a browser.
window.addEventListener('mouseup', (e) => {
  if (e.button === 3) goBack();
  else if (e.button === 4) goForward();
});

// Own tooltips: dark, with the key that does the same. The native title is moved
// aside on hover so it does not show as well; it is read again on every hover, as
// some buttons change theirs (repeat).
const tooltip = $('tip');
let tooltipTimer = 0;
let tooltipFor = null;
const keyName = (k) => k.replace('Shift', T.keyShift).replace('Space', T.keySpace);
function showTooltip(el) {
  const text = el.dataset.tipText;
  if (!text) return;
  tooltip.replaceChildren(text);
  if (el.dataset.key) {
    const k = document.createElement('kbd');
    k.textContent = keyName(el.dataset.key);
    tooltip.append(k);
  }
  tooltip.hidden = false;
  const r = el.getBoundingClientRect();
  const t = tooltip.getBoundingClientRect();
  const below = r.top < 60;
  tooltip.style.left = Math.max(8, Math.min(r.left + r.width / 2 - t.width / 2, innerWidth - t.width - 8)) + 'px';
  tooltip.style.top = (below ? r.bottom + 8 : r.top - t.height - 8) + 'px';
}
document.addEventListener('pointerover', (e) => {
  const el = e.target.closest('[title], [data-tip-text]');
  if (el === tooltipFor) return;
  clearTimeout(tooltipTimer);
  tooltip.hidden = true;
  tooltipFor = el;
  if (!el) return;
  if (el.title) {
    el.dataset.tipText = el.title;
    // The title may be the element's only name for screen readers.
    if (!el.hasAttribute('aria-label') && !el.textContent.trim()) el.setAttribute('aria-label', el.title);
    el.removeAttribute('title');
  }
  tooltipTimer = setTimeout(() => tooltipFor === el && el.isConnected && showTooltip(el), 450);
});
for (const ev of ['pointerdown', 'wheel', 'keydown']) {
  document.addEventListener(ev, () => {
    clearTimeout(tooltipTimer);
    tooltip.hidden = true;
  }, { capture: true, passive: true });
}

// Only once every script is in: an answer can arrive between two of them.
uiReady = true;
checkAccount();
updateRail();
api.request();
// After a language change the window reloads and returns to the settings it came from.
if (sessionStorage.getItem('reopen') === 'settings') {
  sessionStorage.removeItem('reopen');
  openSettings();
} else {
  restoreRoot();
}
