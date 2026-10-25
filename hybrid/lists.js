'use strict';

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
  setSlot(null);
  $('back').hidden = !stack.length;
  for (const b of document.querySelectorAll('nav button')) b.setAttribute('aria-current', String(b.dataset.browse === next.root));
  $('heading').textContent = next.title;
  $('actions').hidden = true;
  renderTabs(next);
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
  // Settings and other pages that are not lists draw themselves.
  if (next.render) {
    status('');
    next.render(page);
    main.scrollTop = next.scroll || 0;
    return;
  }
  status(page.items.length ? '' : T.empty);
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

// The parts of the library and of explore, each a browse page of its own.
const TABS = {
  library: [
    ['FEmusic_liked_playlists', 'tabPlaylists'],
    ['FEmusic_liked_videos', 'tabSongs'],
    ['FEmusic_liked_albums', 'tabAlbums'],
    ['FEmusic_library_corpus_track_artists', 'tabArtists'],
    ['FEmusic_library_corpus_artists', 'tabSubs'],
    ['FEmusic_history', 'tabHistory'],
  ],
  explore: [
    ['FEmusic_explore', 'explore'],
    ['FEmusic_new_releases', 'tabNew'],
    ['FEmusic_charts', 'tabCharts'],
  ],
};

function renderTabs(v) {
  const tabs = v.tabs ? TABS[v.tabs] : null;
  $('tabs').hidden = !tabs;
  if (!tabs) return;
  $('tabs').replaceChildren(
    ...tabs.map(([id, key]) => {
      const b = document.createElement('button');
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', String(id === v.browseId));
      b.textContent = T[key];
      b.addEventListener('click', () => id !== v.browseId && root(v.root, v.title, v.tabs, id));
      return b;
    })
  );
}

// A navigation entry; `tab` picks one part of a page that has several.
function root(id, title, tabs, tab = id) {
  stack.length = 0;
  try {
    localStorage.setItem('root', JSON.stringify([id, tab]));
  } catch {}
  show({ root: id, title, tabs, browseId: tab, kind: 'browse', load: () => api.browse(tab) });
}

for (const b of document.querySelectorAll('nav button')) {
  b.addEventListener('click', () => root(b.dataset.browse, b.textContent, b.dataset.tabs));
}

// The app opens on the navigation entry and tab it was left on, home otherwise.
function restoreRoot() {
  let id = 'FEmusic_home';
  let tab = id;
  try {
    [id, tab] = JSON.parse(localStorage.getItem('root')) || [id, tab];
  } catch {}
  const b = [...document.querySelectorAll('nav button')].find((n) => n.dataset.browse === id);
  if (!b) return root('FEmusic_home', T.home);
  const tabs = b.dataset.tabs;
  const known = tab === id || (tabs && TABS[tabs].some(([t]) => t === tab));
  root(id, b.textContent, tabs, known ? tab : id);
}
$('back').addEventListener('click', () => stack.length && show(stack.pop()));
for (const action of ['mini', 'minimize', 'maximize', 'close']) {
  $('win-' + action).addEventListener('click', () => api.window(action));
}
api.onMaximized((on) => document.documentElement.classList.toggle('maximized', !!on));

// Shown only while signed out; it goes once the page is back with an account.
async function checkAccount() {
  let signedIn = null;
  try {
    signedIn = await api.signedIn();
  } catch {}
  $('sign-in').hidden = signedIn !== false;
}
$('sign-in').addEventListener('click', api.signIn);
checkAccount();

// Consent and sign-in pages need the user, so the page shows itself for them.
api.onPlayerAway(() => setSlot('page', true));
// Back from such a page, what was on screen loads again, now for the account.
// A view that failed or still waits on the old page does so too.
api.onPlayerReady(() => {
  checkAccount();
  // A page the user opened stays, even when it reloads.
  const back = slot === 'page' && slotAway;
  if (back) setSlot(null);
  if (!view || !(back || (!view.page && (view.failed || view.loading)))) return;
  view.page = null;
  show(view);
});

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
