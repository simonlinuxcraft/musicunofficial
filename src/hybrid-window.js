'use strict';

// Our own UI. The YouTube Music page plays in a view inside this window (src/main-window.js).

const { app, BrowserWindow, ipcMain, screen, shell } = require('electron');
const path = require('path');
const mainWindow = require('./main-window');
const player = require('./player');
const store = require('./store');
const page = require('./page');
const sleep = require('./sleep');
const lastfm = require('./lastfm');
const pure = require('./pure');
const { bindKeys } = require('./keys');

const { APP_TITLE, parseItems, BROWSE_ID } = pure;

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

// YouTube Music's own sign-in link, which comes back to its start page.
const SIGN_IN =
  'https://accounts.google.com/ServiceLogin?ltmpl=music&service=youtube&uilel=3&passive=true&continue=' +
  encodeURIComponent('https://www.youtube.com/signin?action_handle_signin=true&app=desktop&next=https%3A%2F%2Fmusic.youtube.com%2F');

// On a consent or sign-in page instead of YouTube Music: the UI shows it until the site is back.
let playerAway = false;

function onPlayerNavigate(e, url) {
  playerAway = !pure.onSite(url);
  if (playerAway && alive()) win.webContents.send('hybrid:player-away');
}

// The player page finished loading YouTube Music itself; a view that failed meanwhile can try again.
function onPlayerLoad() {
  if (alive() && !playerAway) win.webContents.send('hybrid:player-ready');
}

// Size and maximised state survive a restart. Wayland ignores the position, X11 restores it.
function loadBounds() {
  // window-state.json is where the YouTube Music window kept them before this UI.
  const b = store.settings.hybridBounds || store.read('window-state.json');
  if (!b || !Number.isInteger(b.width) || !Number.isInteger(b.height)) return { ...DEFAULT_SIZE };
  // A spot on a display that is gone is dropped; the size stays.
  const placed = Number.isInteger(b.x) && Number.isInteger(b.y) && pure.onDisplays(b, screen.getAllDisplays().map((d) => d.workArea));
  return placed ? b : { width: b.width, height: b.height, maximized: b.maximized };
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

  bindKeys(win.webContents, 'uiZoom', opts.openMini);

  const sendMax = () => alive() && win.webContents.send('hybrid:maximized', win.isMaximized());
  win.on('maximize', sendMax);
  win.on('unmaximize', sendMax);
  win.webContents.on('did-finish-load', sendMax);
  // The page may have reached a consent page before this UI finished loading.
  win.webContents.on('did-finish-load', () => playerAway && win.webContents.send('hybrid:player-away'));
  for (const ev of ['resize', 'move', 'maximize', 'unmaximize']) win.on(ev, scheduleSaveBounds);

  // The page only reports the track while this window can show it.
  for (const ev of ['show', 'hide', 'minimize', 'restore']) win.on(ev, () => player.sync());

  mainWindow.attach(win);
  playerWc = mainWindow.webContents();
  if (playerWc) {
    playerWc.on('dom-ready', onPlayerLoad);
    playerWc.on('did-navigate', onPlayerNavigate);
  }

  // Without a tray, hiding would leave the app running with both windows invisible.
  win.on('close', (e) => {
    saveBounds();
    e.preventDefault();
    opts.canHide().then((hide) => {
      if (!alive()) return;
      if (hide) win.hide();
      else app.quit();
    });
  });
}

function show() {
  if (!alive()) return;
  win.show();
  win.focus();
}

function hide() {
  if (alive()) win.hide();
}

function destroy() {
  if (playerWc && !playerWc.isDestroyed()) {
    playerWc.removeListener('dom-ready', onPlayerLoad);
    playerWc.removeListener('did-navigate', onPlayerNavigate);
  }
  playerWc = null;
  if (alive()) win.destroy();
  win = null;
}

function settings() {
  return {
    language: store.settings.language || 'system',
    notify: store.settings.notify === true,
    richPresence: player.discordEnabled(),
    videoQuality: store.settings.videoQuality || 'auto',
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
  else if (key === 'videoQuality' && page.QUALITIES.includes(value)) {
    store.settings.videoQuality = value;
    store.saveSettings();
    page.setQuality(value).catch(() => {});
  } else if (key === 'notify' && typeof value === 'boolean') {
    store.settings.notify = value;
    store.saveSettings();
    player.sync();
  } else if (key === 'richPresence' && typeof value === 'boolean') player.setDiscord(value);
  else if (key === 'sleep' && SLEEP_CHOICES.includes(value)) {
    sleep.set(value);
    player.sync();
  }
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
  player.sync();
  return settings();
});

ipcMain.handle('hybrid:lastfm-disconnect', (e) => {
  if (!fromUs(e)) return null;
  lastfm.disconnect();
  player.sync();
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

// null while the page cannot tell, so the UI shows no sign-in button by mistake.
ipcMain.handle('hybrid:signed-in', async (e) => {
  if (!fromUs(e) || playerAway) return null;
  const v = await page.signedIn();
  return typeof v === 'boolean' ? v : null;
});

ipcMain.on('hybrid:sign-in', (e) => {
  if (fromUs(e) && playerWc && !playerWc.isDestroyed()) playerWc.loadURL(SIGN_IN);
});

// Where the page measured a slot for the player view, in CSS pixels of its own zoom.
ipcMain.on('hybrid:player-view', (e, kind, r) => {
  if (!fromUs(e)) return;
  const ok = ['stage', 'page'].includes(kind) && r && ['x', 'y', 'width', 'height'].every((k) => Number.isFinite(r[k]));
  const z = win.webContents.getZoomFactor();
  const px = (v) => Math.max(0, Math.round(v * z));
  mainWindow.place(ok ? kind : null, ok ? { x: px(r.x), y: px(r.y), width: px(r.width), height: px(r.height) } : null);
});

// The player stores the quality only while a track is loaded, so each new track gets it again.
let qualityFor = null;
function onTrack(t) {
  if (!t || t.ad || !t.videoId || t.videoId === qualityFor) return;
  qualityFor = t.videoId;
  page.setQuality(store.settings.videoQuality || 'auto').catch(() => {});
}

module.exports = {
  create,
  onTrack,
  show,
  hide,
  destroy,
  saveBounds,
  reload: () => alive() && win.webContents.reload(),
  isShown: () => alive() && win.isVisible() && !win.isMinimized(),
  isFocused: () => alive() && win.isFocused(),
  webContents: () => (alive() ? win.webContents : null),
};
