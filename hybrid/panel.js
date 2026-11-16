'use strict';

// The side panel (now playing, up next, lyrics) and the big view

let queueSeq = 0;
let panelTab = 'now';

const ICON_REMOVE = 'M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z';

function removeFromQueue(q) {
  api.queueRemove(q.itemId).then(loadQueue, () => toast(T.queueFailed));
}

// The queue proper can be reordered by dragging, as on YouTube Music; the autoplay
// suggestions under it cannot (top is -1 for those).
let dragFrom = -1;

function queueRow(q, i) {
  const el = div('qrow');
  el.tabIndex = 0;
  el.setAttribute('role', 'button');
  el.setAttribute('aria-current', String(q.selected));
  const text = div('text');
  text.append(div('title', q.title), div('sub', q.artist));
  const cover = div('cover');
  cover.append(thumb(q.thumb));
  el.append(cover, text, q.selected ? eqBars() : div('len', q.length));
  // The playing track stays; removing it would only skip ahead.
  const removable = !q.selected && q.itemId !== null;
  el.append(removable ? iconButton('drop', ICON_REMOVE, T.remove, () => removeFromQueue(q)) : div(''));
  const playRow = () => api.queuePlay(i, q.videoId).catch(fail);
  el.addEventListener('click', playRow);
  el.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const r = el.getBoundingClientRect();
    openMenu(menuEntries({ here: true, watch: { videoId: q.videoId }, thumb: q.thumb }), e.clientX || r.left + 48, e.clientY || r.bottom);
  });
  el.addEventListener('keydown', (e) => {
    if (e.target !== el) return;
    if (e.key === 'Enter') playRow();
    else if (e.key === 'Delete' && removable) removeFromQueue(q);
    else return;
    e.preventDefault();
  });
  if (q.top < 0) return el;
  el.draggable = true;
  el.addEventListener('dragstart', (e) => {
    dragFrom = q.top;
    e.dataTransfer.effectAllowed = 'move';
    el.classList.add('dragging');
  });
  el.addEventListener('dragend', () => {
    dragFrom = -1;
    el.classList.remove('dragging');
  });
  const mark = (e) => {
    const after = e.offsetY > el.clientHeight / 2;
    el.classList.toggle('drop-before', !after);
    el.classList.toggle('drop-after', after);
    return after;
  };
  el.addEventListener('dragover', (e) => {
    if (dragFrom < 0 || dragFrom === q.top) return;
    e.preventDefault();
    mark(e);
  });
  el.addEventListener('dragleave', () => el.classList.remove('drop-before', 'drop-after'));
  el.addEventListener('drop', (e) => {
    e.preventDefault();
    const after = mark(e);
    el.classList.remove('drop-before', 'drop-after');
    if (dragFrom < 0) return;
    // The target slot as the page counts it, with the dragged row already taken out.
    let to = q.top + (after ? 1 : 0);
    if (dragFrom < to) to -= 1;
    const from = dragFrom;
    dragFrom = -1;
    if (from !== to) api.queueMove(from, to).then(loadQueue, () => toast(T.queueFailed));
  });
  return el;
}

let queueRows = [];

// Right after a track change the page rebuilds its queue and briefly has none.
async function fetchQueue(seq) {
  let rows = [];
  for (let tries = 0; tries < 6; tries++) {
    if (tries) await new Promise((ok) => setTimeout(ok, 700));
    rows = await api.queue().catch(() => []);
    if (seq !== queueSeq || $('queue').hidden) return null;
    if (rows.length || !track) break;
  }
  return rows;
}

async function loadQueue() {
  const seq = ++queueSeq;
  const rows = await fetchQueue(seq);
  if (!rows) return;
  queueRows = rows;
  if (panelTab === 'now') return drawNext();
  $('queue-empty').hidden = rows.length > 0;
  $('queue-list').replaceChildren(...rows.map(queueRow));
  const current = $('queue-list').querySelector('[aria-current="true"]');
  if (current) current.scrollIntoView({ block: 'nearest' });
}

// Up next on the now-playing tab: the one track after the playing one.
function drawNext() {
  const at = queueRows.findIndex((q) => q.selected);
  // Right after a track change no row is marked yet; showing row 0 would name the wrong track.
  const i = at + 1;
  const q = at < 0 ? null : queueRows[i];
  $('np-next').hidden = !q;
  $('np-next-row').replaceChildren(q ? queueRow(q, i) : '');
}

