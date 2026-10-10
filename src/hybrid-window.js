'use strict';

// Our own UI in front of the YouTube Music window, which stays hidden and only plays.

const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const mainWindow = require('./main-window');
const player = require('./player');
const store = require('./store');
const pure = require('./pure');

const { APP_TITLE, keyAction, parseItems, BROWSE_ID } = pure;

const ROOT = path.join(__dirname, '..');
const DEFAULT_SIZE = { width: 1100, height: 760 };

let win = null;
let actions = null;
let saveTimer = null;
let playerWc = null;

// The player page finished loading YouTube Music itself, after a consent or
// sign-in page for instance; a view that failed meanwhile can try again.
function onPlayerLoad() {
  if (alive() && playerWc && new URL(playerWc.getURL()).hostname === 'music.youtube.com') {
    win.webContents.send('hybrid:player-ready');
  }
}

const alive = () => !!win && !win.isDestroyed();
const fromUs = (e) => alive() && e.sender === win.webContents;

// The UI asks right at startup, while the hidden page is still loading.
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

// Runs in the hidden page, which already holds the login and the client config.
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
const ACTIONS = {
  shuffle: "bar.querySelector('.shuffle').click()",
  repeat: "bar.querySelector('.repeat').click()",
  mute: "bar.querySelector('.volume').click()",
  like: "bar.querySelectorAll('#like-button-renderer button')[0].click()",
  dislike: "bar.querySelectorAll('#like-button-renderer button')[1].click()",
  volume: (v) =>
    "{ const s = bar.querySelector('#volume-slider'); s.value = " +
    v +
    "; s.dispatchEvent(new CustomEvent('change', { bubbles: true, composed: true })); }",
};

const readControls = () => inPage(CONTROLS).then(pure.sanitizeControls);

// Artist and album links under the title in the page's own player bar.
const NOW_LINKS =
  "[...document.querySelectorAll('ytmusic-player-bar .byline a')]" +
  ".map((a) => ({ text: a.textContent, href: a.getAttribute('href') }))";

// Rows as the page shows them. A track with a music video sits in a wrapper with
// both versions, and the one not chosen by the song/video switch is under [hidden].
const ROWS =
  "[...document.querySelectorAll('ytmusic-player-queue ytmusic-player-queue-item')]" +
  ".filter((el) => !el.closest('ytmusic-playlist-panel-video-wrapper-renderer > [hidden]'))";

// The queue as the page renders it; long queues load further rows as they play.
const QUEUE =
  ROWS +
  '.map((el) => {' +
  " const d = el.data || {}; const t = (x) => ((x && x.runs) || []).map((r) => r.text).join('');" +
  ' const th = (d.thumbnail && d.thumbnail.thumbnails) || [];' +
  ' const pic = th.find((x) => x.width >= 96) || th[th.length - 1];' +
  ' return { videoId: d.videoId, title: t(d.title), artist: t(d.shortBylineText || d.longBylineText),' +
  " length: t(d.lengthText), thumb: pic ? pic.url : '', selected: el.hasAttribute('selected') }; })";

// "Play next" and "add to queue". The page's own command for this only shows a
// toast in a hidden window and leaves the queue as it was, so the items are
// fetched the way the page does and put into its queue store directly.
// ponytail: internal store action of the page; breaks if YouTube renames ADD_ITEMS.
const QUEUE_POSITIONS = ['INSERT_AFTER_CURRENT_VIDEO', 'INSERT_AT_END'];
const queueAdd = (target, position) =>
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

// Size and maximised state survive a restart. Wayland ignores the position, X11 restores it.
function loadBounds() {
  const b = store.settings.hybridBounds;
  if (b && Number.isInteger(b.width) && Number.isInteger(b.height)) return b;
  return { ...DEFAULT_SIZE };
}

function saveBounds() {
  clearTimeout(saveTimer);
  if (!alive() || !win.isVisible() || win.isMinimized()) return;
  store.settings.hybridBounds = { ...win.getNormalBounds(), maximized: win.isMaximized() };
  store.saveSettings();
}

