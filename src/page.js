'use strict';

// Talking to the YouTube Music page in the player window: its own InnerTube
// client, its navigation, its player bar and its queue. Used by the hybrid UI
// and by MPRIS, which also runs in the normal mode.

const mainWindow = require('./main-window');
const pure = require('./pure');

// The first request comes right at startup, while the page is still loading.
const READY =
  'new Promise((ok, no) => { const t0 = Date.now(); (function poll() {' +
  " const a = document.querySelector('ytmusic-app');" +
  ' if (a && a.networkManager) return ok(a);' +
  " if (Date.now() - t0 > 30000) return no(new Error('YouTube Music did not finish loading'));" +
  ' setTimeout(poll, 200); })(); })';

// A destroyed or navigating page can leave a script promise unsettled, and the UI on "Loading" for good.
const giveUp = (ms) =>
  new Promise((ok, no) => setTimeout(() => no(new Error('YouTube Music did not answer')), ms));

// Whichever of the events comes first; the other listeners go with it.
function firstOf(wc, events, ms) {
  return new Promise((ok, no) => {
    const done = (fn) => {
      clearTimeout(timer);
      for (const ev of events) wc.removeListener(ev, onEvent);
      fn();
    };
    const onEvent = () => done(ok);
    const timer = setTimeout(() => done(() => no(new Error('YouTube Music did not answer'))), ms);
    for (const ev of events) wc.once(ev, onEvent);
  });
}

// Runs in the page, which already holds the login and the client config.
// `code` sees the page's <ytmusic-app> as `app`.
async function inPage(code) {
  const wc = mainWindow.webContents();
  if (!wc) throw new Error('player window is gone');
  // A script sent into the document that is about to be replaced dies with it.
  // dom-ready may already be past while the page still loads, so its end counts too.
  if (wc.isLoadingMainFrame()) await firstOf(wc, ['dom-ready', 'did-stop-loading', 'destroyed'], 35000);
  return Promise.race([wc.mainFrame.executeJavaScript(READY + '.then((app) => ' + code + ')'), giveUp(35000)]);
}

// The page's own network manager signs the request for the logged-in account.
// ponytail: an internal of the page; a plain fetch to /youtubei/v1 with a SAPISIDHASH header if it goes away.
const innertube = (endpoint, body) =>
  inPage('app.networkManager.fetch(' + JSON.stringify(endpoint) + ', ' + JSON.stringify(body) + ')');

// The SPA's own navigation event: switches track in place and builds the queue, no reload.
const navigate = (endpoint) =>
  inPage(
    "app.dispatchEvent(new CustomEvent('yt-navigate', " +
      '{ bubbles: true, composed: true, detail: { endpoint: ' +
      JSON.stringify(endpoint) +
      ' } }))'
  ).then(() => undefined);

// The player bar's own buttons and slider, so YouTube Music keeps its state
// (shuffle order, repeat mode, the saved volume) exactly as if clicked there.
// Classes, not aria labels, which follow the UI language.
// ponytail: DOM of the page; breaks when YouTube renames these classes.
const BAR = "document.querySelector('ytmusic-player-bar')";
const CONTROLS =
  '(() => { const bar = ' +
  BAR +
  "; const lk = bar.querySelector('#like-button-renderer');" +
  ' return { shuffle: !!bar.shuffleOn, repeat: bar.repeatMode,' +
  " like: lk && lk.getAttribute('like-status'), volume: bar.volume, muted: !!bar.isMuted }; })()";
