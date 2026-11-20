'use strict';

// The side panel (now playing, up next, lyrics) and the big view

let queueSeq = 0;
let panelTab = 'now';
// The tab picked outside the big view, back once it closes.
let chosenTab = panelTab;

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
  el.append(removable ? iconButton('drop', ICONS.close, T.remove, () => removeFromQueue(q)) : div(''));
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
    // Against the row itself: offsetY counts from whichever child lies under the pointer.
    const after = e.clientY - el.getBoundingClientRect().top > el.clientHeight / 2;
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

let queueFor;
async function loadQueue() {
  const seq = ++queueSeq;
  const rows = await fetchQueue(seq);
  if (!rows) return;
  queueRows = rows;
  if (panelTab === 'now') return drawNext();
  $('queue-empty').hidden = rows.length > 0;
  $('queue-list').replaceChildren(...queueSections(rows));
  // Back to the top for a new track; a reload for the same one (drag, remove) keeps its place.
  if (track?.videoId !== queueFor) $('queue-list').scrollTop = 0;
  queueFor = track?.videoId;
}

// "3 Titel · 17 Min." for the tracks queued after the playing one.
function queueInfo(list) {
  const total = list.reduce((sum, q) => sum + (Number.isFinite(seconds(q.length)) ? seconds(q.length) : 0), 0);
  const m = Math.round(total / 60);
  const length = m >= 60 ? T.durHour.replace('{h}', Math.floor(m / 60)).replace('{m}', m % 60) : T.durMin.replace('{m}', m);
  return (list.length === 1 ? T.queueOne : T.queueInfo.replace('{n}', list.length)).replace('{d}', length);
}

function queueHead(title, info, auto) {
  const h = div('qsec' + (auto ? ' auto' : ''));
  h.append(div('', title), div('', info));
  return h;
}

