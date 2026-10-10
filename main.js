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

// --hybrid turns the own UI on for one run without changing the saved choice.
const FORCE_HYBRID = process.argv.includes('--hybrid');
let hybridOn = false;
// The window that tray, second start and mini player bring back.
const front = () => (hybridOn ? hybrid : mainWindow);

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

function showMain() {
  mini.close();
  front().show();
}

function toggle() {
  if (front().isShown()) front().hide();
  else showMain();
}

// Live, without a restart: the player page keeps playing either way, only the
// window in front of it changes.
function setHybrid(on) {
  if (!!on === hybridOn) return;
  hybridOn = !!on;
  store.settings.hybrid = hybridOn;
  store.saveSettings();
  mini.setFront(front());
  mainWindow.setPersist(!hybridOn);
  if (hybridOn) {
    mainWindow.hide();
    hybrid.create(hybridOptions());
  } else {
    hybrid.saveBounds();
    hybrid.destroy();
    mainWindow.reveal();
  }
  player.sync();
  tray.rebuild();
}

// Every window that shows text picks the new language up on its next load.
function setLanguage(value) {
  store.settings.language = value;
  store.saveSettings();
  hybrid.reload();
  mini.reload();
  tray.rebuild();
}

const hybridOptions = () => ({ openMini: mini.open, canHide: tray.exists, setHybrid, setLanguage });

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
  hybridOn = FORCE_HYBRID || store.settings.hybrid === true;
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
  // In hybrid mode closing the player window only hides it, or the music would stop.
  mainWindow.create({ resume, openMini: mini.open, canHide: () => hybridOn || tray.exists(), hidden: hybridOn });
  if (hybridOn) {
    mini.setFront(hybrid);
    hybrid.create(hybridOptions());
  }
  try {
    tray.create({ toggle, openMini: mini.open, hybrid: () => hybridOn, setHybrid });
  } catch (e) {
    console.log('[tray] unavailable: ' + e.message);
  }
});

// No window-all-closed handler: with a tray, close only hides; without one,
// Electron's default quit-on-last-window applies.
