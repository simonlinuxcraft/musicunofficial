'use strict';

// Lists

const main = document.querySelector('main');
const stack = [];
let view = null;

const openPage = (title, browseId) => go({ title, kind: 'browse', load: () => api.browse(browseId) });

// Subtitle with its artist, album and playlist names as links.
function subLine(item) {
  const box = div('sub');
  for (const p of item.parts) {
    if (!p.browseId) {
      box.append(p.text);
      continue;
    }
    const open = (e) => {
      e.stopPropagation();
      openPage(p.text, p.browseId);
    };
    box.append(link(p.text, open));
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
  // Album tracks have no cover of their own; YouTube Music numbers them instead.
  box.append(!item.thumb && item.index ? div('index', item.index) : thumb(item.thumb));
  if (item.watch) {
    // Does what the row does, so pointer only: no extra tab stop or announcement.
    const b = iconButton('cover-play', ICON_PLAY, T.playAll, () => activate(item));
    b.tabIndex = -1;
    b.setAttribute('aria-hidden', 'true');
    box.append(b);
  } else if (item.play) box.append(iconButton('cover-play', ICON_PLAY, T.playAll, () => play(item.play)));
  return box;
}

// Ctrl+click picks tracks one by one, Shift+click a run of them, as in a file manager.
let anchor = null;

function toggleSelect(el, range) {
  const all = [...el.parentElement.querySelectorAll(':scope > [data-video]')];
  if (range && all.includes(anchor)) {
    const [a, b] = [all.indexOf(anchor), all.indexOf(el)].sort((x, y) => x - y);
    for (const x of all.slice(a, b + 1)) x.classList.add('selected');
    return;
  }
  el.classList.toggle('selected');
  anchor = el;
}

const selection = () => [...document.querySelectorAll('#list .selected')].map((el) => el.item);

function clearSelection() {
  for (const el of document.querySelectorAll('#list .selected')) el.classList.remove('selected');
  anchor = null;
}
document.addEventListener('keydown', (e) => e.key === 'Escape' && clearSelection());

function bindItem(el, item) {
  el.item = item;
  el.tabIndex = 0;
  el.setAttribute('role', 'button');
  el.addEventListener('click', (e) => {
    if (item.watch && (e.ctrlKey || e.shiftKey)) return toggleSelect(el, e.shiftKey);
    clearSelection();
    activate(item);
  });
  el.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.target !== el) return;
    e.preventDefault();
    activate(item);
  });
  el.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const many = el.classList.contains('selected') ? selection() : [];
    if (many.length < 2) clearSelection();
    const r = el.getBoundingClientRect();
    // A keyboard-opened menu has no pointer position.
    openMenu(many.length > 1 ? manyEntries(many) : menuEntries(item), e.clientX || r.left + 48, e.clientY || r.bottom);
  });
  if (item.watch) {
    el.dataset.video = item.watch.videoId;
    if (track && track.videoId === item.watch.videoId) el.classList.add('current');
  }
}

const moreButton = (item) =>
  iconButton('more', ICON_MORE, T.more, (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    openMenu(menuEntries(item), r.left, r.bottom);
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

// The arrows page a shelf by its visible width and hide when everything fits.
const pagerWatch = new ResizeObserver((entries) => entries.forEach((e) => e.target.updatePagers()));

function pagers(list) {
  const page = (dir) => list.scrollBy({ left: dir * list.clientWidth, behavior: 'smooth' });
  const prev = iconButton('pager', ICON_BACK, T.scrollLeft, () => page(-1));
  const next = iconButton('pager', ICON_OPEN, T.scrollRight, () => page(1));
  list.updatePagers = () => {
    const max = list.scrollWidth - list.clientWidth;
    prev.hidden = next.hidden = max < 2;
    // aria-disabled, not disabled: a disabled button would drop the keyboard focus.
    prev.setAttribute('aria-disabled', String(list.scrollLeft < 2));
    next.setAttribute('aria-disabled', String(list.scrollLeft > max - 2));
  };
  list.addEventListener('scroll', list.updatePagers, { passive: true });
  pagerWatch.observe(list);
  return [prev, next];
}

// Titled card shelves are carousels on YouTube Music, untitled cards a page's own grid.
function renderSection(sec) {
  const el = document.createElement('section');
  const cards = sec.items.every((i) => i.card);
  const carousel = cards && !!sec.title;
  sec.make = cards ? tile : row;
  sec.list = div(carousel ? 'tiles' : cards ? 'grid' : 'rows');
  sec.list.append(...sec.items.map(sec.make));
  if (sec.title) {
    const head = div('shelf-head');
    const h = document.createElement('h2');
    h.className = 'shelf';
    h.textContent = sec.title;
    head.append(h);
    if (carousel) head.append(...pagers(sec.list));
    el.append(head);
  }
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
  pagerWatch.disconnect();
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
  const playable = !!(page.shuffle && first);
  const more = pageEntries(page).length > 0;
  $('play-all').hidden = $('shuffle-all').hidden = !playable;
  $('page-more').hidden = !more;
  $('actions').hidden = !playable && !more;
  $('page-more').onclick = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    openMenu(pageEntries(page), r.left, r.bottom);
  };
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
let signedIn = null;

async function checkAccount() {
  signedIn = await api.signedIn().catch(() => null);
  $('sign-in').hidden = signedIn !== false;
  // Subscribing needs the account, so the page menu may only now have entries.
  if (view && view.page && !view.render) $('page-more').hidden = !pageEntries(view.page).length;
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
  if (!view) return;
  const stale = !view.page && (view.failed || view.loading);
  if (!back && !stale) return;
  view.page = null;
  show(view);
});

// Long lists continue as they scroll into view, like on YouTube Music.
const PRELOAD_PX = 800;

async function loadMore() {
  const v = view;
  const page = v && v.page;
  if (!page || !page.next || v.loadingMore) return;
  v.loadingMore = true;
  const more = await api.more(v.kind, page.next).catch(() => null);
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
      if (view === v && last.list) last.list.append(...sec.items.map(last.make));
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
    if (r.top < main.getBoundingClientRect().bottom + PRELOAD_PX) loadMore();
  });
}

