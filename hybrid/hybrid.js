'use strict';

const $ = (id) => document.getElementById(id);
const api = window.hybrid;

// UI strings follow the system language; the content itself comes localised from YouTube.
const STRINGS = {
  en: {
    home: 'Home',
    library: 'Library',
    liked: 'Liked songs',
    search: 'Search songs, albums, artists',
    openPlayer: 'Open YouTube Music',
    openPlayerTip: 'Sign in, skip ads and everything this view does not cover yet',
    back: 'Back',
    mini: 'Mini player (Ctrl+M)',
    minimize: 'Minimise',
    maximize: 'Maximise',
    close: 'Close',
    previous: 'Previous',
    next: 'Next',
    playpause: 'Play / Pause',
    shuffle: 'Shuffle',
    repeatNONE: 'Repeat off',
    repeatALL: 'Repeat all',
    repeatONE: 'Repeat one',
    like: 'Like',
    dislike: 'Dislike',
    mute: 'Mute',
    volume: 'Volume',
    seek: 'Seek',
    queue: 'Up next',
    lyrics: 'Lyrics',
    noLyrics: 'No lyrics for this track.',
    queueEmpty: 'The queue fills once something plays.',
    closeQueue: 'Close',
    nowTip: 'Show up next',
    nothing: 'Nothing playing',
    ad: 'Ad',
    adHint: 'Skip it in YouTube Music once it lets you',
    loading: 'Loading',
    failed: 'That did not load: ',
    failedHint: '. If YouTube Music shows a sign-in or consent page:',
    empty: 'Nothing here yet. Your library shows up once you are signed in:',
    playAll: 'Play',
    open: 'Open',
    more: 'More',
    radio: 'Start radio',
    playNext: 'Play next',
    addQueue: 'Add to queue',
    addedNext: 'Plays next',
    addedQueue: 'Added to queue',
    queueFailed: 'Could not add it to the queue',
    goArtist: 'Go to artist',
    goAlbum: 'Go to album',
    addPlaylist: 'Save to playlist',
    noPlaylists: 'Playlists need a signed-in account.',
    savedTo: 'Saved to ',
    saveFailed: 'Could not save it to the playlist',
    cancel: 'Cancel',
    clear: 'Clear',
    notReady: 'YouTube Music is not ready yet',
  },
  de: {
    home: 'Start',
    library: 'Mediathek',
    liked: 'Musik, die ich mag',
    search: 'Songs, Alben und Künstler suchen',
    openPlayer: 'YouTube Music öffnen',
    openPlayerTip: 'Anmelden, Werbung überspringen und alles, was diese Ansicht noch nicht kann',
    back: 'Zurück',
    mini: 'Miniplayer (Strg+M)',
    minimize: 'Minimieren',
    maximize: 'Maximieren',
    close: 'Schließen',
    previous: 'Vorheriger Titel',
    next: 'Nächster Titel',
    playpause: 'Wiedergabe / Pause',
    shuffle: 'Zufallsmix',
    repeatNONE: 'Wiederholen aus',
    repeatALL: 'Alle wiederholen',
    repeatONE: 'Titel wiederholen',
    like: 'Mag ich',
    dislike: 'Mag ich nicht',
    mute: 'Stummschalten',
    volume: 'Lautstärke',
    seek: 'Spulen',
    queue: 'Als Nächstes',
    lyrics: 'Songtext',
    noLyrics: 'Für diesen Titel gibt es keinen Songtext.',
    queueEmpty: 'Die Warteschlange füllt sich, sobald etwas läuft.',
    closeQueue: 'Schließen',
    nowTip: 'Als Nächstes zeigen',
    nothing: 'Es läuft nichts',
    ad: 'Werbung',
    adHint: 'In YouTube Music überspringen, sobald es geht',
    loading: 'Wird geladen',
    failed: 'Das hat nicht geladen: ',
    failedHint: '. Falls YouTube Music eine Anmelde- oder Zustimmungsseite zeigt:',
    empty: 'Hier ist noch nichts. Deine Mediathek erscheint, sobald du angemeldet bist:',
    playAll: 'Abspielen',
    open: 'Öffnen',
    more: 'Mehr',
    radio: 'Mix starten',
    playNext: 'Als Nächstes abspielen',
    addQueue: 'Zur Warteschlange hinzufügen',
    addedNext: 'Wird als Nächstes gespielt',
    addedQueue: 'Zur Warteschlange hinzugefügt',
    queueFailed: 'Konnte nicht zur Warteschlange hinzufügen',
    goArtist: 'Zum Künstler',
    goAlbum: 'Zum Album',
    addPlaylist: 'Zu Playlist hinzufügen',
    noPlaylists: 'Playlists gibt es nur mit angemeldetem Konto.',
    savedTo: 'Gespeichert in ',
    saveFailed: 'Konnte nicht in der Playlist speichern',
    cancel: 'Abbrechen',
    clear: 'Leeren',
    notReady: 'YouTube Music ist noch nicht bereit',
  },
};
const T = STRINGS[navigator.language.split('-')[0]] || STRINGS.en;
document.documentElement.lang = T === STRINGS.de ? 'de' : 'en';
for (const el of document.querySelectorAll('[data-t]')) el.textContent = T[el.dataset.t];
for (const el of document.querySelectorAll('[data-title]')) el.title = T[el.dataset.title];
for (const el of document.querySelectorAll('[data-ph]')) el.placeholder = T[el.dataset.ph];
for (const el of document.querySelectorAll('[data-aria]')) el.setAttribute('aria-label', T[el.dataset.aria]);
for (const el of document.querySelectorAll('[data-tip]')) {
  el.title = T[el.dataset.tip];
  el.setAttribute('aria-label', T[el.dataset.tip]);
}