// Lyrics come from one request per track, shared by the panel, its preview and the big view.
const lyricsCache = new Map();
function lyricsFor(id) {
  if (!id) return Promise.resolve(null);
  if (!lyricsCache.has(id)) {
    const p = api.lyrics(id).catch(() => null);
    lyricsCache.set(id, p);
    // A failed request (page still loading, offline) is tried again next time.
    p.then((l) => !l && lyricsCache.delete(id));
    if (lyricsCache.size > 20) lyricsCache.delete(lyricsCache.keys().next().value);
  }
  return lyricsCache.get(id);
}

const playingId = () => (track && !track.ad ? track.videoId : null);

async function loadLyrics() {
  const id = playingId();
  $('lyrics-source').textContent = '';
  $('lyrics').textContent = id ? T.loading : T.noLyrics;
  if (!id) return;
  const l = await lyricsFor(id);
  if (playingId() !== id || panelTab !== 'lyrics') return;
  $('lyrics').textContent = l && l.text ? l.text : T.noLyrics;
  $('lyrics-source').textContent = (l && l.source) || '';
  $('lyrics-pane').scrollTop = 0;
}

async function drawNow() {
  const id = playingId();
  // Nothing playing: the title says so, no empty cover or buttons.
  for (const el of ['np-art', 'np-like', 'np-more']) $(el).hidden = !track;
  $('np-lyrics').hidden = true;
  loadQueue();
  if (!id) return;
  const l = await lyricsFor(id);
  if (playingId() !== id || panelTab !== 'now') return;
  const text = l && l.text ? l.text.split('\n').filter((x) => x.trim()).slice(0, 4).join('\n') : '';
  $('np-lyrics').hidden = !text;
  $('np-lyrics').querySelector('p').textContent = text;
}

function showTab(tab) {
  panelTab = tab;
  for (const t of ['now', 'queue', 'lyrics']) $('tab-' + t).setAttribute('aria-selected', String(t === tab));
  $('now-pane').hidden = tab !== 'now';
  $('queue-pane').hidden = tab !== 'queue';
  $('lyrics-pane').hidden = tab !== 'lyrics';
  $('queue-save').hidden = tab !== 'queue';
  $('queue-toggle').setAttribute('aria-pressed', String(!$('queue').hidden && tab === 'queue'));
  $('lyrics-toggle').setAttribute('aria-pressed', String(!$('queue').hidden && tab === 'lyrics'));
  savePanel();
  if (tab === 'lyrics') loadLyrics();
  else if (tab === 'now') drawNow();
  else loadQueue();
}

// The library folds to its covers when the page would otherwise get too narrow.
function updateRail() {
  document.body.classList.toggle('rail', innerWidth < 1100 || (!$('queue').hidden && innerWidth < 1400));
}
addEventListener('resize', updateRail);

const savePanel = () => {
  updateRail();
  try {
    localStorage.setItem('panel', $('queue').hidden ? '' : panelTab);
  } catch {}
};

// A narrow window lays the panel over the page, where the player's own view would cover it.
const narrow = matchMedia('(max-width: 899px)');

// Opens on `tab`; asked for the tab it already shows, it closes.
function toggleQueue(open, tab = panelTab) {
  if (open === undefined) open = $('queue').hidden || tab !== panelTab;
  if (open && narrow.matches && slot === 'stage') setSlot(null);
  $('queue').hidden = !open;
  if (open) showTab(tab);
  else {
    $('queue-toggle').setAttribute('aria-pressed', 'false');
    $('lyrics-toggle').setAttribute('aria-pressed', 'false');
    savePanel();
  }
}

// The playing page itself, inside this window: its player as the stage of the
// now-playing view, or the whole page for sign-in and what this UI lacks. Main
// lays it over the slot, so whatever is drawn there here stays underneath.
let slot = null;
// The page slot was opened for a consent or sign-in page, not by the user.
let slotAway = false;
// A track without a video shows its cover here, whatever the page's layout does with it.
let stageVideo = true;

function slotElement() {
  if (slot === 'stage') return stageVideo ? $('stage-video') : null;
  if (slot === 'page') return $('middle');
  return null;
}

function placePlayer() {
  const el = slotElement();
  if (!el) return api.playerView(null, null);
  const r = el.getBoundingClientRect();
  api.playerView(slot, { x: r.x, y: r.y, width: r.width, height: r.height });
}

function setStageVideo(video) {
  $('stage').classList.toggle('video', video);
  if (video === stageVideo) return;
  stageVideo = video;
  placePlayer();
}