new IntersectionObserver((entries) => entries[0].isIntersecting && loadMore(), {
  root: main,
  rootMargin: PRELOAD_PX + 'px',
}).observe($('more'));

// Context menu

function nameOf(item, browseId) {
  const p = (item.parts || []).find((x) => x.browseId === browseId);
  return p ? p.text : item.subtitle || item.title;
}

// Library changes all go through one call; `done` is the toast on success.
async function change(c, done) {
  const ok = await api.change(c).catch(() => false);
  toast(ok ? done : T.actionFailed);
  // Pages kept for Back may show what just changed; they load fresh instead.
  if (ok) for (const s of stack) s.page = null;
  return ok;
}

function libraryEntry(lib, add) {
  if (!lib || !(lib.saved ? lib.unsave : lib.save)) return;
  add(lib.saved ? T.unsaveLib : T.saveLib, async () => {
    if (await change(lib.saved ? lib.unsave : lib.save, lib.saved ? T.unsavedLib : T.savedLib)) lib.saved = !lib.saved;
  });
}

function copyLink(item) {
  const url = item.watch ? 'https://music.youtube.com/watch?v=' + item.watch.videoId : 'https://music.youtube.com/browse/' + item.browseId;
  navigator.clipboard.writeText(url).then(() => toast(T.linkCopied), fail);
}

// `here`: the track is already playing or queued, so playing it again would rebuild the queue.
function menuEntries(item) {
  const out = [];
  const add = (label, run) => out.push([label, run]);
  if (item.watch && !item.here) add(T.playAll, () => activate(item));
  else if (!item.watch) {
    add(T.open, () => activate(item));
    if (item.play) add(T.playAll, () => play(item.play));
  }
  if (item.shuffle) add(T.shuffle, () => play(item.shuffle));
  if (item.radio) add(T.radio, () => play(item.radio));
  if (item.queue) {
    add(T.playNext, () => queueAdd(item.queue, 'INSERT_AFTER_CURRENT_VIDEO', T.addedNext));
    add(T.addQueue, () => queueAdd(item.queue, 'INSERT_AT_END', T.addedQueue));
  }
  if (item.watch) add(T.addPlaylist, () => saveToPlaylist([item.watch.videoId]));
  libraryEntry(item.library, add);
  if (item.remove) add(T.removeFromPl, () => removeFromPlaylist([item]));
  if (item.artistId && item.artistId !== item.browseId) add(T.goArtist, () => openPage(nameOf(item, item.artistId), item.artistId));
  if (item.albumId && item.albumId !== item.browseId) add(T.goAlbum, () => openPage(nameOf(item, item.albumId), item.albumId));
  add(T.copyLink, () => copyLink(item));
  if (item.notInterested && signedIn) add(T.notInterested, () => change(item.notInterested, T.lessOften));
  return out;
}

// Several selected tracks.
function manyEntries(items) {
  const videoIds = items.map((i) => i.watch.videoId);
  const out = [
    [T.playNext, () => queueAdd({ videoIds }, 'INSERT_AFTER_CURRENT_VIDEO', T.addedNext)],
    [T.addQueue, () => queueAdd({ videoIds }, 'INSERT_AT_END', T.addedQueue)],
    [T.addPlaylist, () => saveToPlaylist(videoIds)],
  ];
  if (items.every((i) => i.remove)) out.push([T.removeFromPl, () => removeFromPlaylist(items)]);
  return out;
}

