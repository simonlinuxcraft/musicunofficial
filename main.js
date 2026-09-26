'use strict';

const { app, session } = require('electron');
const path = require('path');
const store = require('./src/store');
const player = require('./src/player');
const mainWindow = require('./src/main-window');
const mini = require('./src/mini-window');
const tray = require('./src/tray');

// Pinned so a rename cannot move the profile and sign the user out. Must run
// before requestSingleInstanceLock, which keeps its lock there.
app.setPath('userData', path.join(app.getPath('appData'), 'musicunofficial'));

if (!app.requestSingleInstanceLock()) {
  app.quit();
  return;
}

// Overlay scrollbars fade out instead of taking layout width.
app.commandLine.appendSwitch('enable-features', 'OverlayScrollbar,FluentOverlayScrollbar');

function showMain() {
  mini.close();
  mainWindow.show();
}

function toggle() {
  if (mainWindow.isShown()) mainWindow.hide();
  else showMain();
}

app.on('second-instance', showMain);

app.on('before-quit', () => {
  mainWindow.saveBounds();
  mini.saveBounds();
  player.stop();
  // Main window first, so the mini player's closed handler finds nothing to bring back.
  mainWindow.destroy();
  mini.destroy();
});

app.whenReady().then(() => {
  store.loadSettings();
  const resume = player.takeResume();

  // On the session, not the window: login popups would otherwise carry the Electron token Google rejects.
  const ua = session.defaultSession.getUserAgent().replace(/ Electron\/[\d.]+/, '');
  session.defaultSession.setUserAgent(ua);

  player.init({ mainWc: mainWindow.webContents, miniWc: mini.webContents, onDiscordOff: tray.rebuild });
  mainWindow.create({ resume, openMini: mini.open, isMiniOpen: mini.isOpen, canHide: tray.exists });
  try {
    tray.create({ toggle, openMini: mini.open });
  } catch (e) {
    console.log('[tray] unavailable: ' + e.message);
  }
});

// No window-all-closed handler: with a tray, close only hides; without one,
// Electron's default quit-on-last-window applies.
