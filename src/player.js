'use strict';

// Track state between the page, the mini player and Discord, plus the resume
// record that survives a restart.

const { ipcMain } = require('electron');
const store = require('./store');
const { sanitizeTrack, sanitizeResume, positionNow } = require('./pure');
const { createPresence } = require('./discord');

// Client ids are public. The override lets a fork use its own Discord application.
const DISCORD_CLIENT_ID = process.env.MUSICUNOFFICIAL_DISCORD_ID || '1528803144937635890';
// Keeps "quit today, back tomorrow" without reviving a session from weeks ago.
const MAX_RESUME_AGE = 7 * 24 * 3600 * 1000;
const COMMANDS = ['previous', 'playpause', 'next'];

let mainWc = () => null;
let miniWc = () => null;
let track = null;
let presence = null;
let lastResume = null;

function setTrack(next) {
  track = next;
  const mini = miniWc();
  if (mini) mini.send('mini:track', track);
  if (presence) presence.update(track);
}

// The page only polls while something consumes the result: polling regardless
// was two thirds of the app's CPU during playback.
function sync() {
  const wc = mainWc();
  if (!wc) return;
  const needed = !!miniWc() || !!(presence && presence.enabled);
  wc.send('nowplaying:active', needed);
  if (!needed) setTrack(null);
}

// Pulled on a timer instead of riding the now playing pipeline, which is idle
// unless the mini player or Discord is on.
function capture() {
  const wc = mainWc();
  if (!wc) return;
  wc.executeJavaScript('window.__ytmSnapshot && window.__ytmSnapshot()')
    .then((snap) => {
      const r = sanitizeResume(snap);
      if (r) lastResume = r;
    })
    .catch(() => {});
}

// Consumed on read, so a record that breaks startup cannot loop.
function takeResume() {
  const saved = store.settings.resume;
  if (!saved) return null;
  delete store.settings.resume;
  store.saveSettings();
  if (typeof saved.savedAt !== 'number' || Date.now() - saved.savedAt >= MAX_RESUME_AGE) return null;
  return sanitizeResume(saved);
}

// Written synchronously at quit. Asking the renderer then could hang on a stuck page.
function saveResume() {
  if (!lastResume) return;
  store.settings.resume = {
    videoId: lastResume.videoId,
    list: lastResume.list,
    title: lastResume.title,
    position: positionNow(lastResume),
    duration: lastResume.duration,
    savedAt: Date.now(),
  };
  store.saveSettings();
}

function setDiscord(on) {
  store.settings.discord = !!on && !!DISCORD_CLIENT_ID;
  store.saveSettings();
  if (presence) {
    presence.setEnabled(store.settings.discord);
    if (store.settings.discord) presence.update(track);
  }
  sync();
}

function init(opts) {
  mainWc = opts.mainWc;
  miniWc = opts.miniWc;
  if (DISCORD_CLIENT_ID) {
    presence = createPresence(
      DISCORD_CLIENT_ID,
      (m) => console.log('[discord] ' + m),
      // Discord turned us away for good, so untick the box instead of showing a dead feature as on.
      () => {
        store.settings.discord = false;
        store.saveSettings();
        sync();
        opts.onDiscordOff();
      }
    );
    presence.setEnabled(store.settings.discord);
  }
  setInterval(capture, 12000);
}

function stop() {
  if (presence) presence.setEnabled(false);
  saveResume();
}

// Only the main window reports playback and only the mini player sends commands.
ipcMain.on('nowplaying:update', (e, raw) => {
  if (e.sender === mainWc()) setTrack(sanitizeTrack(raw));
});

ipcMain.on('mini:request', (e) => {
  if (e.sender === miniWc()) e.sender.send('mini:track', track);
});

ipcMain.on('mini:command', (e, cmd) => {
  const wc = mainWc();
  if (wc && e.sender === miniWc() && COMMANDS.includes(cmd)) wc.send('player:command', cmd);
});

module.exports = {
  init,
  stop,
  sync,
  setTrack,
  takeResume,
  setDiscord,
  discordAvailable: !!DISCORD_CLIENT_ID,
  discordEnabled: () => store.settings.discord,
};
