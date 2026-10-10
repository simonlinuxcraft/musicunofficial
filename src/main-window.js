'use strict';

const { app, BrowserWindow, ipcMain, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const store = require('./store');
const player = require('./player');
const { APP_TITLE, isInternal, keyAction } = require('./pure');

const ROOT = path.join(__dirname, '..');
const START_URL = 'https://music.youtube.com/';
const DEFAULT_BOUNDS = { width: 1280, height: 860 };
// YouTube Music's own page background, so the window does not flash while it loads.
const DARK = '#030303';
const inject = (name) => fs.readFileSync(path.join(ROOT, 'inject', name), 'utf8');
const CSS = inject('style.css');
const CONTROLS = inject('controls.js');
const NOWPLAYING = inject('nowplaying.js');
const RESUME = inject('resume.js');

let win = null;
let lastBounds = null;
let saveTimer = null;
// Off in hybrid mode: shown only now and then and never maximised there, it
// would overwrite the size the normal mode restores.
let persist = true;
// Started hidden behind the hybrid UI: the saved maximised state waits for reveal().
let pendingMaximize = false;

const alive = () => !!win && !win.isDestroyed();

function loadBounds() {
  const s = store.read('window-state.json');
  if (s && Number.isInteger(s.width) && Number.isInteger(s.height)) return s;
  return { ...DEFAULT_BOUNDS };
}

// Sampled only while mapped: isMaximized() reads false on a hidden window. The
// last good sample still gets written when quitting from the tray.
function saveBounds() {
  clearTimeout(saveTimer);
  if (!alive() || !persist) return;
  if (win.isVisible() && !win.isMinimized()) {
    lastBounds = { ...win.getNormalBounds(), maximized: win.isMaximized() };
  }
  if (lastBounds) store.write('window-state.json', lastBounds);
}

// resize and move fire continuously while dragging, and the write is synchronous.
function scheduleSaveBounds() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveBounds, 400);
}

// Ids are validated by sanitizeResume; encoded anyway so a format change cannot add parameters.
function watchUrl(r) {
  let u = 'https://music.youtube.com/watch?v=' + encodeURIComponent(r.videoId);
  if (r.list) u += '&list=' + encodeURIComponent(r.list);
  return u;
}

// Through mainFrame: webContents.executeJavaScript holds the code back until the
// page has finished loading, which left the window without controls for 10 s.
function injectAll(wc, resume) {
  const log = (what) => (e) => console.log('[inject] ' + what + ': ' + e.message);
  const run = (code) => wc.mainFrame.executeJavaScript(code);
  wc.insertCSS(CSS).catch(log('css'));
  run(CONTROLS)
    .then(() => alive() && wc.send('window:maximized', win.isMaximized()))
    .catch(log('controls'));
  run(NOWPLAYING).then(player.sync).catch(log('nowplaying'));
  if (resume) {
    run(RESUME.replaceAll('__RESUME_DATA__', () => JSON.stringify(resume)))
      .catch(log('resume'))
      .finally(() => alive() && wc.setAudioMuted(false));
  }
}

function onKey(e, input, openMini) {
  const action = keyAction(input);
  if (!action) return;
  e.preventDefault();
  const wc = win.webContents;
  if (action === 'quit') app.quit();
  else if (action === 'reload') wc.reload();
  else if (action === 'mini') openMini();
  else if (action === 'zoom-in') wc.setZoomLevel(Math.min(wc.getZoomLevel() + 0.5, 5));
  else if (action === 'zoom-out') wc.setZoomLevel(Math.max(wc.getZoomLevel() - 0.5, -5));
  else if (action === 'zoom-reset') wc.setZoomLevel(0);
}