// What autoplay added has top < 0 (and cannot be dragged either).
function queueSections(rows) {
  const at = rows.findIndex((q) => q.selected);
  if (at < 0) return rows.map(queueRow);
  const now = div('q-now');
  now.append(queueRow(rows[at], at));
  const after = rows.map((q, i) => [q, i]).slice(at + 1);
  const own = after.filter(([q]) => q.top >= 0);
  const auto = after.filter(([q]) => q.top < 0);
  const out = [now];
  if (own.length) out.push(queueHead(T.queue, queueInfo(own.map(([q]) => q))), ...own.map(([q, i]) => queueRow(q, i)));
  if (auto.length) {
    out.push(queueHead(T.autoplay, '', true));
    for (const [q, i] of auto) {
      const el = queueRow(q, i);
      el.classList.add('auto');
      out.push(el);
    }
  }
  // What has played goes below, so the playing track stays on top however long the session runs.
  const before = rows.slice(0, at);
  if (before.length) {
    out.push(queueHead(T.played, '', true));
    before.forEach((q, i) => {
      const el = queueRow(q, i);
      el.classList.add('auto');
      out.push(el);
    });
  }
  return out;
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

// One request per key, the last 20 kept. A failed one (page still loading, offline) is tried again next time.
function cached(map, key, load) {
  if (!map.has(key)) {
    const p = load().catch(() => null);
    map.set(key, p);
    p.then((v) => !v && map.delete(key));
    if (map.size > 20) map.delete(map.keys().next().value);
  }
  return map.get(key);
}

// Lyrics are shared by the panel and the big view.
const lyricsCache = new Map();
const lyricsFor = (id) => (id ? cached(lyricsCache, id, () => api.lyrics(id)) : Promise.resolve(null));

const playingId = () => (track && !track.ad ? track.videoId : null);

// Timed lyrics from LRCLIB, one request per track; no lines when it has none, null when it failed or the setting is off.
const syncedCache = new Map();
// Keyed by title and length too: the first reports after a track change can still carry
// the old ones, and their answer (another song, or none for the wrong length) would stick.
const syncedFor = (t) =>
  !t || t.ad || !t.videoId || !(t.duration > 0)
    ? Promise.resolve(null)
    : cached(syncedCache, [t.videoId, t.title, t.artist, Math.round(t.duration)].join('\n'), () =>
        api.syncedLyrics({ title: t.title, artist: t.artist, duration: t.duration })
      );

// YouTube's text as soon as it is there, LRCLIB's timed lines over it when they come.
// draw gets (plain, null), then (null, synced); never the text after the lines.
function lyricsNow(id, draw, tries = 3) {
  let timed = false;
  const current = (fn) => (v) => playingId() === id && fn(v);
  lyricsFor(id).then(
    current((plain) => {
      if (timed) return;
      draw(plain, null);
      // null is a request that failed (page still loading, offline), not a track without lyrics.
      if (!plain && tries) setTimeout(current(() => !timed && lyricsNow(id, draw, tries - 1)), 4000);
    })
  );
  syncedFor(track).then(current((s) => s && s.lines.length && ((timed = true), draw(null, s))));
}

// Timed lines as paragraphs; a click on one plays from there.
function drawSynced(box, scroller, lines) {
  box.classList.add('synced');
  box.replaceChildren(
    ...lines.map((l) => {
      const p = document.createElement('p');
      if (l.text) p.textContent = l.text;
      else {
        p.className = 'gap';
        p.append(document.createElement('i'), document.createElement('i'), document.createElement('i'));
      }
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

// Marks the line being sung and keeps it 40 % down the view, unless the user just scrolled.
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
  const top = s.scrollTop + el.getBoundingClientRect().top - s.getBoundingClientRect().top - s.clientHeight * 0.4;
  s.scrollTo({ top: Math.max(0, top), behavior: reduceMotion.matches ? 'auto' : 'smooth' });
}
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');

setInterval(() => {
  if (slot === 'stage') followLyrics($('stage-lyrics'));
  if (!$('queue').hidden && panelTab === 'lyrics') followLyrics($('lyrics'));
}, 250);

// A wheel or a drag on the lyrics pauses following for a few seconds.
for (const s of [$('lyrics-pane'), $('stage-lyrics')]) {
  for (const ev of ['wheel', 'touchmove']) s.addEventListener(ev, () => (s.userScroll = Date.now() + 4000), { passive: true });
}

function loadLyrics() {
  const id = playingId();
  $('lyrics-source').textContent = '';
  drawPlain($('lyrics'), id ? T.loading : T.noLyrics);
  if (!id) return;
  lyricsNow(id, (plain, synced) => {
    if (panelTab !== 'lyrics') return;
    if (synced) drawSynced($('lyrics'), $('lyrics-pane'), synced.lines);
    else drawPlain($('lyrics'), plain && plain.text ? plain.text : T.noLyrics);
    $('lyrics-source').textContent = synced ? T.lyricsFrom + synced.source : (plain && plain.source) || '';
    $('lyrics-pane').scrollTop = 0;
  });
}

function drawNow() {
  // Nothing playing: the title says so, no empty cover or buttons.
  for (const el of ['np-art', 'np-like', 'np-more']) $(el).hidden = !track;
  loadQueue();
  drawArtistCard();
}

function showTab(tab) {
  // The big view shows the track and its lyrics already, so its panel is the queue alone.
  if (slot !== 'stage') chosenTab = tab;
  tab = panelTab = slot === 'stage' ? 'queue' : tab;
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

// The big view takes the whole width: the library folds while it is open, unless unfolded
// by hand meanwhile.
let stageFold = true;

function updateRail() {
  const auto = innerWidth < 1100 || (!$('queue').hidden && innerWidth < 1400);
  const rail = slot === 'stage' ? stageFold : railPref === 'folded' || (railPref === 'auto' && auto);
  document.body.classList.toggle('rail', rail);
  const b = $('side-toggle');
  b.setAttribute('aria-expanded', String(!rail));
  b.title = rail ? T.expandLib : T.collapseLib;
  b.setAttribute('aria-label', b.title);
}
addEventListener('resize', updateRail);

$('side-toggle').addEventListener('click', () => {
  if (slot === 'stage') {
    stageFold = !document.body.classList.contains('rail');
    return updateRail();
  }
  railPref = document.body.classList.contains('rail') ? 'unfolded' : 'folded';
  try {
    localStorage.setItem('rail', railPref);
  } catch {}
  updateRail();
});

const savePanel = () => {
  updateRail();
  try {
    localStorage.setItem('panel', $('queue').hidden ? '' : chosenTab);
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

// The player is a native view and draws over everything of ours, so a menu or
// dialog that would lie under it hides it meanwhile.
// Toasts and tooltips stay out, a video blanking for each of them is worse than a notice behind it.
const OVERLAYS = [...document.querySelectorAll('#menu, #submenu, dialog')];
const covers = (r) =>
  OVERLAYS.some((el) => {
    if (el.hidden || (el.tagName === 'DIALOG' && !el.open)) return false;
    const o = el.getBoundingClientRect();
    return o.width > 0 && o.left < r.right && o.right > r.left && o.top < r.bottom && o.bottom > r.top;
  });

// Called on every track report and resize; only a change goes to main.
let placedAs = '';
function placePlayer() {
  const el = slotElement();
  const r = el && el.getBoundingClientRect();
  const args = el ? [slot, { x: r.x, y: r.y, width: r.width, height: r.height }, covers(r)] : [null, null, false];
  const key = JSON.stringify(args);
  if (key === placedAs) return;
  placedAs = key;
  api.playerView(...args);
}
const overlayWatch = new MutationObserver(placePlayer);
for (const el of OVERLAYS) overlayWatch.observe(el, { attributes: true, attributeFilter: ['hidden', 'open', 'style'] });

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
  document.body.classList.toggle('staged', slot === 'stage');
  stageFold = true;
  updateRail();
  $('stage-toggle').setAttribute('aria-pressed', String(slot === 'stage'));
  if (!$('queue').hidden) showTab(chosenTab);
  if (slot === 'stage') {
    drawStage();
    fitVideo();
  }
  placePlayer();
}

// Where the music was started, over the big view; a click goes back there.
function originTitle(o) {
  return o.kind === 'search' ? T.searchOrigin.replace('{q}', () => o.query) : (o.page && o.page.header && o.page.header.title) || o.title;
}

function drawOrigin() {
  const l = $('stage-label');
  const o = playOrigin;
  l.classList.toggle('from', !!o);
  l.disabled = !o;
  if (!o) return (l.textContent = T.playingNow);
  const small = document.createElement('small');
  small.textContent = T.startedFrom;
  const b = document.createElement('b');
  b.textContent = originTitle(o);
  l.replaceChildren(small, b);
}

$('stage-label').addEventListener('click', () => {
  const o = playOrigin;
  if (!o) return;
  if (o === view) toggleStage(false);
  else go(o);
});

// A card on the playing track's first artist: photo, listeners and subscribe.
const artistPages = new Map();
let artistSeq = 0;
async function drawArtistCard() {
  const box = $('np-artist-card');
  const a = nowArtists && nowArtists.artists[0];
  // Any newer call wins, so a browse still in flight for the last track's artist is dropped.
  const seq = ++artistSeq;
  if (!a) return (box.hidden = true);
  if ($('queue').hidden || panelTab !== 'now') return;
  const page = await cached(artistPages, a.browseId, () => api.browse(a.browseId));
  if (seq !== artistSeq) return;
  const h = page && page.header;
  box.hidden = !h || h.kind !== 'artist';
  if (box.hidden) return;
  const photo = box.querySelector('.ac-photo');
  photo.style.backgroundImage = cssUrl(h.thumb);
  photo.querySelector('b').textContent = h.title;
  const foot = box.querySelector('.ac-foot');
  const sub = page.subscribe && signedIn !== null ? subscribeButton(page.subscribe) : '';
  foot.replaceChildren(div('sub', h.subtitle), sub);
  box.onclick = () => openPage(h.title, a.browseId);
}
$('np-artist-card').addEventListener('keydown', (e) => e.key === 'Enter' && e.target === e.currentTarget && e.currentTarget.click());

// The big view's own lyrics, beside the cover.
function drawStage() {
  drawOrigin();
  const id = playingId();
  const box = $('stage-lyrics');
  box.classList.add('none');
  drawPlain(box, id ? T.loading : '');
  if (!id) return;
  lyricsNow(id, (plain, synced) => {
    box.classList.toggle('none', !synced && !(plain && plain.text));
    if (synced) drawSynced(box, box, synced.lines);
    else drawPlain(box, plain && plain.text ? plain.text : T.noLyrics);
    box.scrollTop = 0;
  });
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
// The length settles a moment after the track, and the timed lyrics are picked by it.
function lengthChanged() {
  if (!$('queue').hidden && panelTab === 'lyrics' && !$('lyrics').lines) loadLyrics();
  if (slot === 'stage' && !$('stage-lyrics').lines) drawStage();
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
  openMenu(menuEntries(item), x, y);
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
// Next to the stage the panel only has the queue; asked for that, the button can also close it.
$('lyrics-toggle').addEventListener('click', () => toggleQueue(undefined, slot === 'stage' ? 'queue' : 'lyrics'));
$('queue-close').addEventListener('click', () => toggleQueue(false));
// Everything the list shows, autoplay suggestions included.
$('queue-save').addEventListener('click', () => saveToPlaylist(queueRows.map((q) => q.videoId)));
for (const t of ['now', 'queue', 'lyrics']) $('tab-' + t).addEventListener('click', () => showTab(t));
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