const ICON_PLAY = 'M8 5v14l11-7z';
const ICON_OPEN = 'M8.6 16.6 10 18l6-6-6-6-1.4 1.4 4.6 4.6z';
const ICON_MORE = 'M12 8a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm0 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm0 6a2 2 0 1 0 0 4 2 2 0 0 0 0-4z';
const ICON_REPEAT = 'M7 7h10v3l4-4-4-4v3H5v6h2zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2z';
const ICON_REPEAT_ONE = ICON_REPEAT + 'm-4-2V9h-1l-2 1v1h1.5v4z';

function svg(d) {
  const ns = 'http://www.w3.org/2000/svg';
  const s = document.createElementNS(ns, 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  const p = document.createElementNS(ns, 'path');
  p.setAttribute('d', d);
  s.append(p);
  return s;
}

function thumb(url) {
  const img = document.createElement('img');
  img.className = 'thumb';
  img.alt = '';
  img.loading = 'lazy';
  // Off the main thread, so a burst of covers does not stall scrolling.
  img.decoding = 'async';
  if (url) img.src = url;
  return img;
}

function div(cls, text) {
  const el = document.createElement('div');
  el.className = cls;
  if (text != null) el.textContent = text;
  return el;
}

function iconButton(cls, icon, label, onClick) {
  const b = document.createElement('button');
  b.className = cls;
  b.title = label;
  b.setAttribute('aria-label', label);
  b.append(svg(icon));
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    onClick(e);
  });
  return b;
}

// Notices

function status(text, withButton) {
  const s = $('status');
  s.textContent = text;
  if (withButton) {
    const b = document.createElement('button');
    b.textContent = T.openPlayer;
    b.addEventListener('click', api.showPlayer);
    s.append(' ', b);
  }
}

// invoke() wraps the page's error in its own prefix and the page adds a stack;
// neither tells the reader anything, and the known cases get words of their own.
function errorText(e) {
  const msg = String(e && e.message ? e.message : e)
    .replace(/^Error invoking remote method '[^']+': (\w*Error: )?/, '')
    .split('\n')[0];
  return /did not finish loading|did not answer|player window is gone/.test(msg) ? T.notReady : msg;
}

function fail(e) {
  status(T.failed + errorText(e) + T.failedHint, true);
}

let toastTimer = null;
function toast(text) {
  const t = $('toast');
  t.textContent = text;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 2500);
}

// Lists

const main = document.querySelector('main');
const stack = [];
let view = null;

const openPage = (title, browseId) => go({ title, kind: 'browse', load: () => api.browse(browseId) });

// Subtitle with its artist, album and playlist names as links.
function subLine(item) {
  const box = div('sub');
  if (!item.parts || !item.parts.length) {
    box.textContent = item.subtitle || '';
    return box;
  }
  for (const p of item.parts) {
    if (!p.browseId) {
      box.append(p.text);
      continue;
    }
    const a = document.createElement('span');
    a.className = 'link';
    a.textContent = p.text;
    a.addEventListener('click', (e) => {
      e.stopPropagation();
      openPage(p.text, p.browseId);
    });
    box.append(a);
  }
  return box;
}