// The page's own menu: save or subscribe, and editing a playlist of the account's own.
function pageEntries(page) {
  const out = [];
  const add = (label, run) => out.push([label, run]);
  libraryEntry(page.library, add);
  const sub = page.subscribe;
  if (sub && signedIn) {
    add(sub.subscribed ? T.unsubscribe : T.subscribe, async () => {
      const on = !sub.subscribed;
      if (await change({ kind: 'subscribe', channelId: sub.channelId, on }, on ? T.subscribed : T.unsubscribed)) sub.subscribed = on;
    });
  }
  const own = page.own;
  if (!own) return out;
  add(T.rename, () => renamePlaylist(own));
  for (const privacy of ['PRIVATE', 'UNLISTED', 'PUBLIC']) {
    if (privacy === own.privacy) continue;
    add(T['priv' + privacy], async () => {
      if (await change({ kind: 'privacy', playlistId: own.playlistId, privacy }, T.changed)) own.privacy = privacy;
    });
  }
  add(T.deletePl, () => deletePlaylist(own));
  return out;
}

// Each waits on YouTube; a page left in the meantime is not touched.
async function removeFromPlaylist(items) {
  const v = view;
  const rows = items.map((i) => i.remove);
  if (!(await change({ kind: 'remove', playlistId: rows[0].playlistId, rows }, T.removedFromPl))) return;
  v.page = null;
  if (view === v) show(v);
}

async function renamePlaylist(own) {
  const v = view;
  const title = await ask(T.rename, v.title);
  if (!title || !(await change({ kind: 'rename', playlistId: own.playlistId, title }, T.changed))) return;
  v.title = title;
  if (view === v) $('heading').textContent = title;
}

async function deletePlaylist(own) {
  const v = view;
  if (!confirm(T.deleteAsk) || !(await change({ kind: 'delete', playlistId: own.playlistId }, T.deleted)) || view !== v) return;
  if (stack.length) show(stack.pop());
  else restoreRoot();
}

// A one-line text prompt; resolves to the trimmed text, or null when cancelled.
function ask(title, value) {
  const d = $('ask-dialog');
  $('ask-title').textContent = title;
  $('ask-input').value = value;
  d.returnValue = '';
  d.showModal();
  return new Promise((ok) => d.addEventListener('close', () => ok(d.returnValue === 'ok' ? $('ask-input').value.trim() : null), { once: true }));
}

let menuFocus = null;

function openMenu(entries, x, y) {
  const m = $('menu');
  menuFocus = document.activeElement;
  m.replaceChildren(
    ...entries.map(([label, run]) => {
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
// Capture, so a shelf scrolling sideways closes it too.
main.addEventListener('scroll', closeMenu, { passive: true, capture: true });
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
    // -1: nothing was playing, so the target simply started. 0: YouTube sent nothing to add.
    if (n > 0) toast(done);
    else if (n === 0) toast(T.queueFailed);
    if (n && !$('queue').hidden) loadQueue();
  } catch {
    toast(T.queueFailed);
  }
}

// Save to playlist, in a native modal dialog.

const ICON_LIST = 'M15 6H3v2h12zm0 4H3v2h12zM3 16h8v-2H3zM17 6v8.18c-.31-.11-.65-.18-1-.18-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3V8h3V6z';

function playlistCover(url) {
  if (url) return thumb(url);
  const box = document.createElement('span');
  box.className = 'pl-icon';
  box.append(svg(ICON_LIST));
  return box;
}

async function saveToPlaylist(videoIds) {
  if (!videoIds.length) return;
  const d = $('pl-dialog');
  $('pl-list').replaceChildren();
  $('pl-status').textContent = T.loading;
  $('pl-create').hidden = signedIn === false;
  $('pl-create').onclick = async () => {
    d.close();
    const title = await ask(T.newPlaylist, '');
    if (title) change({ kind: 'create', title, videoIds }, T.savedTo + title);
  };
  d.showModal();
  const lists = await api.playlists(videoIds[0]).catch(() => null);
  if (!d.open) return;
  // Signed out, YouTube refuses the request; that is the sign-in hint, not a failure.
  if (!lists || (!lists.length && signedIn === false)) return ($('pl-status').textContent = signedIn === false ? T.noPlaylists : T.actionFailed);
  $('pl-status').textContent = '';
  $('pl-list').append(
    ...lists.map((p) => {
      const b = document.createElement('button');
      const text = div('text');
      text.append(div('title', p.title));
      if (p.subtitle) text.append(div('sub', p.subtitle));
      b.append(playlistCover(p.thumb), text);
      b.addEventListener('click', () => {
        d.close();
        change({ kind: 'add', playlistId: p.playlistId, videoIds }, T.savedTo + p.title);
      });
      return b;
    })
  );
}
$('pl-cancel').addEventListener('click', () => $('pl-dialog').close());
