'use strict';

// Up next and lyrics

let queueSeq = 0;
let panelTab = 'queue';
let lyricsFor = null;

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
  el.append(cover, text, div('len', q.length));
  // The playing track stays; removing it would only skip ahead.
  const removable = !q.selected && q.itemId !== null;
  el.append(removable ? iconButton('drop', ICON_REMOVE, T.remove, () => removeFromQueue(q)) : div(''));
  const playRow = () => api.queuePlay(i, q.videoId).catch(fail);
  el.addEventListener('click', playRow);
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
  $('queue-list').replaceChildren(...rows.map(queueRow));
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

// A narrow window lays the card over the stage, where the page's own view would cover it.
const narrow = matchMedia('(max-width: 760px)');

function toggleQueue(open = $('queue').hidden) {
  if (open && narrow.matches && slot === 'stage') setSlot(null);
  $('queue').hidden = !open;
  $('queue-toggle').setAttribute('aria-pressed', String(open));
  if (open) showTab(panelTab);
}

// The playing page itself, inside this window: its player as the stage of the
// now-playing view, or the whole page for sign-in and what this UI lacks. Main
// lays it over the slot, so whatever is drawn there here stays underneath.
let slot = null;
// The page slot was opened for a consent or sign-in page, not by the user.
let slotAway = false;
// A track without a video shows its cover here, whatever the page's layout does with it.
let stageVideo = true;

function placePlayer() {
  const el = slot === 'stage' ? (stageVideo ? $('stage') : null) : slot === 'page' ? $('middle') : null;
  const r = el && el.getBoundingClientRect();
  api.playerView(r ? slot : null, r && { x: r.x, y: r.y, width: r.width, height: r.height });
}

function setStageVideo(video, art) {
  const img = $('stage-art');
  if (art && img.getAttribute('src') !== art) img.src = art;
  img.hidden = video || !art;
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
  placePlayer();
}

// Like YouTube Music's player page: the player big, up next beside it.
function toggleStage(open = slot !== 'stage') {
  setSlot(open ? 'stage' : null);
  toggleQueue(open && !narrow.matches);
}

narrow.addEventListener('change', () => narrow.matches && slot === 'stage' && toggleQueue(false));

const slotWatch = new ResizeObserver(placePlayer);
slotWatch.observe($('stage'));
slotWatch.observe($('middle'));

$('art-btn').addEventListener('click', () => toggleStage());
$('title').addEventListener('click', () => toggleStage());
$('queue-toggle').addEventListener('click', () => toggleQueue());
$('queue-close').addEventListener('click', () => toggleQueue(false));
$('tab-queue').addEventListener('click', () => showTab('queue'));
$('tab-lyrics').addEventListener('click', () => showTab('lyrics'));