function play(endpoint, videoId) {
  if (!endpoint) return;
  // Marked right away; YouTube can take a few seconds to start, the next update confirms or corrects it.
  if (videoId) markCurrent(videoId);
  api.navigate(endpoint).catch((e) => {
    markCurrent(track && !track.ad ? track.videoId : null);
    fail(e);
  });
}

// A track plays, everything else opens.
function activate(item) {
  if (item.watch) play({ watchEndpoint: item.watch }, item.watch.videoId);
  else openPage(item.title, item.browseId);
}

function coverOf(item) {
  const box = div('cover');
  box.append(thumb(item.thumb));
  if (!item.watch && item.play) box.append(iconButton('cover-play', ICON_PLAY, T.playAll, () => play(item.play)));
  return box;
}

function bindItem(el, item) {
  el.tabIndex = 0;
  el.setAttribute('role', 'button');
  el.addEventListener('click', () => activate(item));
  el.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.target !== el) return;
    e.preventDefault();
    activate(item);
  });
  el.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const r = el.getBoundingClientRect();
    // A keyboard-opened menu has no pointer position.
    openMenu(item, e.clientX || r.left + 48, e.clientY || r.bottom);
  });
  if (item.watch) {
    el.dataset.video = item.watch.videoId;
    if (track && track.videoId === item.watch.videoId) el.classList.add('current');
  }
}

const moreButton = (item) =>
  iconButton('more', ICON_MORE, T.more, (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    openMenu(item, r.left, r.bottom);
  });

function row(item) {
  const el = div('item' + (item.watch ? '' : ' opens'));
  const text = div('text');
  text.append(div('title', item.title), subLine(item));
  const hint = svg(item.watch ? ICON_PLAY : ICON_OPEN);
  hint.classList.add('hint');
  el.append(coverOf(item), text, moreButton(item), hint);
  bindItem(el, item);
  return el;
}

function tile(item) {
  const el = div('tile');
  el.append(coverOf(item), div('title', item.title), subLine(item), moreButton(item));
  bindItem(el, item);
  return el;
}

// A shelf of cards scrolls sideways like on YouTube Music, everything else is rows.
function renderSection(sec) {
  const el = document.createElement('section');
  if (sec.title) {
    const h = document.createElement('h2');
    h.className = 'shelf';
    h.textContent = sec.title;
    el.append(h);
  }
  const cards = sec.items.every((i) => i.card);
  sec.list = div(cards ? 'tiles' : 'rows');
  sec.list.append(...sec.items.map(cards ? tile : row));
  el.append(sec.list);
  return el;
}

function markCurrent(videoId) {
  for (const el of document.querySelectorAll('.current[data-video]')) el.classList.remove('current');
  if (!videoId) return;
  for (const el of document.querySelectorAll('[data-video="' + videoId + '"]')) el.classList.add('current');
}

async function show(next) {
  if (view) view.scroll = main.scrollTop;
  view = next;
  closeMenu();
  $('back').hidden = !stack.length;
  for (const b of document.querySelectorAll('nav button')) b.setAttribute('aria-current', String(b.dataset.browse === next.root));
  $('heading').textContent = next.title;
  $('actions').hidden = true;
  $('list').replaceChildren();
  status(T.loading);
  let page = next.page;
  if (!page) {
    // A newer attempt at the same view, after the player page came back, wins as well.
    const attempt = (next.attempt = (next.attempt || 0) + 1);
    next.loading = true;
    try {
      page = await next.load();
    } catch (e) {
      if (next.attempt !== attempt) return;
      next.loading = false;
      next.failed = true;
      if (view === next) fail(e);
      return;
    }
    if (next.attempt !== attempt) return;
    next.loading = next.failed = false;
    // A click elsewhere while this one loaded wins.
    if (view !== next) return;
    next.page = page;
  }
  status(page.items.length ? '' : T.empty, !page.items.length);
  // Play and shuffle only where the page is a list of its own (playlist, album), which the shuffle entry marks.
  const first = page.items.find((i) => i.watch);
  $('actions').hidden = !(page.shuffle && first);
  $('play-all').onclick = () => first && play({ watchEndpoint: first.watch }, first.watch.videoId);
  $('shuffle-all').onclick = () => page.shuffle && play({ watchPlaylistEndpoint: page.shuffle });
  $('list').append(...page.sections.map(renderSection));
  main.scrollTop = next.scroll || 0;
  checkMore();
}

function go(next) {
  if (view) stack.push(view);
  show(next);
}
// ponytail: pages on the back stack are kept as loaded; a root tab or search always loads fresh.