// resize and move fire continuously while dragging, and the write is synchronous.
function scheduleSaveBounds() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveBounds, 400);
}

function create({ openMini, canHide }) {
  actions = { openMini };
  const b = loadBounds();
  win = new BrowserWindow({
    x: b.x,
    y: b.y,
    width: b.width,
    height: b.height,
    minWidth: 480,
    minHeight: 400,
    backgroundColor: '#030303',
    // Window buttons live in the page header (hybrid/index.html).
    frame: false,
    title: APP_TITLE,
    icon: path.join(ROOT, 'icon.png'),
    webPreferences: {
      preload: path.join(ROOT, 'hybrid', 'preload.js'),
    },
  });
  if (b.maximized) win.maximize();
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(ROOT, 'hybrid', 'index.html'));

  // A file dropped on the window would otherwise replace the UI and inherit its preload.
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  win.webContents.on('before-input-event', (e, input) => {
    const action = keyAction(input);
    if (action === 'quit') app.quit();
    else if (action === 'mini') openMini();
    else if (action === 'reload') win.webContents.reload();
    else return;
    e.preventDefault();
  });

  const sendMax = () => alive() && win.webContents.send('hybrid:maximized', win.isMaximized());
  win.on('maximize', sendMax);
  win.on('unmaximize', sendMax);
  win.webContents.on('did-finish-load', sendMax);
  for (const ev of ['resize', 'move', 'maximize', 'unmaximize']) win.on(ev, scheduleSaveBounds);

  // The page only reports the track while this window can show it.
  for (const ev of ['show', 'hide', 'minimize', 'restore']) win.on(ev, () => player.sync());

  playerWc = mainWindow.webContents();
  if (playerWc) playerWc.on('dom-ready', onPlayerLoad);

  // Without a tray, hiding would leave the app running with both windows invisible.
  win.on('close', (e) => {
    saveBounds();
    if (!canHide()) return app.quit();
    e.preventDefault();
    win.hide();
  });
}

function show() {
  if (!alive()) return;
  win.show();
  win.focus();
}

// The player window goes too, in case "Open YouTube Music" left it out.
function hide() {
  if (alive()) win.hide();
  mainWindow.hide();
}

function destroy() {
  if (playerWc && !playerWc.isDestroyed()) playerWc.removeListener('dom-ready', onPlayerLoad);
  playerWc = null;
  if (alive()) win.destroy();
  win = null;
}

const EMPTY_PAGE = { items: [], sections: [], shuffle: null, next: null };

ipcMain.handle('hybrid:browse', (e, id) => {
  if (!fromUs(e) || typeof id !== 'string' || !BROWSE_ID.test(id)) return EMPTY_PAGE;
  return innertube('/browse', { browseId: id }).then(parseItems);
});

ipcMain.handle('hybrid:search', (e, query) => {
  if (!fromUs(e) || typeof query !== 'string' || !query.trim()) return EMPTY_PAGE;
  return innertube('/search', { query: query.trim().slice(0, 200) }).then(parseItems);
});

// The next page of a long list. Search continues on its own endpoint.
ipcMain.handle('hybrid:more', (e, kind, token) => {
  if (!fromUs(e) || !['browse', 'search'].includes(kind)) return EMPTY_PAGE;
  if (typeof token !== 'string' || !pure.CONTINUATION.test(token)) return EMPTY_PAGE;
  return innertube('/' + kind, { continuation: token }).then(parseItems);
});

ipcMain.handle('hybrid:suggest', (e, input) => {
  if (!fromUs(e) || typeof input !== 'string' || !input.trim()) return [];
  return innertube('/music/get_search_suggestions', { input: input.slice(0, 200) }).then(pure.parseSuggestions);
});

ipcMain.handle('hybrid:navigate', (e, raw) => {
  const endpoint = pure.sanitizeEndpoint(raw);
  if (fromUs(e) && endpoint) return navigate(endpoint);
});

