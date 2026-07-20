'use strict';

const { app, BrowserWindow, Tray, Menu, shell, session, nativeImage, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { isInternal, keyAction } = require('./utils/pure');

const APP_TITLE = 'MusicUnofficial';
const START_URL = 'https://music.youtube.com/';
const DEFAULT_BOUNDS = { width: 1280, height: 860 };
const INJECT_CSS = fs.readFileSync(path.join(__dirname, 'inject', 'style.css'), 'utf8');
const INJECT_JS = fs.readFileSync(path.join(__dirname, 'inject', 'controls.js'), 'utf8');

let win = null;
let tray = null;
let quitting = false;
let hasTray = false;

// Pin the profile directory instead of letting Electron derive it from the app
// name. Otherwise every rename moves userData and silently signs the user out.
// Must run before requestSingleInstanceLock, which uses this path for its lock.
app.setPath('userData', path.join(app.getPath('appData'), 'musicunofficial'));

if (!app.requestSingleInstanceLock()) {
  app.quit();
  return;
}

// Chromium's classic scrollbar takes up layout width and sits on top of the
// page design. Overlay scrollbars fade out instead.
app.commandLine.appendSwitch('enable-features', 'OverlayScrollbar,FluentOverlayScrollbar');

function statePath() {
  return path.join(app.getPath('userData'), 'window-state.json');
}

function loadBounds() {
  try {
    const s = JSON.parse(fs.readFileSync(statePath(), 'utf8'));
    if (Number.isInteger(s.width) && Number.isInteger(s.height)) return s;
  } catch {}
  return { ...DEFAULT_BOUNDS };
}

// Only sampled while the window is mapped: isMaximized() reports false on a
// hidden or minimised window, so reading it then would persist a wrong state.
// The last good sample is kept so quitting from the tray still writes the real
// geometry instead of writing nothing.
let lastBounds = null;

function saveBounds() {
  if (!win || win.isDestroyed()) return;
  if (win.isVisible() && !win.isMinimized()) {
    lastBounds = { ...win.getNormalBounds(), maximized: win.isMaximized() };
  }
  if (!lastBounds) return;
  try {
    fs.writeFileSync(statePath(), JSON.stringify(lastBounds));
  } catch {}
}

// resize and move fire continuously while dragging, and saveBounds writes
// synchronously. Without this the state file is rewritten hundreds of times
// per drag.
let saveTimer = null;
function scheduleSaveBounds() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveBounds, 400);
}