function root(id, title) {
  stack.length = 0;
  show({ root: id, title, kind: 'browse', load: () => api.browse(id) });
}

for (const b of document.querySelectorAll('nav button')) {
  b.addEventListener('click', () => root(b.dataset.browse, b.textContent));
}
$('back').addEventListener('click', () => stack.length && show(stack.pop()));
$('open-player').addEventListener('click', api.showPlayer);
for (const action of ['mini', 'minimize', 'maximize', 'close']) {
  $('win-' + action).addEventListener('click', () => api.window(action));
}
api.onMaximized((on) => document.documentElement.classList.toggle('maximized', !!on));
// After a consent or sign-in page the player is back: a view that failed, or is
// still waiting on the old page, loads again right away.
api.onPlayerReady(() => view && !view.page && (view.failed || view.loading) && show(view));

// Long lists continue as they scroll into view, like on YouTube Music.

async function loadMore() {
  const v = view;
  const page = v && v.page;
  if (!page || !page.next || v.loadingMore) return;
  v.loadingMore = true;
  let more = null;
  try {
    more = await api.more(v.kind, page.next);
  } catch {}
  v.loadingMore = false;
  // On failure the token stays, the next scroll tries again.
  if (!more) return;
  page.next = more.next;
  page.items.push(...more.items);
  for (const sec of more.sections) {
    const last = page.sections[page.sections.length - 1];
    // Untitled continuation rows belong to the list they continue.
    if (!sec.title && last && !last.title) {
      last.items.push(...sec.items);
      if (view === v && last.list) last.list.append(...sec.items.map(last.list.className === 'tiles' ? tile : row));
    } else {
      page.sections.push(sec);
      if (view === v) $('list').append(renderSection(sec));
    }
  }
  if (view === v) checkMore();
}

// The observer only reports changes, so a page that still ends inside the
// viewport after an append is checked once more by hand.
function checkMore() {
  requestAnimationFrame(() => {
    const r = $('more').getBoundingClientRect();
    if (r.top < main.getBoundingClientRect().bottom + 800) loadMore();
  });
}

new IntersectionObserver((entries) => entries[0].isIntersecting && loadMore(), {
  root: main,
  rootMargin: '800px',
}).observe($('more'));

// Context menu

function nameOf(item, browseId) {
  const p = (item.parts || []).find((x) => x.browseId === browseId);
  return p ? p.text : item.subtitle || item.title;
}

function menuEntries(item) {
  const out = [];
  const add = (label, run) => out.push([label, run]);
  if (item.watch) add(T.playAll, () => activate(item));
  else {
    add(T.open, () => activate(item));
    if (item.play) add(T.playAll, () => play(item.play));
  }
  if (item.shuffle) add(T.shuffle, () => play(item.shuffle));
  if (item.radio) add(T.radio, () => play(item.radio));
  if (item.queue) {
    add(T.playNext, () => queueAdd(item.queue, 'INSERT_AFTER_CURRENT_VIDEO', T.addedNext));
    add(T.addQueue, () => queueAdd(item.queue, 'INSERT_AT_END', T.addedQueue));
  }
  if (item.watch) add(T.addPlaylist, () => saveToPlaylist(item));
  if (item.artistId && item.artistId !== item.browseId) add(T.goArtist, () => openPage(nameOf(item, item.artistId), item.artistId));
  if (item.albumId && item.albumId !== item.browseId) add(T.goAlbum, () => openPage(nameOf(item, item.albumId), item.albumId));
  return out;
}

let menuFocus = null;

function openMenu(item, x, y) {
  const m = $('menu');
  menuFocus = document.activeElement;
  m.replaceChildren(
    ...menuEntries(item).map(([label, run]) => {
      const b = document.createElement('button');
      b.setAttribute('role', 'menuitem');
      b.textContent = label;
      b.addEventListener('click', () => {
        closeMenu();
        run();
      });
      return b;
    })
  );
  m.hidden = false;
  const r = m.getBoundingClientRect();
  m.style.left = Math.max(8, Math.min(x, innerWidth - r.width - 8)) + 'px';
  m.style.top = Math.max(8, Math.min(y, innerHeight - r.height - 8)) + 'px';
  m.querySelector('button').focus();
}

function closeMenu() {
  const m = $('menu');
  if (m.hidden) return;
  m.hidden = true;
  if (menuFocus && document.activeElement && m.contains(document.activeElement)) menuFocus.focus();
}