function create({ resume, openMini, canHide, hidden }) {
  persist = !hidden;
  const s = loadBounds();
  pendingMaximize = !!hidden && !!s.maximized;
  win = new BrowserWindow({
    x: s.x,
    y: s.y,
    width: s.width,
    height: s.height,
    minWidth: 480,
    minHeight: 400,
    backgroundColor: DARK,
    show: false,
    // Controls are injected into the page (inject/controls.js); titleBarOverlay looked like a pasted-on black box.
    frame: false,
    title: APP_TITLE,
    icon: path.join(ROOT, 'icon.png'),
    webPreferences: {
      preload: path.join(ROOT, 'preload.js'),
    },
  });
  const wc = win.webContents;

  // Hidden in hybrid mode, where this window is only the player. maximize() would show it.
  if (!hidden) {
    if (s.maximized) win.maximize();
    // At once, not on ready-to-show, which waits for YouTube's first paint.
    win.show();
  }
  win.setMenuBarVisibility(false);

  // The page retitles itself on every navigation, which would churn the task bar.
  win.on('page-title-updated', (e) => e.preventDefault());

  // Muted until resume.js settles, so an ad or autoplay cannot blast sound first.
  // The watch URL pins the exact track by id.
  if (resume) {
    wc.setAudioMuted(true);
    win.loadURL(watchUrl(resume));
  } else {
    win.loadURL(START_URL);
  }

  // dom-ready, not did-finish-load: lands the CSS before Polymer builds the nav bar, so the stock logo never flashes.
  wc.on('dom-ready', () => {
    injectAll(wc, resume);
    // Once only: an SPA navigation fires dom-ready again.
    resume = null;
  });

  // A reload drops the injected poller together with its last track.
  wc.on('did-start-navigation', (e, url, isInPlace, isMainFrame) => {
    if (isMainFrame && !isInPlace) player.setTrack(null);
  });
  wc.on('did-stop-loading', player.sync);

  // Google's consent page sets no background of its own and would show dark text on DARK.
  wc.on('did-navigate', (e, url) => {
    win.setBackgroundColor(new URL(url).hostname === 'music.youtube.com' ? DARK : '#ffffff');
  });

  wc.setWindowOpenHandler(({ url }) => {
    if (isInternal(url)) return { action: 'allow' };
    shell.openExternal(url);
    return { action: 'deny' };
  });

  wc.on('will-navigate', (e, url) => {
    if (isInternal(url)) return;
    e.preventDefault();
    shell.openExternal(url);
  });

  wc.on('before-input-event', (e, input) => onKey(e, input, openMini));

  // A created Tray does not prove the desktop draws it (GNOME dropped GtkStatusIcon),
  // so without one closing really closes and Ctrl+Q stays the way out.
  win.on('close', (e) => {
    saveBounds();
    if (canHide()) {
      e.preventDefault();
      win.hide();
    }
  });

  const sendMaxState = () => alive() && wc.send('window:maximized', win.isMaximized());
  win.on('maximize', sendMaxState);
  win.on('unmaximize', sendMaxState);
  win.on('resize', scheduleSaveBounds);
  win.on('move', scheduleSaveBounds);
}

function show() {
  if (!alive()) return;
  win.show();
  win.focus();
}

function hide() {
  if (alive()) win.hide();
}

// Back to the normal mode: shown the way it was last used there.
function reveal() {
  if (!alive()) return;
  if (pendingMaximize) win.maximize();
  pendingMaximize = false;
  show();
}

// The page's beforeunload handler vetoes close() during playback; destroy() cannot be vetoed.
function destroy() {
  if (alive()) win.destroy();
}

ipcMain.on('window:minimize', () => alive() && win.minimize());
ipcMain.on('window:toggle-maximize', () => {
  if (!alive()) return;
  if (win.isMaximized()) win.unmaximize();
  else win.maximize();
});
ipcMain.on('window:close', () => alive() && win.close());

module.exports = {
  create,
  show,
  hide,
  reveal,
  setPersist: (on) => {
    persist = !!on;
  },
  destroy,
  saveBounds,
  isShown: () => alive() && win.isVisible() && !win.isMinimized(),
  webContents: () => (alive() ? win.webContents : null),
};