ipcMain.handle('hybrid:lyrics', async (e, videoId) => {
  if (!fromUs(e) || !pure.sanitizeWatch({ videoId })) return null;
  const id = pure.lyricsBrowseId(await innertube('/next', { videoId }));
  return id ? pure.parseLyrics(await innertube('/browse', { browseId: id })) : { text: '', source: '' };
});

// Resolves to how many items went in; with nothing playing yet the target just starts.
ipcMain.handle('hybrid:queue-add', async (e, raw, position) => {
  const target = pure.sanitizeQueueTarget(raw);
  if (!fromUs(e) || !target || !QUEUE_POSITIONS.includes(position)) return 0;
  const added = await inPage(queueAdd(target, position));
  if (added) return added;
  await navigate(
    target.videoId ? { watchEndpoint: { videoId: target.videoId } } : { watchPlaylistEndpoint: { playlistId: target.playlistId } }
  );
  return -1;
});

// Needs a signed-in account; YouTube answers with an error otherwise.
ipcMain.handle('hybrid:playlists', (e, videoId) => {
  if (!fromUs(e) || !pure.sanitizeWatch({ videoId })) return [];
  return innertube('/playlist/get_add_to_playlist', { videoIds: [videoId] }).then(pure.parsePlaylistOptions);
});

ipcMain.handle('hybrid:playlist-add', async (e, playlistId, videoId) => {
  const target = pure.sanitizeQueueTarget({ playlistId });
  if (!fromUs(e) || !target || !pure.sanitizeWatch({ videoId })) return false;
  const res = await innertube('/browse/edit_playlist', {
    playlistId: target.playlistId,
    actions: [{ action: 'ACTION_ADD_VIDEO', addedVideoId: videoId }],
  });
  return !!res && res.status === 'STATUS_SUCCEEDED';
});

ipcMain.handle('hybrid:now-links', (e) => (fromUs(e) ? inPage(NOW_LINKS).then(pure.sanitizeLinks) : []));

ipcMain.handle('hybrid:controls', (e) => (fromUs(e) ? readControls() : null));

ipcMain.handle('hybrid:control', async (e, action, arg) => {
  if (!fromUs(e) || !Object.hasOwn(ACTIONS, action)) return null;
  let code = ACTIONS[action];
  if (action === 'volume') {
    if (typeof arg !== 'number' || !Number.isFinite(arg)) return null;
    code = code(Math.min(100, Math.max(0, Math.round(arg))));
  }
  await inPage('{ const bar = ' + BAR + '; ' + code + '; }');
  // The bar updates its own state a tick after the click.
  await new Promise((ok) => setTimeout(ok, 250));
  return readControls();
});

ipcMain.handle('hybrid:queue', (e) => (fromUs(e) ? inPage(QUEUE).then(pure.sanitizeQueue) : []));

// The row's own play button jumps inside the current queue and keeps its order,
// which a fresh navigation to the track would rebuild.
ipcMain.handle('hybrid:queue-play', (e, index, videoId) => {
  if (!fromUs(e) || !Number.isInteger(index) || index < 0 || !pure.sanitizeWatch({ videoId })) return;
  return inPage(
    '(() => { const rows = ' +
      ROWS +
      ';' +
      ' const id = ' +
      JSON.stringify(videoId) +
      '; let row = rows[' +
      index +
      '];' +
      ' if (!row || !row.data || row.data.videoId !== id) row = rows.find((r) => r.data && r.data.videoId === id);' +
      " if (row) row.querySelector('#play-button').click(); })()"
  ).then(() => undefined);
});

ipcMain.on('hybrid:window', (e, action) => {
  if (!fromUs(e)) return;
  if (action === 'mini') actions.openMini();
  else if (action === 'minimize') win.minimize();
  else if (action === 'close') win.close();
  else if (action === 'maximize') {
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
  }
});

// Sign-in, consent and anything the UI does not cover yet happen in the real page.
ipcMain.on('hybrid:show-player', (e) => {
  if (fromUs(e)) mainWindow.show();
});

module.exports = {
  create,
  show,
  hide,
  destroy,
  saveBounds,
  isShown: () => alive() && win.isVisible() && !win.isMinimized(),
  webContents: () => (alive() ? win.webContents : null),
};