function setSlot(next, away = false) {
  slotAway = next === 'page' && away;
  if (next === slot) return;
  slot = next;
  main.hidden = slot === 'stage';
  $('stage').hidden = slot !== 'stage';
  $('stage-toggle').setAttribute('aria-pressed', String(slot === 'stage'));
  if (slot === 'stage') drawStage();
  placePlayer();
}

// The big view's own lyrics, beside the cover.
async function drawStage() {
  const id = playingId();
  const box = $('stage-lyrics');
  box.classList.add('none');
  box.textContent = id ? T.loading : '';
  if (!id) return;
  const l = await lyricsFor(id);
  if (playingId() !== id) return;
  box.classList.toggle('none', !(l && l.text));
  box.textContent = l && l.text ? l.text : T.noLyrics;
  box.scrollTop = 0;
}

// Like YouTube Music's player page: the player big, with its lyrics.
function toggleStage(open = slot !== 'stage') {
  setSlot(open ? 'stage' : null);
}

// Everything in the panel and the big view that belongs to the track follows a change of it.
function trackChanged() {
  if (!$('queue').hidden) showTab(panelTab);
  if (slot === 'stage') drawStage();
}

narrow.addEventListener('change', () => narrow.matches && slot === 'stage' && toggleQueue(false));

const slotWatch = new ResizeObserver(placePlayer);
slotWatch.observe($('stage-video'));
slotWatch.observe($('middle'));

$('art-btn').addEventListener('click', () => toggleStage());
$('np-art').addEventListener('click', () => toggleStage(true));
$('stage-toggle').addEventListener('click', () => toggleStage());
$('stage-close').addEventListener('click', () => toggleStage(false));
$('stage-full').addEventListener('click', () => api.window('fullscreen'));

// The playing track's menu: from the bar, the side panel's more button and the cover.
let nowMenuSeq = 0;
async function nowMenu(x, y) {
  if (!track || track.ad || !track.videoId) return;
  const seq = ++nowMenuSeq;
  const videoId = track.videoId;
  const parts = await api.nowLinks().catch(() => []);
  // A newer click or a track change while the links loaded wins.
  if (seq !== nowMenuSeq || track?.videoId !== videoId) return;
  const id = (prefix) => parts.find((p) => p.browseId.startsWith(prefix))?.browseId;
  const item = { here: true, watch: { videoId }, parts, artistId: id('UC'), albumId: id('MPRE'), thumb: track.art };
  item.radio = { watchEndpoint: { videoId, playlistId: 'RDAMVM' + videoId } };
  const entries = menuEntries(item);
  const disliked = $('dislike').getAttribute('aria-pressed') === 'true';
  // Rating sits here as well, with the keys that do the same.
  entries.splice(entries.indexOf('-') + 1, 0, { label: T.dislike, icon: disliked ? ICONS.block : ICONS.dislike, key: 'D', run: () => $('dislike').click() });
  openMenu(entries, x, y);
}
$('now').addEventListener('contextmenu', (e) => {
  e.preventDefault();
  const r = $('now').getBoundingClientRect();
  nowMenu(e.clientX || r.left, e.clientY || r.top);
});
$('np-more').addEventListener('click', (e) => {
  const r = e.currentTarget.getBoundingClientRect();
  nowMenu(r.left, r.bottom);
});
$('title').addEventListener('click', () => toggleStage());
$('queue-toggle').addEventListener('click', () => toggleQueue(undefined, 'queue'));
$('lyrics-toggle').addEventListener('click', () => toggleQueue(undefined, 'lyrics'));
$('queue-close').addEventListener('click', () => toggleQueue(false));
// Everything the list shows, autoplay suggestions included.
$('queue-save').addEventListener('click', () => saveToPlaylist(queueRows.map((q) => q.videoId)));
for (const t of ['now', 'queue', 'lyrics']) $('tab-' + t).addEventListener('click', () => showTab(t));
$('np-lyrics').addEventListener('click', () => showTab('lyrics'));
$('np-open-queue').addEventListener('click', () => showTab('queue'));

// The panel comes back as it was left; the first time it opens on wide windows only.
(() => {
  let saved = null;
  try {
    saved = localStorage.getItem('panel');
  } catch {}
  if (saved === null) saved = innerWidth >= 1280 ? 'now' : '';
  if (['now', 'queue', 'lyrics'].includes(saved)) {
    panelTab = saved;
    $('queue').hidden = false;
    showTab(saved);
  }
})();
