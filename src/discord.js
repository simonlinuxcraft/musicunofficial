'use strict';

// Discord's local IPC socket, spoken directly: discord-rpc is unmaintained since
// 2022 for a protocol that is an 8 byte header plus JSON. A unix socket, no network.

const net = require('net');
const path = require('path');
const crypto = require('crypto');
const { positionNow } = require('./pure');

const OP_HANDSHAKE = 0;
const OP_FRAME = 1;
const OP_CLOSE = 2;
const OP_PING = 3;
const OP_PONG = 4;

// Discord rate limits SET_ACTIVITY to 5 requests per 20 seconds. 5 s stays
// under that with room to spare while still switching tracks promptly.
const MIN_UPDATE_MS = 5000;
const RETRY_MS = 15000;
// A struggling Discord was seen taking 15 s to answer the handshake.
const HANDSHAKE_MS = 30000;

// Discord rejects details, state and large_text under 2 characters, and a
// rejected activity leaves the previous track on the profile. The zero width
// space survives a trim, a plain space might not.
const field = (s) => String(s).slice(0, 128).padEnd(2, '​');

const HEADER = 8;

function encodeFrame(op, payload) {
  const body = Buffer.from(JSON.stringify(payload), 'utf8');
  const head = Buffer.allocUnsafe(HEADER);
  head.writeInt32LE(op, 0);
  head.writeInt32LE(body.length, 4);
  return Buffer.concat([head, body]);
}

// A socket read can split or glue frames: returns the complete ones plus the rest.
function decodeFrames(buf) {
  const frames = [];
  let off = 0;
  while (buf.length - off >= HEADER) {
    const op = buf.readInt32LE(off);
    const len = buf.readInt32LE(off + 4);
    if (len < 0 || len > 1 << 20) return { frames, rest: Buffer.alloc(0) };
    if (buf.length - off - HEADER < len) break;
    let data = null;
    try {
      data = JSON.parse(buf.toString('utf8', off + HEADER, off + HEADER + len));
    } catch {}
    frames.push({ op, data });
    off += HEADER + len;
  }
  return { frames, rest: buf.subarray(off) };
}

// Discord numbers its sockets when several clients run at once, and the
// Flatpak and Snap builds put theirs one level deeper.
function socketPaths(env = process.env) {
  const base = env.XDG_RUNTIME_DIR || env.TMPDIR || env.TMP || '/tmp';
  const roots = [
    base,
    path.join(base, 'snap.discord'),
    path.join(base, 'app', 'com.discordapp.Discord'),
    path.join(base, 'app', 'dev.vencord.Vesktop'),
  ];
  const out = [];
  for (const root of roots) {
    for (let i = 0; i < 10; i++) out.push(path.join(root, 'discord-ipc-' + i));
  }
  return out;
}

