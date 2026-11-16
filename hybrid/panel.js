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

// Timed lyrics from LRCLIB, one request per track; null when there are none or the setting is off.
const syncedCache = new Map();
function syncedFor(t) {
  if (!t || t.ad || !t.videoId) return Promise.resolve(null);
  if (!syncedCache.has(t.videoId)) {
    syncedCache.set(t.videoId, api.syncedLyrics({ title: t.title, artist: t.artist, duration: t.duration }).catch(() => null));
    if (syncedCache.size > 20) syncedCache.delete(syncedCache.keys().next().value);
  }
  return syncedCache.get(t.videoId);
}

// Both kinds for the playing track: timed lines where LRCLIB has them, YouTube's text otherwise.
async function lyricsNow(id) {
  const [plain, synced] = await Promise.all([lyricsFor(id), syncedFor(track)]);
  return { plain, synced: synced && synced.lines.length ? synced : null };
}

// Timed lines as paragraphs; a click on one plays from there.
function drawSynced(box, scroller, lines) {
  box.classList.add('synced');
  box.replaceChildren(
    ...lines.map((l) => {
      const p = document.createElement('p');
      p.textContent = l.text || '\u266a';
      p.addEventListener('click', () => seekTo(l.time));
      return p;
    })
  );
  box.lines = lines;
  box.active = -2;
  box.scroller = scroller;
}

function drawPlain(box, text) {
  box.classList.remove('synced');
  box.lines = null;
  box.textContent = text;
}

// Line playing now: the last one that has started.
function lineAt(lines, t) {
  let i = -1;
  while (i + 1 < lines.length && lines[i + 1].time <= t) i++;
  return i;
}

// Marks the line being sung and keeps it a third down the view, unless the user just scrolled.
function followLyrics(box) {
  if (!box.lines || box.offsetParent === null) return;
  const i = lineAt(box.lines, positionNow() + 0.2);
  if (i === box.active) return;
  box.active = i;
  [...box.children].forEach((p, n) => {
    p.classList.toggle('past', n < i);
    p.classList.toggle('now', n === i);
  });
  const el = box.children[Math.max(0, i)];
  const s = box.scroller;
  if (!el || Date.now() < (s.userScroll || 0)) return;
  const top = s.scrollTop + el.getBoundingClientRect().top - s.getBoundingClientRect().top - s.clientHeight * 0.35;
  s.scrollTo({ top: Math.max(0, top), behavior: reduceMotion.matches ? 'auto' : 'smooth' });
}
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');

// The now tab's preview runs along too: the line being sung and the two after it.
let nowLines = null;
function followPreview() {
  if (!nowLines || $('np-lyrics').hidden || $('now-pane').hidden) return;
  const i = Math.max(0, lineAt(nowLines, positionNow() + 0.2));
  const text = nowLines.slice(i, i + 3).map((l) => l.text || '\u266a').join('\n');
  const p = $('np-lyrics').querySelector('p');
  if (p.textContent !== text) p.textContent = text;
}

setInterval(() => {
  if (slot === 'stage') followLyrics($('stage-lyrics'));
  if (!$('queue').hidden && panelTab === 'lyrics') followLyrics($('lyrics'));
  if (!$('queue').hidden && panelTab === 'now') followPreview();
}, 250);

// A wheel or a drag on the lyrics pauses following for a few seconds.
for (const s of [$('lyrics-pane'), $('stage-lyrics')]) {
  for (const ev of ['wheel', 'touchmove']) s.addEventListener(ev, () => (s.userScroll = Date.now() + 4000), { passive: true });
}

async function loadLyrics() {
  const id = playingId();
  $('lyrics-source').textContent = '';
  drawPlain($('lyrics'), id ? T.loading : T.noLyrics);
  if (!id) return;
  const { plain, synced } = await lyricsNow(id);
  if (playingId() !== id || panelTab !== 'lyrics') return;
  if (synced) drawSynced($('lyrics'), $('lyrics-pane'), synced.lines);
  else drawPlain($('lyrics'), plain && plain.text ? plain.text : T.noLyrics);
  $('lyrics-source').textContent = synced ? T.lyricsFrom + synced.source : (plain && plain.source) || '';
  $('lyrics-pane').scrollTop = 0;
}

async function drawNow() {
  const id = playingId();
  // Nothing playing: the title says so, no empty cover or buttons.
  for (const el of ['np-art', 'np-like', 'np-more']) $(el).hidden = !track;
  $('np-lyrics').hidden = true;
  loadQueue();
  nowLines = null;
  if (!id) return;
  const { plain, synced } = await lyricsNow(id);
  if (playingId() !== id || panelTab !== 'now') return;
  nowLines = synced ? synced.lines : null;
  const text = plain && plain.text ? plain.text.split('\n').filter((x) => x.trim()).slice(0, 4).join('\n') : '';
  $('np-lyrics').hidden = !text && !nowLines;
  $('np-lyrics').querySelector('p').textContent = text;
  followPreview();
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
// Folded by hand, unfolded by hand, or left to the window's width.
let railPref = 'auto';
try {
  railPref = ['folded', 'unfolded'].includes(localStorage.getItem('rail')) ? localStorage.getItem('rail') : 'auto';
} catch {}

function updateRail() {
  const auto = innerWidth < 1100 || (!$('queue').hidden && innerWidth < 1400);
  const rail = railPref === 'folded' || (railPref === 'auto' && auto);
  document.body.classList.toggle('rail', rail);
  const b = $('side-toggle');
  b.setAttribute('aria-expanded', String(!rail));
  b.title = rail ? T.expandLib : T.collapseLib;
  b.setAttribute('aria-label', b.title);
}
addEventListener('resize', updateRail);

$('side-toggle').addEventListener('click', () => {
  railPref = document.body.classList.contains('rail') ? 'unfolded' : 'folded';
  try {
    localStorage.setItem('rail', railPref);
  } catch {}
  updateRail();
});

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

// The video's box at its own aspect, as large as the stage allows.
let stageAspect = 16 / 9;
function fitVideo() {
  const body = $('stage-body');
  if (!$('stage').classList.contains('video') || $('stage').hidden) return;
  const cs = getComputedStyle(body);
  const w = body.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  const h = body.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
  const width = Math.max(160, Math.min(w, h * stageAspect));
  const box = $('stage-video');
  box.style.width = Math.round(width) + 'px';
  box.style.height = Math.round(width / stageAspect) + 'px';
  // The box may only have moved (the side panel opened), which no size observer reports.
  placePlayer();
}
new ResizeObserver(fitVideo).observe($('stage-body'));

function setStageAspect(aspect) {
  const a = aspect > 0 ? aspect : 16 / 9;
  if (Math.abs(a - stageAspect) < 0.01) return;
  stageAspect = a;
  fitVideo();
}

function setStageVideo(video) {
  $('stage').classList.toggle('video', video);
  fitVideo();
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
  if (slot === 'stage') {
    drawStage();
    fitVideo();
  }
  placePlayer();
}

// The big view's own lyrics, beside the cover.
async function drawStage() {
  const id = playingId();
  const box = $('stage-lyrics');
  box.classList.add('none');
  drawPlain(box, id ? T.loading : '');
  if (!id) return;
  const { plain, synced } = await lyricsNow(id);
  if (playingId() !== id) return;
  box.classList.toggle('none', !synced && !(plain && plain.text));
  if (synced) drawSynced(box, box, synced.lines);
  else drawPlain(box, plain && plain.text ? plain.text : T.noLyrics);
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
