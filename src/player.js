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
const COMMANDS = ['previous', 'playpause', 'play', 'pause', 'next', 'seek'];

let mainWc = () => null;
// Our own windows that show the track and send commands: mini player, hybrid UI.
let views = [];
// Whether one of them is on screen, or MPRIS is up, and wants updates.
let wanted = () => false;
let onTrack = () => {};
let track = null;
let presence = null;
let lastResume = null;

const isView = (wc) => views.some((v) => v() === wc);

function setTrack(next) {
  track = next;
  for (const v of views) {
    const wc = v();
    if (wc) wc.send('track:update', track);
  }
  if (presence) presence.update(track);
  onTrack(track);
}

// From our views and from MPRIS; only the page can act on it.
function command(cmd, arg) {
  const wc = mainWc();
  if (!wc || !COMMANDS.includes(cmd)) return;
  if (cmd === 'seek' && !(typeof arg === 'number' && Number.isFinite(arg) && arg >= 0)) return;
  wc.send('player:command', cmd, cmd === 'seek' ? arg : undefined);
}

// The page only polls while something consumes the result: polling regardless
// was two thirds of the app's CPU during playback.
function sync() {
  const wc = mainWc();
  if (!wc) return;
  const needed = wanted() || !!(presence && presence.ready);
  wc.send('nowplaying:active', needed);
  if (!needed) setTrack(null);
}

// Pulled on a timer instead of riding the now playing pipeline, which is idle
// unless the mini player is open or Discord is connected.
function capture() {
  const wc = mainWc();
  if (!wc) return;
  wc.mainFrame
    .executeJavaScript('window.__ytmSnapshot && window.__ytmSnapshot()')
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
    position: positionNow(lastResume),
    duration: lastResume.duration,
    savedAt: Date.now(),
  };
  store.saveSettings();
}

function setDiscord(on) {
  store.settings.richPresence = !!on && !!DISCORD_CLIENT_ID;
  store.saveSettings();
  if (presence) {
    presence.setEnabled(store.settings.richPresence);
    if (store.settings.richPresence) presence.update(track);
  }
  sync();
}

function init(opts) {
  mainWc = opts.mainWc;
  views = opts.views;
  wanted = opts.wanted;
  onTrack = opts.onTrack || onTrack;
  if (DISCORD_CLIENT_ID) {
    presence = createPresence(DISCORD_CLIENT_ID, (m) => console.log('[discord] ' + m), sync);
    presence.setEnabled(store.settings.richPresence);
  }
  setInterval(capture, 12000);
}

function stop() {
  if (presence) presence.setEnabled(false);
  saveResume();
}

// Only the main window reports playback and only our own views send commands.
ipcMain.on('nowplaying:update', (e, raw) => {
  if (e.sender === mainWc()) setTrack(sanitizeTrack(raw));
});

ipcMain.on('track:request', (e) => {
  if (isView(e.sender)) e.sender.send('track:update', track);
});

ipcMain.on('track:command', (e, cmd, arg) => {
  if (isView(e.sender)) command(cmd, arg);
});

module.exports = {
  init,
  stop,
  sync,
  setTrack,
  command,
  takeResume,
  setDiscord,
  discordAvailable: !!DISCORD_CLIENT_ID,
  discordEnabled: () => store.settings.richPresence,
};