// onReadyChange fires when the connection becomes usable or stops being so.
function createPresence(clientId, log = () => {}, onReadyChange = () => {}, retryMs = RETRY_MS) {
  let sock = null;
  let ready = false;
  let buf = Buffer.alloc(0);
  let enabled = false;
  let pending = null;
  let lastSent = 0;
  let lastJson;
  let lastNonce = null;
  let flushTimer = null;
  let retryTimer = null;
  // Bumped on teardown, so a sweep still in flight drops its socket instead of leaking it.
  let generation = 0;

  function send(op, payload) {
    if (!sock || sock.destroyed) return;
    try {
      sock.write(encodeFrame(op, payload));
    } catch (e) {
      log('write failed: ' + e.message);
    }
  }

  function clear() {
    send(OP_FRAME, { cmd: 'SET_ACTIVITY', nonce: crypto.randomUUID(), args: { pid: process.pid } });
  }

  // graceful uses end(): destroy() would drop the buffered frame that clears the presence.
  function reset(graceful = false) {
    generation++;
    if (sock) {
      sock.removeAllListeners();
      // end() into a socket Discord already closed reports EPIPE, which
      // without a listener is an uncaught exception in the main process.
      sock.on('error', () => {});
      if (graceful) sock.end();
      else sock.destroy();
    }
    const wasReady = ready;
    sock = null;
    ready = false;
    buf = Buffer.alloc(0);
    lastJson = undefined;
    lastNonce = null;
    if (wasReady) onReadyChange();
  }

  function scheduleRetry() {
    if (!enabled || retryTimer) return;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      connect();
    }, retryMs);
    retryTimer.unref();
  }

  // Tries every candidate path in turn. Discord not running is the normal case,
  // not an error, so a failed sweep just schedules another attempt later.
  function connect(paths = socketPaths(), i = 0, gen = generation) {
    if (!enabled || sock || gen !== generation) return;
    if (i >= paths.length) {
      scheduleRetry();
      return;
    }
    const s = net.createConnection(paths[i]);
    s.once('error', () => {
      s.removeAllListeners();
      s.destroy();
      connect(paths, i + 1, gen);
    });
    s.once('connect', () => {
      // The world may have moved on while this was in flight: the user turned
      // the feature off, or another sweep won the race.
      if (!enabled || sock || gen !== generation) {
        s.removeAllListeners();
        s.destroy();
        return;
      }
      s.removeAllListeners('error');
      sock = s;
      s.on('data', onData);
      s.on('error', onDrop);
      s.on('close', onDrop);
      send(OP_HANDSHAKE, { v: 1, client_id: clientId });
      // Discord can accept the socket and then never answer.
      const t = setTimeout(() => {
        if (sock !== s || ready) return;
        log('no answer to handshake');
        onDrop();
      }, HANDSHAKE_MS);
      t.unref();
    });
  }

  function onDrop() {
    reset();
    scheduleRetry();
  }

  function onData(chunk) {
    buf = Buffer.concat([buf, chunk]);
    const out = decodeFrames(buf);
    buf = out.rest;
    for (const f of out.frames) {
      if (f.op === OP_PING) {
        send(OP_PONG, f.data);
      } else if (f.op === OP_CLOSE) {
        // Never final. Discord answers "4000 Invalid Client ID" for a valid id
        // whenever its own connection to the API is struggling.
        log('refused (' + (f.data && f.data.code) + ' ' + ((f.data && f.data.message) || '') + ')');
        onDrop();
        return;
      } else if (f.op === OP_FRAME && f.data?.evt === 'READY') {
        ready = true;
        log('connected');
        onReadyChange();
        if (pending) flush(true);
      } else if (f.op === OP_FRAME && f.data?.evt === 'ERROR') {
        // Only this update was refused; cleared so the previous track does not stay on the
        // profile. Answering only our own frames means a refused clear cannot loop.
        log('rejected: ' + JSON.stringify(f.data.data || {}));
        if (f.data.nonce && f.data.nonce === lastNonce) clear();
      }
    }
  }

  // Kept for as long as a track plays: recomputing them made Discord's progress bar jump.
  let tsKey = null;
  let tsValue = null;

  function timestampsFor(track) {
    const now = Date.now();
    // Projected to now, or Discord's counter lags by the poll and rate limit delay.
    const pos = positionNow(track, now);
    const key = track.title + '|' + track.artist + '|' + Math.round(track.duration);
    if (tsKey === key && tsValue) {
      // Same track: re-anchor only on a seek.
      const projected = (now - tsValue.start) / 1000;
      if (Math.abs(pos - projected) < 1.5) return tsValue;
    }
    tsKey = key;
    tsValue = {
      start: now - Math.round(pos * 1000),
      end: now + Math.round((track.duration - pos) * 1000),
    };
    return tsValue;
  }

  function activityFor(track) {
    if (!track || !track.title || !track.playing) {
      // Force a fresh anchor on resume: the pause itself is not tracked, so a
      // kept one would be off by however long it lasted.
      tsKey = null;
      return null;
    }
    const a = {
      type: 2, // Listening to
      // Replaces the app name, so the member list reads "Listening to <artist>".
      name: field(track.artist || track.title),
      details: field(track.title),
      state: track.artist ? field(track.artist) : undefined,
    };
    // A longer image url gets the whole activity rejected, not just the image.
    if (track.art && track.art.length <= 256) {
      a.assets = { large_image: track.art, large_text: field(track.album || track.title) };
    }
    if (track.duration > 0) a.timestamps = timestampsFor(track);
    return a;
  }

  function flush(force = false) {
    if (!enabled || !ready || !sock) return;
    const wait = lastSent + MIN_UPDATE_MS - Date.now();
    if (!force && wait > 0) {
      if (!flushTimer) {
        flushTimer = setTimeout(() => {
          flushTimer = null;
          flush(true);
        }, wait);
        flushTimer.unref();
      }
      return;
    }
    const activity = activityFor(pending);
    // The page reports every few seconds whether or not anything changed.
    const json = JSON.stringify(activity);
    if (json === lastJson) return;
    lastJson = json;
    lastSent = Date.now();
    lastNonce = crypto.randomUUID();
    send(OP_FRAME, { cmd: 'SET_ACTIVITY', nonce: lastNonce, args: { pid: process.pid, activity } });
  }

  return {
    get ready() {
      return ready;
    },
    setEnabled(value) {
      if (value === enabled) return;
      enabled = !!value;
      if (enabled) {
        connect();
      } else {
        // Clear the presence before hanging up, otherwise the last song stays
        // on the profile until Discord itself notices the socket is gone.
        const wasReady = ready;
        if (wasReady) clear();
        clearTimeout(flushTimer);
        clearTimeout(retryTimer);
        flushTimer = null;
        retryTimer = null;
        reset(wasReady);
      }
    },
    update(track) {
      pending = track;
      flush();
    },
  };
}

module.exports = { createPresence, encodeFrame, decodeFrames, socketPaths };