document.addEventListener('pointerdown', (e) => !$('menu').contains(e.target) && closeMenu(), true);
main.addEventListener('scroll', closeMenu, { passive: true });
window.addEventListener('blur', closeMenu);
$('menu').addEventListener('keydown', (e) => {
  const items = [...$('menu').querySelectorAll('button')];
  const i = items.indexOf(document.activeElement);
  if (e.key === 'Escape') closeMenu();
  else if (e.key === 'ArrowDown') items[(i + 1) % items.length].focus();
  else if (e.key === 'ArrowUp') items[(i - 1 + items.length) % items.length].focus();
  else return;
  e.preventDefault();
});

async function queueAdd(target, position, done) {
  try {
    const n = await api.queueAdd(target, position);
    // -1: nothing was playing, so the target simply started.
    if (n > 0) toast(done);
    if (n && !$('queue').hidden) loadQueue();
  } catch {
    toast(T.queueFailed);
  }
}

// Save to playlist, in a native modal dialog.

async function saveToPlaylist(item) {
  const d = $('pl-dialog');
  const videoId = item.watch.videoId;
  $('pl-list').replaceChildren();
  $('pl-status').textContent = T.loading;
  d.showModal();
  let lists = [];
  try {
    lists = await api.playlists(videoId);
  } catch {}
  if (!d.open) return;
  $('pl-status').textContent = lists.length ? '' : T.noPlaylists;
  $('pl-list').append(
    ...lists.map((p) => {
      const b = document.createElement('button');
      b.textContent = p.title;
      b.addEventListener('click', async () => {
        d.close();
        const ok = await api.playlistAdd(p.playlistId, videoId).catch(() => false);
        toast(ok ? T.savedTo + p.title : T.saveFailed);
      });
      return b;
    })
  );
}
$('pl-cancel').addEventListener('click', () => $('pl-dialog').close());

// Search with suggestions from YouTube Music.

const input = document.querySelector('#search input');
const ICON_SEARCH = document.querySelector('#search > svg path').getAttribute('d');
let suggestTimer = null;
let suggestSeq = 0;
let active = -1;

const options = () => [...$('suggest').children];

function closeSuggest() {
  suggestSeq++;
  clearTimeout(suggestTimer);
  $('suggest').hidden = true;
  input.setAttribute('aria-expanded', 'false');
  input.removeAttribute('aria-activedescendant');
  active = -1;
}

function search(q) {
  closeSuggest();
  if (q) go({ title: q, kind: 'search', load: () => api.search(q) });
}

function setActive(i) {
  const list = options();
  active = list.length ? (i + list.length) % list.length : -1;
  list.forEach((o, n) => o.setAttribute('aria-selected', String(n === active)));
  if (active >= 0) input.setAttribute('aria-activedescendant', list[active].id);
}

// What was typed stays plain, the completion is bold, as on YouTube Music.
function showSuggestions(q, list) {
  $('suggest').replaceChildren(
    ...list.map((s, n) => {
      const o = document.createElement('div');
      o.id = 'suggest-' + n;
      o.setAttribute('role', 'option');
      const label = document.createElement('span');
      const typed = s.toLowerCase().startsWith(q.toLowerCase()) ? q.length : 0;
      const bold = document.createElement('b');
      bold.textContent = s.slice(typed);
      label.append(s.slice(0, typed), bold);
      o.append(svg(ICON_SEARCH), label);
      // pointerdown, not click: keeps focus in the field, so blur does not close the list first.
      o.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        input.value = s;
        search(s);
      });
      return o;
    })
  );
  active = -1;
  const open = list.length > 0 && document.activeElement === input;
  $('suggest').hidden = !open;
  input.setAttribute('aria-expanded', String(open));
}

$('search').addEventListener('submit', (e) => {
  e.preventDefault();
  const pick = active >= 0 ? options()[active] : null;
  if (pick) input.value = pick.textContent;
  search(input.value.trim());
});
input.addEventListener('input', () => {
  $('search-clear').hidden = !input.value;
  clearTimeout(suggestTimer);
  const q = input.value.trim();
  if (!q) return closeSuggest();
  suggestTimer = setTimeout(async () => {
    const seq = ++suggestSeq;
    const list = await api.suggest(q).catch(() => []);
    if (seq === suggestSeq) showSuggestions(q, list);
  }, 150);
});
input.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    if ($('suggest').hidden) return;
    e.preventDefault();
    setActive(active + (e.key === 'ArrowDown' ? 1 : -1));
  } else if (e.key === 'Escape' && !$('suggest').hidden) {
    e.preventDefault();
    closeSuggest();
  }
});
input.addEventListener('focus', () => {
  if (options().length && input.value.trim()) {
    $('suggest').hidden = false;
    input.setAttribute('aria-expanded', 'true');
  }
});
input.addEventListener('blur', () => {
  $('suggest').hidden = true;
  input.setAttribute('aria-expanded', 'false');
});
$('search-clear').addEventListener('click', () => {
  input.value = '';
  $('search-clear').hidden = true;
  $('suggest').replaceChildren();
  closeSuggest();
  input.focus();
});

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

