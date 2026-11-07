'use strict';

// Talking to the YouTube Music page in the player window: its own InnerTube
// client, its navigation, its player bar and its queue. The page side is inject/bridge.js.

const fs = require('fs');
const path = require('path');
const mainWindow = require('./main-window');
const pure = require('./pure');

const BRIDGE = fs.readFileSync(path.join(__dirname, '..', 'inject', 'bridge.js'), 'utf8');
const ANSWER_MS = 35000;

// The first request comes right at startup, while the page is still loading.
const READY =
  'new Promise((ok, no) => { const t0 = Date.now(); (function poll() {' +
  " const a = document.querySelector('ytmusic-app');" +
  ' if (a && a.networkManager) return ok(a);' +
  " if (Date.now() - t0 > 30000) return no(new Error('YouTube Music did not finish loading'));" +
  ' setTimeout(poll, 200); })(); })';

// Whichever of the events comes first; the other listeners go with it.
function firstOf(wc, events, ms) {
  return new Promise((ok, no) => {
    const done = (fn) => {
      clearTimeout(timer);
      for (const ev of events) wc.removeListener(ev, onEvent);
      fn();
    };
    const onEvent = () => done(ok);
    const timer = setTimeout(() => done(() => no(new Error('YouTube Music did not answer'))), ms);
    for (const ev of events) wc.once(ev, onEvent);
  });
}

// Runs in the page, which already holds the login and the client config.
// `code` sees the page's <ytmusic-app> as `app`.
async function inPage(code) {
  const wc = mainWindow.webContents();
  if (!wc) throw new Error('player window is gone');
  // A script sent into the document that is about to be replaced dies with it.
  // dom-ready may already be past while the page still loads, so its end counts too.
  if (wc.isLoadingMainFrame()) await firstOf(wc, ['dom-ready', 'did-stop-loading', 'destroyed'], ANSWER_MS);
  // A destroyed or navigating page can leave a script promise unsettled, and the UI on "Loading" for good.
  let timer;
  const giveUp = new Promise((ok, no) => {
    timer = setTimeout(() => no(new Error('YouTube Music did not answer')), ANSWER_MS);
  });
  try {
    return await Promise.race([wc.mainFrame.executeJavaScript(READY + '.then((app) => ' + code + ')'), giveUp]);
  } finally {
    clearTimeout(timer);
  }
}

// One function of inject/bridge.js. Arguments go in as JSON, never as code.
const call = (fn, ...args) => inPage('{ const b = ' + BRIDGE + '\n; return b.' + fn + '(app, ...' + JSON.stringify(args) + '); }');

// ponytail: an internal of the page; a plain fetch to /youtubei/v1 with a SAPISIDHASH header if it goes away.
const innertube = (endpoint, body) => call('fetch', endpoint, body);
const navigate = (endpoint) => call('navigate', endpoint);
const signedIn = () => call('signedIn');

// What the UI and MPRIS may do through the player bar.
const ACTIONS = ['shuffle', 'repeat', 'mute', 'like', 'dislike', 'volume', 'repeatTo', 'shuffleTo', 'avSong', 'avVideo', 'skipAd'];

function actionArg(action, arg) {
  if (action === 'volume') return typeof arg === 'number' && Number.isFinite(arg) ? Math.min(100, Math.max(0, Math.round(arg))) : null;
  if (action === 'repeatTo') return ['NONE', 'ALL', 'ONE'].includes(arg) ? arg : null;
  if (action === 'shuffleTo') return typeof arg === 'boolean' ? arg : null;
  return true;
}

// Null until inject/nowplaying.js is in a new document; its next poll reports the state anyway.
const readControls = () => inPage("typeof __ytmControls === 'function' ? __ytmControls() : null").then(pure.sanitizeControls);

async function control(action, arg) {
  if (!ACTIONS.includes(action)) return null;
  const value = actionArg(action, arg);
  if (value === null) return null;
  await call('control', action, value);
  // The bar updates its own state a tick after the click.
  await new Promise((ok) => setTimeout(ok, 250));
  return readControls();
}

const nowLinks = () => call('nowLinks').then(pure.sanitizeLinks);
const queue = () => call('queue').then(pure.sanitizeQueue);
const queuePlay = (index, videoId) => call('queuePlay', index, videoId);
const queueRemove = (itemId) => call('queueRemove', itemId);
const queueMove = (from, to) => call('queueMove', from, to);

const QUEUE_POSITIONS = ['INSERT_AFTER_CURRENT_VIDEO', 'INSERT_AT_END'];

// How many items went in, 0 when YouTube sent none (the queue stays as it was),
// -1 when nothing was playing yet and the target simply started.
async function queueAdd(target, position) {
  const added = await call('queueAdd', target, position);
  if (added !== -1) return added;
  await navigate(
    target.videoId ? { watchEndpoint: { videoId: target.videoId } } : { watchPlaylistEndpoint: { playlistId: target.playlistId } }
  );
  return -1;
}

// hybrid-window sets it per track, see setQuality in inject/bridge.js.
const QUALITIES = ['auto', 'hd2160', 'hd1440', 'hd1080', 'hd720', 'large', 'medium', 'tiny'];
const setQuality = (q) => call('setQuality', q);

module.exports = {
  innertube,
  navigate,
  signedIn,
  control,
  readControls,
  nowLinks,
  queue,
  queuePlay,
  queueRemove,
  queueMove,
  queueAdd,
  QUEUE_POSITIONS,
  QUALITIES,
  setQuality,
};
