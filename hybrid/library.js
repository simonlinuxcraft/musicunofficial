'use strict';

// The library beside the page: the account's playlists, albums and artists with their covers.

const LIB_TABS = [
  ['FEmusic_liked_playlists', 'tabPlaylists'],
  ['FEmusic_liked_albums', 'tabAlbums'],
  ['FEmusic_library_corpus_track_artists', 'tabArtists'],
];
let libTab = LIB_TABS[0][0];
let libSort = 'recent';
let libItems = [];
let libSeq = 0;
try {
  const saved = JSON.parse(localStorage.getItem('lib')) || {};
  if (LIB_TABS.some(([id]) => id === saved.tab)) libTab = saved.tab;
  if (saved.sort === 'az') libSort = 'az';
} catch {}

// Pinned entries stay on top of their list; kept on this machine only.
let pins = new Set();
try {
  pins = new Set(JSON.parse(localStorage.getItem('pins')) || []);
} catch {}
const isPinned = (i) => i.fav || pins.has(i.browseId);
function togglePin(id) {
  if (!pins.delete(id)) pins.add(id);
  try {
    localStorage.setItem('pins', JSON.stringify([...pins]));
  } catch {}
  drawLibrary();
}

const saveLib = () => {
  try {
    localStorage.setItem('lib', JSON.stringify({ tab: libTab, sort: libSort }));
  } catch {}
};

function libRow(item) {
  const b = document.createElement('button');
  b.className = 'lrow';
  b.dataset.id = item.browseId || '';
  b.title = item.title;
  let cover;
  if (item.fav) {
    cover = document.createElement('span');
    cover.className = 'pl-icon fav';
    cover.append(svg(ICONS.liked));
  } else {
    cover = playlistCover(item.thumb);
    if (item.round) cover.classList.add('round');
  }
  const text = div('text');
  const sub = div('sub');
  if (isPinned(item)) sub.append(svg(ICONS.pin));
  sub.append(item.subtitle || '');
  text.append(div('title', item.title), sub);
  b.append(cover, text);
  b.addEventListener('click', () => activate(item));
  b.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const entries = menuEntries(item);
    if (item.browseId && !item.fav) {
      const on = pins.has(item.browseId);
      entries.unshift({ label: on ? T.unpin : T.pin, run: () => togglePin(item.browseId), icon: ICONS.pin }, '-');
    }
    openMenu(entries, e.clientX || b.getBoundingClientRect().left + 48, e.clientY || b.getBoundingClientRect().bottom);
  });
  return b;
}

function drawLibrary() {
  const q = $('lib-filter').value.trim().toLowerCase();
  let items = libItems.filter((i) => !q || (i.title + ' ' + (i.subtitle || '')).toLowerCase().includes(q));
  const rank = (i) => (i.fav ? 0 : pins.has(i.browseId) ? 1 : 2);
  items = [...items].sort((a, b) => rank(a) - rank(b) || (libSort === 'az' ? a.title.localeCompare(b.title) : 0));
  $('lib-list').replaceChildren(...items.map(libRow));
  $('lib-sort').firstChild.textContent = libSort === 'az' ? T.sortAZ : T.sortRecent;
  if (view) markLibrary(view);
}

function drawLibTabs() {
  $('lib-chips').replaceChildren(
    ...LIB_TABS.map(([id, key]) => {
      const b = document.createElement('button');
      b.className = 'chip';
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', String(id === libTab));
      b.textContent = T[key];
      b.addEventListener('click', () => {
        if (id === libTab) return;
        libTab = id;
        saveLib();
        drawLibTabs();
        // The old tab's entries go at once instead of standing in for the new ones.
        libItems = [];
        drawLibrary();
        refreshLibrary();
      });
      return b;
    })
  );
}

// ponytail: up to 10 pages (about 250 entries); a bigger library shows the newest first.
const LIB_PAGES = 10;

// Loaded once the account is known, and again after anything that changes it.
async function refreshLibrary(tries = 0) {
  // Unknown while the page cannot tell; the library stays as it was until it can.
  if (signedIn === null) return;
  const seq = ++libSeq;
  const signedOut = signedIn === false;
  $('lib-note').hidden = !signedOut;
  $('lib-new').hidden = signedOut;
  $('lib-chips').hidden = $('lib-tools').hidden = signedOut;
  if (signedOut) {
    libItems = [];
    $('lib-list').replaceChildren();
    const note = $('lib-note');
    note.textContent = T.libSignedOut;
    const b = document.createElement('button');
    b.textContent = T.signIn;
    b.addEventListener('click', api.signIn);
    note.append(b);
    return;
  }
  const page = await api.browse(libTab).catch(() => null);
  if (seq !== libSeq) return;
  // The page may still be busy right after start; try again a little later.
  if (!page) {
    if (tries < 3) setTimeout(() => seq === libSeq && refreshLibrary(tries + 1), 3000);
    return;
  }
  const items = [...page.items];
  for (let next = page.next, n = 1; next && n < LIB_PAGES; n++) {
    const more = await api.more('browse', next).catch(() => null);
    if (seq !== libSeq) return;
    if (!more) break;
    items.push(...more.items);
    next = more.next;
  }
  libItems = items.filter((i) => i.browseId || i.watch);
  // Liked songs stay on top of the playlists, with a cover of their own.
  if (libTab === 'FEmusic_liked_playlists') {
    const liked = libItems.find((i) => i.browseId === 'VLLM') || { title: T.liked, subtitle: '', browseId: 'VLLM', parts: [] };
    libItems = [{ ...liked, fav: true }, ...libItems.filter((i) => i !== liked)];
  }
  drawLibrary();
}

// The open page's entry is marked, as in a file manager's sidebar.
function markLibrary(v) {
  const id = v && (v.browseId || v.root);
  for (const r of $('lib-list').children) r.setAttribute('aria-current', String(!!id && r.dataset.id === id));
}

$('lib-filter').addEventListener('input', drawLibrary);
$('lib-sort').addEventListener('click', () => {
  libSort = libSort === 'az' ? 'recent' : 'az';
  saveLib();
  drawLibrary();
});
$('lib-new').addEventListener('click', async () => {
  const title = await ask(T.newPlaylist, '');
  if (title && (await change({ kind: 'create', title, videoIds: [] }, T.savedTo + title))) refreshLibrary();
});
drawLibTabs();