const wait = 'await new Promise((r) => setTimeout(r, 120));';
const ACTIONS = {
  shuffle: () => "bar.querySelector('.shuffle').click();",
  repeat: () => "bar.querySelector('.repeat').click();",
  mute: () => "bar.querySelector('.volume').click();",
  like: () => "bar.querySelectorAll('#like-button-renderer button')[0].click();",
  dislike: () => "bar.querySelectorAll('#like-button-renderer button')[1].click();",
  volume: (v) =>
    "const s = bar.querySelector('#volume-slider'); s.value = " +
    v +
    "; s.dispatchEvent(new CustomEvent('change', { bubbles: true, composed: true }));",
  // MPRIS sets a state rather than toggling; the bar only toggles, so click until it matches.
  repeatTo: (mode) =>
    'for (let i = 0; i < 3 && bar.repeatMode !== ' +
    JSON.stringify(mode) +
    "; i++) { bar.querySelector('.repeat').click(); " +
    wait +
    ' }',
  shuffleTo: (on) => 'if (!!bar.shuffleOn !== ' + !!on + ") bar.querySelector('.shuffle').click();",
  avSong: () => "document.querySelector('ytmusic-av-toggle .song-button').click();",
  avVideo: () => "document.querySelector('ytmusic-av-toggle .video-button').click();",
  // Only YouTube's own skip button, which it shows once an ad may be skipped.
  skipAd: () =>
    "const b = document.querySelector('.ytp-skip-ad-button, .ytp-ad-skip-button-modern, .ytp-ad-skip-button'); if (b) b.click();",
};

// Arguments are checked here because the code is spliced into the page as text.
function actionArg(action, arg) {
  if (action === 'volume') return typeof arg === 'number' && Number.isFinite(arg) ? Math.min(100, Math.max(0, Math.round(arg))) : null;
  if (action === 'repeatTo') return ['NONE', 'ALL', 'ONE'].includes(arg) ? arg : null;
  if (action === 'shuffleTo') return typeof arg === 'boolean' ? arg : null;
  return true;
}

const readControls = () => inPage(CONTROLS).then(pure.sanitizeControls);

async function control(action, arg) {
  if (!Object.hasOwn(ACTIONS, action)) return null;
  const value = actionArg(action, arg);
  if (value === null) return null;
  await inPage('(async () => { const bar = ' + BAR + '; ' + ACTIONS[action](value) + ' })()');
  // The bar updates its own state a tick after the click.
  await new Promise((ok) => setTimeout(ok, 250));
  return readControls();
}

// Artist and album links under the title in the page's own player bar.
const NOW_LINKS =
  "[...document.querySelectorAll('ytmusic-player-bar .byline a')]" +
  ".map((a) => ({ text: a.textContent, href: a.getAttribute('href') }))";
const nowLinks = () => inPage(NOW_LINKS).then(pure.sanitizeLinks);

// Rows as the page shows them. A track with a music video sits in a wrapper with
// both versions, and the one not chosen by the song/video switch is under [hidden].
const ROWS =
  "[...document.querySelectorAll('ytmusic-player-queue ytmusic-player-queue-item')]" +
  ".filter((el) => !el.closest('ytmusic-playlist-panel-video-wrapper-renderer > [hidden]'))";

// The queue as the page renders it; long queues load further rows as they play.
// `top` is the row's place in the reorderable list (-1 for autoplay suggestions),
// `itemId` the id the queue removes it by.
const QUEUE =
  ROWS +
  '.map((el) => {' +
  " const d = el.data || {}; const t = (x) => ((x && x.runs) || []).map((r) => r.text).join('');" +
  ' const th = (d.thumbnail && d.thumbnail.thumbnails) || [];' +
  ' const pic = th.find((x) => x.width >= 96) || th[th.length - 1];' +
  " const top = el.closest('#contents > *');" +
  ' const w = d.navigationEndpoint && d.navigationEndpoint.watchEndpoint;' +
  ' return { videoId: d.videoId, title: t(d.title), artist: t(d.shortBylineText || d.longBylineText),' +
  " length: t(d.lengthText), thumb: pic ? pic.url : '', selected: el.hasAttribute('selected')," +
  ' top: top ? [...top.parentElement.children].indexOf(top) : -1, itemId: w ? w.index : null }; })';
const queue = () => inPage(QUEUE).then(pure.sanitizeQueue);

// The row's own play button jumps inside the current queue and keeps its order,
// which a fresh navigation to the track would rebuild.
function queuePlay(index, videoId) {
  return inPage(
    '(() => { const rows = ' +
      ROWS +
      '; const id = ' +
      JSON.stringify(videoId) +
      '; let row = rows[' +
      index +
      '];' +
      ' if (!row || !row.data || row.data.videoId !== id) row = rows.find((r) => r.data && r.data.videoId === id);' +
      " if (row) row.querySelector('#play-button').click(); })()"
  ).then(() => undefined);
}

