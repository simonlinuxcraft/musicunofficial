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
// Background consumers react to events (play, pause, seek, track change); the
// poll only catches metadata, which a window on screen wants sooner.
const FAST_POLL = 1000;
const SLOW_POLL = 3000;
const COMMANDS = ['previous', 'playpause', 'play', 'pause', 'next', 'seek'];

let mainWc = () => null;
// Our own windows that show the track and send commands: mini player, hybrid UI.
let views = [];
// The poll interval in ms the consumers need right now, 0 for none.
let wanted = () => 0;
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

// The page only polls while something consumes the result: polling is most of the app's CPU.
function sync() {
  const wc = mainWc();
  if (!wc) return;
  const ms = wanted() || (presence && presence.ready ? SLOW_POLL : 0);
  wc.send('nowplaying:active', ms);
  if (!ms) setTrack(null);
}

// Pulled on a timer instead of riding the now playing pipeline, which is idle
// while nothing consumes the track.
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
  store.settings.richPresence = !!on;
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
  presence = createPresence(DISCORD_CLIENT_ID, (m) => console.log('[discord] ' + m), sync);
  presence.setEnabled(store.settings.richPresence);
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
  FAST_POLL,
  SLOW_POLL,
  discordEnabled: () => store.settings.richPresence,
};
