'use strict';

// Our own UI in front of the YouTube Music window, which stays hidden and only plays.

const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const mainWindow = require('./main-window');
const player = require('./player');
const store = require('./store');
const page = require('./page');
const sleep = require('./sleep');
const lastfm = require('./lastfm');
const pure = require('./pure');

const { APP_TITLE, keyAction, parseItems, BROWSE_ID } = pure;

const ROOT = path.join(__dirname, '..');
const DEFAULT_SIZE = { width: 1100, height: 760 };
// What the UI may do through the player bar; MPRIS has its own set-to-state actions.
const UI_ACTIONS = ['shuffle', 'repeat', 'mute', 'like', 'dislike', 'volume', 'avSong', 'avVideo', 'skipAd'];
const SLEEP_CHOICES = ['off', 'track', 15, 30, 45, 60, 90];

let win = null;
let actions = null;
let saveTimer = null;
let playerWc = null;

const alive = () => !!win && !win.isDestroyed();
const fromUs = (e) => alive() && e.sender === win.webContents;

// The player page finished loading YouTube Music itself, after a consent or
// sign-in page for instance; a view that failed meanwhile can try again.
function onPlayerLoad() {
  if (alive() && playerWc && new URL(playerWc.getURL()).hostname === 'music.youtube.com') {
    win.webContents.send('hybrid:player-ready');
  }
}

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

function create(opts) {
  actions = opts;
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
    else if (action === 'mini') opts.openMini();
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
    if (!opts.canHide()) return app.quit();
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

function settings() {
  return {
    language: store.settings.language || 'system',
    notify: store.settings.notify === true,
    richPresence: player.discordEnabled(),
    discordAvailable: player.discordAvailable,
    sleep: sleep.state(),
    lastfm: lastfm.state(),
  };
}

const EMPTY_PAGE = { items: [], sections: [], shuffle: null, next: null };

ipcMain.handle('hybrid:browse', (e, id) => {
  if (!fromUs(e) || typeof id !== 'string' || !BROWSE_ID.test(id)) return EMPTY_PAGE;
  return page.innertube('/browse', { browseId: id }).then(parseItems);
});

ipcMain.handle('hybrid:search', (e, query) => {
  if (!fromUs(e) || typeof query !== 'string' || !query.trim()) return EMPTY_PAGE;
  return page.innertube('/search', { query: query.trim().slice(0, 200) }).then(parseItems);
});

// The next page of a long list. Search continues on its own endpoint.
ipcMain.handle('hybrid:more', (e, kind, token) => {
  if (!fromUs(e) || !['browse', 'search'].includes(kind)) return EMPTY_PAGE;
  if (typeof token !== 'string' || !pure.CONTINUATION.test(token)) return EMPTY_PAGE;
  return page.innertube('/' + kind, { continuation: token }).then(parseItems);
});

ipcMain.handle('hybrid:suggest', (e, input) => {
  if (!fromUs(e) || typeof input !== 'string' || !input.trim()) return [];
  return page.innertube('/music/get_search_suggestions', { input: input.slice(0, 200) }).then(pure.parseSuggestions);
});

ipcMain.handle('hybrid:navigate', (e, raw) => {
  const endpoint = pure.sanitizeEndpoint(raw);
  if (fromUs(e) && endpoint) return page.navigate(endpoint);
});

ipcMain.handle('hybrid:lyrics', async (e, videoId) => {
  if (!fromUs(e) || !pure.sanitizeWatch({ videoId })) return null;
  const id = pure.lyricsBrowseId(await page.innertube('/next', { videoId }));
  return id ? pure.parseLyrics(await page.innertube('/browse', { browseId: id })) : { text: '', source: '' };
});

ipcMain.handle('hybrid:queue-add', (e, raw, position) => {
  const target = pure.sanitizeQueueTarget(raw);
  if (!fromUs(e) || !target || !page.QUEUE_POSITIONS.includes(position)) return 0;
  return page.queueAdd(target, position);
});

ipcMain.handle('hybrid:queue-remove', (e, itemId) => {
  if (fromUs(e) && Number.isInteger(itemId) && itemId >= 0) return page.queueRemove(itemId);
});

ipcMain.handle('hybrid:queue-move', (e, from, to) => {
  if (fromUs(e) && [from, to].every((n) => Number.isInteger(n) && n >= 0)) return page.queueMove(from, to);
});

// Needs a signed-in account; YouTube answers with an error otherwise.
ipcMain.handle('hybrid:playlists', (e, videoId) => {
  if (!fromUs(e) || !pure.sanitizeWatch({ videoId })) return [];
  return page.innertube('/playlist/get_add_to_playlist', { videoIds: [videoId] }).then(pure.parsePlaylistOptions);
});

ipcMain.handle('hybrid:playlist-add', async (e, playlistId, videoId) => {
  const target = pure.sanitizeQueueTarget({ playlistId });
  if (!fromUs(e) || !target || !pure.sanitizeWatch({ videoId })) return false;
  const res = await page.innertube('/browse/edit_playlist', {
    playlistId: target.playlistId,
    actions: [{ action: 'ACTION_ADD_VIDEO', addedVideoId: videoId }],
  });
  return !!res && res.status === 'STATUS_SUCCEEDED';
});

ipcMain.handle('hybrid:now-links', (e) => (fromUs(e) ? page.nowLinks() : []));

ipcMain.handle('hybrid:controls', (e) => (fromUs(e) ? page.readControls() : null));

ipcMain.handle('hybrid:control', (e, action, arg) => {
  if (fromUs(e) && UI_ACTIONS.includes(action)) return page.control(action, arg);
  return null;
});

ipcMain.handle('hybrid:queue', (e) => (fromUs(e) ? page.queue() : []));

ipcMain.handle('hybrid:queue-play', (e, index, videoId) => {
  if (!fromUs(e) || !Number.isInteger(index) || index < 0 || !pure.sanitizeWatch({ videoId })) return;
  return page.queuePlay(index, videoId);
});

ipcMain.handle('hybrid:settings', (e) => (fromUs(e) ? settings() : null));

ipcMain.handle('hybrid:setting', (e, key, value) => {
  if (!fromUs(e)) return null;
  if (key === 'language' && ['system', 'de', 'en'].includes(value)) actions.setLanguage(value);
  else if (key === 'notify' && typeof value === 'boolean') {
    store.settings.notify = value;
    store.saveSettings();
    player.sync();
  } else if (key === 'richPresence' && typeof value === 'boolean') player.setDiscord(value);
  else if (key === 'hybrid' && value === false) setImmediate(() => actions.setHybrid(false));
  else if (key === 'sleep' && SLEEP_CHOICES.includes(value)) sleep.set(value);
  return settings();
});

ipcMain.handle('hybrid:lastfm-connect', async (e, key, secret) => {
  if (!fromUs(e)) return null;
  await lastfm.connect(key, secret);
  return settings();
});

ipcMain.handle('hybrid:lastfm-finish', async (e) => {
  if (!fromUs(e)) return null;
  await lastfm.finish();
  return settings();
});

ipcMain.handle('hybrid:lastfm-disconnect', (e) => {
  if (!fromUs(e)) return null;
  lastfm.disconnect();
  return settings();
});

// Fixed address; the page never hands main a URL to open.
ipcMain.on('hybrid:lastfm-account', (e) => {
  if (fromUs(e)) shell.openExternal('https://www.last.fm/api/account/create');
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
  reload: () => alive() && win.webContents.reload(),
  isShown: () => alive() && win.isVisible() && !win.isMinimized(),
  isFocused: () => alive() && win.isFocused(),
  webContents: () => (alive() ? win.webContents : null),
};