function createWindow() {
  const s = loadBounds();

  win = new BrowserWindow({
    x: s.x,
    y: s.y,
    width: s.width,
    height: s.height,
    minWidth: 480,
    minHeight: 400,
    // No backgroundColor override: Google's consent page renders light and
    // sets no body background, so a dark window makes its text unreadable.
    show: false,
    // Frameless. Window controls are injected into the page's own nav bar by
    // inject/controls.js. A native titleBarOverlay was tried first and looked
    // like a black box pasted over the header gradient.
    frame: false,
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: {
      // Chromium throttles timers in hidden windows, which stalls playback
      // once the window is minimised or sent to the tray.
      backgroundThrottling: false,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  if (s.maximized) win.maximize();
  win.once('ready-to-show', () => win.show());
  win.setMenuBarVisibility(false);

  // Pin the title: the page overwrites it on every navigation, which would
  // otherwise put a changing string in the task bar and Alt-Tab.
  win.setTitle(APP_TITLE);
  win.on('page-title-updated', (e) => {
    e.preventDefault();
    win.setTitle(APP_TITLE);
  });

  win.loadURL(START_URL);

  // dom-ready, not did-finish-load: this lands the stylesheet and arms the
  // observer before Polymer builds the nav bar, which keeps the original logo
  // from flashing up first.
  win.webContents.on('dom-ready', () => {
    win.webContents.insertCSS(INJECT_CSS).catch((e) => console.log('[inject] css: ' + e.message));
    win.webContents.executeJavaScript(INJECT_JS)
      .then(() => win.webContents.send('window:maximized', win.isMaximized()))
      .catch((e) => console.log('[inject] js: ' + e.message));
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isInternal(url)) return { action: 'allow' };
    shell.openExternal(url);
    return { action: 'deny' };
  });

  win.webContents.on('will-navigate', (e, url) => {
    if (isInternal(url)) return;
    e.preventDefault();
    shell.openExternal(url);
  });

  win.webContents.on('before-input-event', (e, input) => {
    const action = keyAction(input);
    if (!action) return;
    e.preventDefault();
    const wc = win.webContents;
    if (action === 'quit') {
      quitting = true;
      app.quit();
    } else if (action === 'reload') {
      wc.reload();
    } else if (action === 'zoom-in') {
      wc.setZoomLevel(Math.min(wc.getZoomLevel() + 0.5, 5));
    } else if (action === 'zoom-out') {
      wc.setZoomLevel(Math.max(wc.getZoomLevel() - 0.5, -5));
    } else if (action === 'zoom-reset') {
      wc.setZoomLevel(0);
    }
  });

  win.on('close', (e) => {
    saveBounds();
    // hasTray only tells us the Tray object was created, NOT that this desktop
    // actually renders a status area: Electron falls back to GtkStatusIcon
    // without throwing, and GNOME has not drawn those since 3.26. On such a
    // system the way back is Ctrl+Q, not the tray.
    if (!quitting && hasTray) {
      e.preventDefault();
      win.hide();
    }
  });

  const sendMaxState = () => {
    if (win && !win.isDestroyed()) win.webContents.send('window:maximized', win.isMaximized());
  };
  win.on('maximize', sendMaxState);
  win.on('unmaximize', sendMaxState);

  win.on('resize', scheduleSaveBounds);
  win.on('move', scheduleSaveBounds);
}

function toggleWindow() {
  if (!win) return;
  if (win.isVisible() && !win.isMinimized()) {
    win.hide();
  } else {
    win.show();
    win.focus();
  }
}

function createTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, 'icon-tray.png'));
  // Guards a missing or unreadable icon file, nothing more. Whether the desktop
  // shows status icons at all cannot be detected from here.
  if (icon.isEmpty()) {
    console.log('[tray] icon missing, running without tray');
    return;
  }
  tray = new Tray(icon);
  tray.setToolTip(APP_TITLE);
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Show / Hide', click: toggleWindow },
      { type: 'separator' },
      {
        label: 'Quit',
        accelerator: 'CommandOrControl+Q',
        click: () => {
          quitting = true;
          app.quit();
        },
      },
    ])
  );
  tray.on('click', toggleWindow);
  hasTray = true;
}

ipcMain.on('window:minimize', () => win && win.minimize());
ipcMain.on('window:toggle-maximize', () => {
  if (!win) return;
  if (win.isMaximized()) win.unmaximize();
  else win.maximize();
});
ipcMain.on('window:close', () => win && win.close());

app.on('second-instance', () => {
  if (win) {
    win.show();
    win.focus();
  }
});

app.on('before-quit', () => {
  quitting = true;
  saveBounds();
});

app.whenReady().then(() => {
  // On the session, not on a single webContents: the login flow opens popups,
  // and those would otherwise carry the Electron token that Google rejects.
  const ua = session.defaultSession.getUserAgent().replace(/ Electron\/[\d.]+/, '');
  session.defaultSession.setUserAgent(ua);

  createWindow();
  try {
    createTray();
  } catch (e) {
    // Rarely reached: Electron does not throw when the desktop lacks a status
    // area. Kept for a genuinely broken tray backend.
    console.log('[tray] unavailable: ' + e.message);
  }
});

// No window-all-closed handler. With a tray the close handler hides
// the window; without one it lets the close through and Electron's default
// quit-on-last-window applies.