// The queue's own removal, which also skips on if it is the current track and
// keeps YouTube's server-side copy of the queue in step.
const queueRemove = (itemId) =>
  inPage("document.querySelector('ytmusic-player-queue').queue.removeItem(" + JSON.stringify(String(itemId)) + ')').then(
    () => undefined
  );

// What the page's drag and drop does: move the row in the list, then let the
// queue's drop handler read the new order and pass it on to the server.
const queueMove = (from, to) =>
  inPage(
    "(() => { const qel = document.querySelector('ytmusic-player-queue'); const rows = [...qel.querySelectorAll('#contents > *')];" +
      ' const from = ' +
      from +
      ', to = ' +
      to +
      ';' +
      ' if (!rows[from] || !rows[to] || from === to) return false;' +
      ' const node = rows[from]; node.parentElement.insertBefore(node, from < to ? rows[to].nextSibling : rows[to]);' +
      ' qel.onDrop({ detail: { dragEl: node } }); return true; })()'
  );

// "Play next" and "add to queue". The page's own command for this only shows a
// toast in a hidden window and leaves the queue as it was, so the items are
// fetched the way the page does and put into its queue store directly.
// ponytail: internal store action of the page; breaks if YouTube renames ADD_ITEMS.
const QUEUE_POSITIONS = ['INSERT_AFTER_CURRENT_VIDEO', 'INSERT_AT_END'];
const QUEUE_ADD = (target, position) =>
  '(async () => {' +
  " const q = document.querySelector('ytmusic-player-queue'); const st = q.queue.store.getState().queue;" +
  ' if (!st.items.length) return 0;' +
  ' const res = await app.networkManager.fetch("/music/get_queue", Object.assign({ queueContextParams: st.queueContextParams,' +
  ' queueInsertPosition: ' +
  JSON.stringify(position) +
  ' }, ' +
  JSON.stringify(target.videoId ? { videoIds: [target.videoId] } : { playlistId: target.playlistId }) +
  '));' +
  ' const items = ((res && res.queueDatas) || []).map((d) => d.content).filter(Boolean);' +
  ' const now = q.queue.store.getState().queue;' +
  ' const pick = (it) => it.playlistPanelVideoRenderer || (it.playlistPanelVideoWrapperRenderer && it.playlistPanelVideoWrapperRenderer.primaryRenderer.playlistPanelVideoRenderer) || {};' +
  ' const sel = now.items.findIndex((it) => pick(it).selected);' +
  ' const index = ' +
  JSON.stringify(position) +
  " === 'INSERT_AFTER_CURRENT_VIDEO' && sel >= 0 ? sel + 1 : now.items.length;" +
  " q.dispatch({ type: 'ADD_ITEMS', payload: { nextQueueItemId: now.nextQueueItemId, index, items, shuffleEnabled: false, shouldAssignIds: true } });" +
  ' return items.length; })()';

// Resolves to how many items went in; with nothing playing yet the target just starts.
async function queueAdd(target, position) {
  const added = await inPage(QUEUE_ADD(target, position));
  if (added) return added;
  await navigate(
    target.videoId ? { watchEndpoint: { videoId: target.videoId } } : { watchPlaylistEndpoint: { playlistId: target.playlistId } }
  );
  return -1;
}

// The player keeps the choice itself (localStorage yt-player-quality, about a year), across tracks and reloads.
// ponytail: not reapplied on load; do that if it ever drops back to auto on its own.
const QUALITIES = ['auto', 'hd2160', 'hd1440', 'hd1080', 'hd720', 'large', 'medium', 'tiny'];
const setQuality = (q) =>
  inPage("document.getElementById('movie_player').setPlaybackQualityRange(" + JSON.stringify(q) + ', ' + JSON.stringify(q) + ')');

module.exports = {
  inPage,
  innertube,
  navigate,
  control,
  readControls,
  nowLinks,
  queue,
  queuePlay,
  queueRemove,
  queueMove,
  queueAdd,
  QUEUE_POSITIONS,
  QUALITIES,
  setQuality,
};
