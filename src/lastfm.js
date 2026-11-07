'use strict';

// Scrobbling to Last.fm. Last.fm hands out API keys per application, so key and
// secret come from the user's own API account, entered on the settings page.

const { net, shell, safeStorage } = require('electron');
const store = require('./store');
const page = require('./page');
const {
  scrobbleDue,
  replayed,
  primaryArtist,
  lastfmSignature,
  lastfmRetryable,
  pendingBatch,
  scrobbleBatchParams,
} = require('./pure');

const API = 'https://ws.audioscrobbler.com/2.0/';
const HEX32 = /^[0-9a-f]{32}$/i;

// Waiting for the user to allow access in the browser.
let token = null;
// The stored session key could not be read (keyring locked or replaced); scrobbles wait meanwhile.
let locked = false;
// The track being listened to, with how long it has actually played.
let cur = null;

const cfg = () => store.settings.lastfm || {};
// Secret and session key only ever reach the disk encrypted by the system keyring.
const seal = async (s) => (await safeStorage.encryptStringAsync(s)).toString('base64');
async function unseal(b) {
  try {
    return b ? (await safeStorage.decryptStringAsync(Buffer.from(b, 'base64'))).result : null;
  } catch {
    return null;
  }
}

async function call(method, params, post) {
  const c = cfg();
  const secret = await unseal(c.secret);
  if (!c.key || !secret) throw new Error('LASTFM_NOT_SET_UP');
  const all = { method, api_key: c.key };
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') all[k] = String(v);
  all.api_sig = lastfmSignature(all, secret);
  all.format = 'json';
  const body = new URLSearchParams(all).toString();
  let res;
  try {
    res = post
      ? await net.fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body })
      : await net.fetch(API + '?' + body);
  } catch (e) {
    // Offline or no route: worth another try later.
    e.retry = true;
    throw e;
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error) {
    const e = new Error(json.message || 'Last.fm answered ' + res.status);
    e.retry = lastfmRetryable(res.status, json.error);
    throw e;
  }
  return json;
}

// Step one: a token, then the browser for the user to allow access.
async function connect(key, secret) {
  key = typeof key === 'string' ? key.trim().toLowerCase() : '';
  secret = typeof secret === 'string' ? secret.trim().toLowerCase() : '';
  // Codes, not sentences: the settings page words them in its own language.
  if (!HEX32.test(key) || !HEX32.test(secret)) throw new Error('LASTFM_BAD_KEY');
  // basic_text has a key built into Chromium, which is as good as plain text.
  if (!(await safeStorage.isAsyncEncryptionAvailable()) || safeStorage.getSelectedStorageBackend() === 'basic_text') {
    throw new Error('LASTFM_NO_KEYRING');
  }
  store.settings.lastfm = { key, secret: await seal(secret) };
  store.saveSettings();
  token = (await call('auth.getToken', {}, false)).token;
  await shell.openExternal('https://www.last.fm/api/auth/?api_key=' + encodeURIComponent(key) + '&token=' + encodeURIComponent(token));
}

// Step two, after the user allowed it: the session key that scrobbles from now on.
async function finish() {
  if (!token) throw new Error('LASTFM_NOT_SET_UP');
  const { session } = await call('auth.getSession', { token }, false);
  token = null;
  locked = false;
  const sealed = await seal(session.key);
  store.settings.lastfm = { ...cfg(), session: sealed, name: String(session.name).slice(0, 64) };
  store.saveSettings();
}

function disconnect() {
  token = null;
  cur = null;
  locked = false;
  delete store.settings.lastfm;
  store.saveSettings();
}

const connected = () => !!(cfg().key && cfg().session);

function state() {
  return { connected: connected(), name: connected() ? cfg().name : null, waiting: !!token, locked };
}

// Scrobbles that failed for a reason that passes (offline, Last.fm down) wait in
// the settings and go out with the next call that gets through.
function keep(scrobble) {
  const c = cfg();
  if (!c.key) return;
  c.pending = [...(c.pending || []), scrobble].slice(-50);
  store.saveSettings();
}

let flushing = false;
async function flush() {
  const sk = await unseal(cfg().session);
  const c = cfg();
  const { batch, stale } = pendingBatch(c.pending, Date.now());
  if (stale.length) {
    c.pending = c.pending.filter((p) => !stale.includes(p));
    store.saveSettings();
  }
  if (flushing || !sk || !batch.length) return;
  flushing = true;
  let done = true;
  try {
    await call('track.scrobble', { ...scrobbleBatchParams(batch), sk }, true);
  } catch (e) {
    console.log('[lastfm] pending scrobbles: ' + e.message);
    done = !e.retry;
  }
  // Sent, or refused for good: a refused batch would block every later one.
  if (done) c.pending = (cfg().pending || []).filter((p) => !batch.includes(p));
  store.saveSettings();
  flushing = false;
}

async function send(method, params) {
  const sk = await unseal(cfg().session);
  if (!sk) {
    if (!locked) console.log('[lastfm] session key unreadable: keyring locked or replaced');
    locked = true;
    if (method === 'track.scrobble') keep(params);
    return;
  }
  locked = false;
  try {
    await call(method, { ...params, sk }, true);
  } catch (e) {
    console.log('[lastfm] ' + method + ': ' + e.message);
    if (e.retry && method === 'track.scrobble') keep(params);
    return;
  }
  flush();
}

// The page's player bar links each artist; the mediaSession line joins them all.
async function artistOf(line) {
  try {
    const hit = (await page.nowLinks()).find((l) => l.browseId.startsWith('UC') && line.includes(l.text));
    if (hit) return hit.text;
  } catch {}
  return primaryArtist(line);
}

function announce(c) {
  c.announced = true;
  send('track.updateNowPlaying', { artist: c.artist, track: c.track, album: c.album, duration: Math.round(c.duration) });
}

function onTrack(t) {
  if (!connected()) return;
  const now = Date.now();
  // Capped: a suspend between two updates is not listening.
  if (cur && cur.playing) cur.played += Math.min(now - cur.tick, 10000) / 1000;
  if (cur) cur.tick = now;
  // Ads and silence stop the clock but keep the track it belongs to.
  const id = t && !t.ad ? t.videoId || t.title : null;
  if (!id) {
    if (cur) cur.playing = false;
    return;
  }
  if (!cur || cur.id !== id || replayed(cur.scrobbled, cur.position, t.position)) {
    const c = (cur = {
      id,
      track: t.title,
      album: t.album,
      duration: t.duration,
      artist: null,
      startedAt: Math.floor(now / 1000),
      played: 0,
      tick: now,
      playing: t.playing,
      announced: false,
      scrobbled: false,
    });
    // A moment later the page's player bar shows this track's links.
    setTimeout(async () => {
      c.artist = await artistOf(t.artist);
      if (c === cur && c.playing && !c.announced) announce(c);
    }, 1500);
  }
  cur.playing = t.playing;
  cur.position = t.position;
  if (t.duration > 0) cur.duration = t.duration;
  if (!cur.artist) return;
  if (!cur.announced && cur.playing) announce(cur);
  if (!cur.scrobbled && scrobbleDue(cur.played, cur.duration)) {
    cur.scrobbled = true;
    send('track.scrobble', {
      artist: cur.artist,
      track: cur.track,
      album: cur.album,
      timestamp: cur.startedAt,
      duration: Math.round(cur.duration),
    });
  }
}

module.exports = { connect, finish, disconnect, connected, state, onTrack };