// Player bar

let track = null;
let lastArt = null;
let lastTime = null;
let lastId = null;

const fmt = (s) => {
  s = Math.max(0, Math.floor(s));
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
};

function positionNow() {
  if (!track || !(track.duration > 0)) return 0;
  const elapsed = track.playing ? Math.max(0, Date.now() - (track.at || Date.now())) / 1000 : 0;
  return Math.min(track.duration, track.position + elapsed);
}

// While the seek bar is held it shows where it would land, not where the track is.
let scrubbing = false;

const duration = () => (track && track.duration > 0 ? track.duration : 0);

// Puts fill and knob at p (0..1) and, while playing, lets both run to the end on
// their own. Restarted on every track update, which also absorbs any drift.
function placeBar(p, secondsLeft) {
  const parts = [$('fill'), $('glide')];
  for (const el of parts) {
    el.style.transition = 'none';
    el.style.transform = 'translateX(' + (Math.min(1, Math.max(0, p)) - 1) * 100 + '%)';
  }
  if (!(secondsLeft > 0)) return;
  // Commits the start position, or the browser merges both writes and skips the jump.
  void parts[0].offsetWidth;
  for (const el of parts) {
    el.style.transition = 'transform ' + secondsLeft + 's linear';
    el.style.transform = 'translateX(0%)';
  }
}

function syncBar() {
  if (scrubbing) return;
  const dur = duration();
  const pos = positionNow();
  placeBar(dur ? pos / dur : 0, dur && track.playing ? dur - pos : 0);
}

// Text and the range's own value only; the bar itself moves by transition.
function drawProgress() {
  const seek = $('seek');
  const dur = duration();
  seek.disabled = !dur;
  const max = String(Math.floor(dur) || 1);
  if (seek.max !== max) seek.max = max;
  const pos = scrubbing ? Number(seek.value) : positionNow();
  if (!scrubbing) seek.value = Math.floor(pos);
  const time = dur ? fmt(pos) + ' / ' + fmt(dur) : '';
  if (time !== lastTime) $('time').textContent = lastTime = time;
}

// Average colour of the cover, capped so a white cover cannot wash out the text over it.
// A host without CORS headers taints the canvas; the bar then just stays dark.
function coverColor(url) {
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.src = url;
  return img.decode().then(() => {
    const c = document.createElement('canvas');
    c.width = c.height = 1;
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0, 1, 1);
    const [r, gr, b] = g.getImageData(0, 0, 1, 1).data;
    const k = Math.min(1, 190 / Math.max(r, gr, b, 1));
    return 'rgb(' + [r, gr, b].map((v) => Math.round(v * k)).join(' ') + ')';
  });
}

function applyLike(like) {
  $('like').setAttribute('aria-pressed', String(like === 'LIKE'));
  $('dislike').setAttribute('aria-pressed', String(like === 'DISLIKE'));
}

function applyControls(c) {
  if (!c) return;
  $('shuffle').setAttribute('aria-pressed', String(c.shuffle));
  const repeatOn = c.repeat !== 'NONE';
  $('repeat').setAttribute('aria-pressed', String(repeatOn));
  $('repeat').title = T['repeat' + c.repeat];
  $('repeat').setAttribute('aria-label', T['repeat' + c.repeat]);
  $('repeat').querySelector('path').setAttribute('d', c.repeat === 'ONE' ? ICON_REPEAT_ONE : ICON_REPEAT);
  applyLike(c.like);
  $('mute').classList.toggle('muted', c.muted);
  // Not while the slider is being dragged, or the page's older value yanks it back.
  if (document.activeElement !== $('volume')) $('volume').value = c.muted ? 0 : c.volume;
}

const refreshControls = () => api.controls().then(applyControls, () => {});

