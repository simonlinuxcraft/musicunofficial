'use strict';

const { app, session } = require('electron');
const path = require('path');
const store = require('./src/store');
const player = require('./src/player');
const mainWindow = require('./src/main-window');
const mini = require('./src/mini-window');
const tray = require('./src/tray');
const hybrid = require('./src/hybrid-window');
const mpris = require('./src/mpris');
const page = require('./src/page');
const sleep = require('./src/sleep');
const notify = require('./src/notify');
const lastfm = require('./src/lastfm');
require('./src/i18n');

// Pinned so a rename cannot move the profile and sign the user out. Must run
// before requestSingleInstanceLock, which keeps its lock there.
app.setPath('userData', path.join(app.getPath('appData'), 'musicunofficial'));

if (!app.requestSingleInstanceLock()) {
  app.quit();
  return;
}

// Audio mixers list the stream under these instead of "Chromium". libpulse reads
// it in the audio process, which starts later and inherits the environment.
process.env.PULSE_PROP_OVERRIDE ??= "application.name='MusicUnofficial' application.icon_name='musicunofficial'";

// Overlay scrollbars fade out instead of taking layout width.
app.commandLine.appendSwitch('enable-features', 'OverlayScrollbar,FluentOverlayScrollbar');
// Chromium's own MPRIS player, replaced by src/mpris.js.
app.commandLine.appendSwitch('disable-features', 'HardwareMediaKeyHandling');

// The own interface is the app; the YouTube Music window behind it only plays
// and comes forward for sign-in, consent and whatever the interface lacks.
function showMain() {
  mini.close();
  hybrid.show();
}

function toggle() {
  if (hybrid.isShown()) hybrid.hide();
  else showMain();
}

// Every window that shows text picks the new language up on its next load.
function setLanguage(value) {
  store.settings.language = value;
  store.saveSettings();
  hybrid.reload();
  mini.reload();
  tray.rebuild();
}

app.on('second-instance', showMain);

app.on('before-quit', () => {
  mainWindow.saveBounds();
  hybrid.saveBounds();
  mini.saveBounds();
  player.stop();
  // Main and hybrid window first, so the mini player's closed handler finds nothing to bring back.
  mainWindow.destroy();
  hybrid.destroy();
  mini.destroy();
});

app.whenReady().then(() => {
  store.loadSettings();
  const resume = player.takeResume();

  // On the session, not the window: login popups would otherwise carry the Electron token Google rejects.
  const ua = session.defaultSession.getUserAgent().replace(/ Electron\/[\d.]+/, '');
  session.defaultSession.setUserAgent(ua);

  player.init({
    mainWc: mainWindow.webContents,
    views: [mini.webContents, hybrid.webContents],
    // MPRIS and the background features need every change. Otherwise the mini
    // player counts while it exists, the hybrid UI only while it is on screen.
    wanted: () =>
      mpris.active() || lastfm.connected() || notify.enabled() || sleep.active() || mini.isOpen() || hybrid.isShown(),
    onTrack: (t) => {
      mpris.update(t);
      sleep.onTrack(t);
      notify.onTrack(t);
      lastfm.onTrack(t);
    },
  });
  sleep.init(() => player.command('pause'));
  // No notification for a track the user is looking at anyway.
  notify.init(() => mainWindow.isFocused() || hybrid.isFocused() || mini.isOpen());
  mpris.start({ raise: showMain, quit: () => app.quit(), command: player.command, control: page.control });
  mainWindow.create({ resume, openMini: mini.open });
  hybrid.create({ openMini: mini.open, canHide: tray.exists, setLanguage });
  try {
    tray.create({ toggle, openMini: mini.open });
  } catch (e) {
    console.log('[tray] unavailable: ' + e.message);
  }
});

// No window-all-closed handler: with a tray, close only hides; without one,
// Electron's default quit-on-last-window applies.