// Artist and album names under the title become links once the page's player bar
// shows them. It updates a moment after the track, so links that do not match
// the new artist are from the old one and get another try.
async function loadNowLinks(id, tries = 0) {
  const links = await api.nowLinks().catch(() => []);
  if (id !== lastId || !track || track.ad) return;
  const artists = links.filter((l) => l.browseId.startsWith('UC'));
  const album = links.find((l) => l.browseId.startsWith('MPRE'));
  if (!artists.some((l) => track.artist.includes(l.text))) {
    if (tries < 4) setTimeout(() => loadNowLinks(id, tries + 1), 800);
    return;
  }
  const box = $('artist');
  box.replaceChildren();
  const link = (l) => {
    const a = document.createElement('span');
    a.className = 'link';
    a.textContent = l.text;
    a.addEventListener('click', () => openPage(l.text, l.browseId));
    return a;
  };
  artists.forEach((l, i) => box.append(...(i ? [', ', link(l)] : [link(l)])));
  if (album) box.append(' \u2022 ', link(album));
}

api.onTrack((t) => {
  const has = !!(t && t.title);
  track = has ? t : null;
  document.body.classList.toggle('has-track', has);
  document.body.classList.toggle('playing', has && !!t.playing);
  document.body.classList.toggle('ad', has && !!t.ad);
  if (has && t.like) applyLike(t.like);
  document.title = has && !t.ad ? t.title + (t.artist ? ' - ' + t.artist : '') : 'Music';

  const art = has ? t.art || '' : '';
  if (art !== lastArt) {
    lastArt = art;
    // Quoted and escaped so a stray quote cannot end the value; main only passes https urls anyway.
    const css = art ? 'url("' + art.replace(/["\\]/g, encodeURIComponent) + '")' : '';
    $('art').style.backgroundImage = css;
    const bar = document.querySelector('footer');
    const reset = () => bar.style.removeProperty('--cover');
    if (!art) reset();
    else
      coverColor(art).then(
        (color) => {
          // A newer track may have arrived while this one decoded.
          if (art === lastArt) bar.style.setProperty('--cover', color);
        },
        () => art === lastArt && reset()
      );
  }

  // Everything that belongs to the track follows a change of it.
  const id = has ? [t.videoId, t.title, t.artist, !!t.ad].join('\n') : null;
  if (id !== lastId) {
    lastId = id;
    $('title').textContent = !has ? T.nothing : t.ad ? T.ad : t.title;
    $('artist').textContent = !has ? '' : t.ad ? T.adHint : t.artist;
    if (!(has && t.ad)) markCurrent(has ? t.videoId : null);
    if (has) refreshControls();
    if (has && !t.ad) loadNowLinks(id);
    if (!$('queue').hidden) (panelTab === 'lyrics' ? loadLyrics : loadQueue)();
  }
  drawProgress();
  syncBar();
});

setInterval(drawProgress, 250);

for (const id of ['previous', 'playpause', 'next']) {
  $(id).addEventListener('click', () => api.command(id));
}
for (const action of ['shuffle', 'repeat', 'like', 'dislike', 'mute']) {
  $(action).addEventListener('click', async () => {
    applyControls(await api.control(action).catch(() => null));
    // Shuffle reorders the queue in place.
    if (action === 'shuffle' && !$('queue').hidden && panelTab === 'queue') loadQueue();
  });
}
// Live while dragging. One request at a time; whatever the slider says when it
// returns goes next, so a fast drag never queues up a backlog of stale values.
let volumeBusy = false;
async function sendVolume() {
  if (volumeBusy) return;
  volumeBusy = true;
  let sent;
  let state = null;
  do {
    sent = Number($('volume').value);
    state = await api.control('volume', sent).catch(() => null);
  } while (Number($('volume').value) !== sent);
  volumeBusy = false;
  applyControls(state);
}
$('volume').addEventListener('input', sendVolume);

function setScrubbing(on) {
  scrubbing = on;
  $('seekbar').classList.toggle('scrubbing', on);
}

// The time under the pointer, so a spot can be picked to the second before clicking.
function showTip(p) {
  const tip = $('seek-tip');
  const w = $('seekbar').clientWidth;
  tip.textContent = fmt(p * duration());
  tip.style.left = Math.min(w - 24, Math.max(24, p * w)) + 'px';
  tip.hidden = false;
}

$('seekbar').addEventListener('pointermove', (e) => {
  if (!duration() || scrubbing) return;
  const r = e.currentTarget.getBoundingClientRect();
  showTip((e.clientX - r.left) / r.width);
});
$('seekbar').addEventListener('pointerleave', () => {
  if (!scrubbing) $('seek-tip').hidden = true;
});
$('seek').addEventListener('pointerdown', () => setScrubbing(true));
$('seek').addEventListener('input', (e) => {
  setScrubbing(true);
  const p = Number(e.target.value) / Number(e.target.max);
  placeBar(p, 0);
  showTip(p);
  drawProgress();
});
// change fires on release, and once per arrow key press.
$('seek').addEventListener('change', (e) => {
  setScrubbing(false);
  if (!$('seekbar').matches(':hover')) $('seek-tip').hidden = true;
  if (!track) return;
  const to = Number(e.target.value);
  api.command('seek', to);
  // Shown at once; the page confirms with its seeked event a moment later.
  track = { ...track, position: to, at: Date.now() };
  drawProgress();
  syncBar();
});
// A press without a move fires no change.
for (const ev of ['pointerup', 'pointercancel']) {
  $('seek').addEventListener(ev, () =>
    setTimeout(() => {
      if (!scrubbing) return;
      setScrubbing(false);
      syncBar();
    })
  );
}

// Up next and lyrics

let queueSeq = 0;
let panelTab = 'queue';
let lyricsFor = null;

async function loadQueue() {
  const seq = ++queueSeq;
  let rows = [];
  // Right after a track change the page rebuilds its queue and briefly has none.
  for (let tries = 0; tries < 6; tries++) {
    if (tries) await new Promise((ok) => setTimeout(ok, 700));
    rows = await api.queue().catch(() => []);
    if (seq !== queueSeq || $('queue').hidden) return;
    if (rows.length || !track) break;
  }
  $('queue-empty').hidden = rows.length > 0;
  $('queue-list').replaceChildren(
    ...rows.map((q, i) => {
      const el = document.createElement('button');
      el.className = 'qrow';
      el.setAttribute('aria-current', String(q.selected));
      const text = div('text');
      text.append(div('title', q.title), div('sub', q.artist));
      el.append(div('cover'), text, div('len', q.length));
      el.firstChild.append(thumb(q.thumb));
      el.addEventListener('click', () => api.queuePlay(i, q.videoId));
      return el;
    })
  );
  const current = $('queue-list').querySelector('[aria-current="true"]');
  if (current) current.scrollIntoView({ block: 'nearest' });
}

async function loadLyrics() {
  const id = track && !track.ad ? track.videoId : null;
  if (id === lyricsFor) return;
  lyricsFor = id;
  $('lyrics-source').textContent = '';
  $('lyrics').textContent = id ? T.loading : T.noLyrics;
  if (!id) return;
  const l = await api.lyrics(id).catch(() => null);
  if (lyricsFor !== id) return;
  $('lyrics').textContent = l && l.text ? l.text : T.noLyrics;
  $('lyrics-source').textContent = (l && l.source) || '';
  $('lyrics-pane').scrollTop = 0;
}

function showTab(tab) {
  panelTab = tab;
  $('tab-queue').setAttribute('aria-selected', String(tab === 'queue'));
  $('tab-lyrics').setAttribute('aria-selected', String(tab === 'lyrics'));
  $('queue-pane').hidden = tab !== 'queue';
  $('lyrics-pane').hidden = tab !== 'lyrics';
  if (tab === 'lyrics') loadLyrics();
  else loadQueue();
}

function toggleQueue(open = $('queue').hidden) {
  $('queue').hidden = !open;
  $('queue-toggle').setAttribute('aria-pressed', String(open));
  if (open) showTab(panelTab);
}

$('art-btn').addEventListener('click', () => toggleQueue());
$('title').addEventListener('click', () => toggleQueue());
$('queue-toggle').addEventListener('click', () => toggleQueue());
$('queue-close').addEventListener('click', () => toggleQueue(false));
$('tab-queue').addEventListener('click', () => showTab('queue'));
$('tab-lyrics').addEventListener('click', () => showTab('lyrics'));

// Space plays and pauses everywhere except while typing. A focused button would
// otherwise press itself again, and a row would restart its track.
document.addEventListener('keydown', (e) => {
  if (e.code !== 'Space' || e.repeat || e.ctrlKey || e.altKey || e.metaKey) return;
  if (e.target.closest('input[type="search"], textarea, [contenteditable], dialog, #menu') || !track) return;
  e.preventDefault();
  api.command('playpause');
});

api.request();
root('FEmusic_home', T.home);
