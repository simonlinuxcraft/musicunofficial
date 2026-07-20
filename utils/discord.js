'use strict';

// Talks to Discord's local IPC socket directly. The discord-rpc package would
// do the same thing but has been unmaintained since 2022 and pulls in ws and
// uuid for a protocol that is an 8 byte header plus JSON.
//
// No network access is involved: this is a unix socket in the user's runtime
// directory. Nothing is sent anywhere unless the user turns it on.

const net = require('net');
const path = require('path');
const crypto = require('crypto');

const OP_HANDSHAKE = 0;
const OP_FRAME = 1;
const OP_CLOSE = 2;
const OP_PING = 3;
const OP_PONG = 4;

// Discord answers a bad handshake with a CLOSE frame carrying one of these and
// then hangs up. Retrying cannot fix any of them, so the feature switches
// itself off instead of reconnecting every 30 seconds forever. 4002 (rate
// limited) is deliberately not in here, that one is worth waiting out.
const FATAL_CLOSE_CODES = new Set([4000, 4001, 4003, 4004, 4005]);

// Discord rate limits SET_ACTIVITY to 5 requests per 20 seconds. 5 s stays
// under that with room to spare while still switching tracks promptly.
const MIN_UPDATE_MS = 5000;
const RETRY_MS = 30000;

function encodeFrame(op, payload) {
  const body = Buffer.from(JSON.stringify(payload), 'utf8');
  const head = Buffer.allocUnsafe(8);
  head.writeInt32LE(op, 0);
  head.writeInt32LE(body.length, 4);
  return Buffer.concat([head, body]);
}

// A socket read can split one frame across chunks or glue two frames together,
// so this returns the complete frames plus the bytes that belong to the next
// read.
function decodeFrames(buf) {
  const frames = [];
  let off = 0;
  while (buf.length - off >= 8) {
    const op = buf.readInt32LE(off);
    const len = buf.readInt32LE(off + 4);
    if (len < 0 || len > 1 << 20) return { frames, rest: Buffer.alloc(0) };
    if (buf.length - off - 8 < len) break;
    let data = null;
    try {
      data = JSON.parse(buf.toString('utf8', off + 8, off + 8 + len));
    } catch {}
    frames.push({ op, data });
    off += 8 + len;
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

function createPresence(clientId, log = () => {}, onFatal = () => {}) {
  let sock = null;
  let ready = false;
  let buf = Buffer.alloc(0);
  let enabled = false;
  let pending = null;
  let lastSent = 0;
  let flushTimer = null;
  let retryTimer = null;
  // Bumped whenever the connection is torn down. A sweep that was already in
  // flight compares against it and drops its socket instead of installing it,
  // which otherwise leaks a live file descriptor on a fast off/on toggle.
  let generation = 0;

  function send(op, payload) {
    if (!sock || sock.destroyed) return;
    try {
      sock.write(encodeFrame(op, payload));
    } catch (e) {
      log('write failed: ' + e.message);
    }
  }

  // graceful uses end() rather than destroy(): writes are buffered, and
  // destroy() throws away whatever has not gone out yet, which would drop the
  // frame that clears the presence when the user switches the feature off.
  function reset(graceful = false) {
    generation++;
    if (sock) {
      sock.removeAllListeners();
      if (graceful) sock.end();
      else sock.destroy();
    }
    sock = null;
    ready = false;
    buf = Buffer.alloc(0);
  }

  function giveUp(why) {
    log(why);
    enabled = false;
    clearTimeout(flushTimer);
    clearTimeout(retryTimer);
    flushTimer = null;
    retryTimer = null;
    reset();
    onFatal(why);
  }

  function scheduleRetry() {
    if (!enabled || retryTimer) return;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      connect();
    }, RETRY_MS);
    if (retryTimer.unref) retryTimer.unref();
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
        // An unknown client id arrives here, not as an ERROR frame: Discord
        // sends CLOSE with code 4000 and hangs up.
        const code = f.data && f.data.code;
        const why = 'refused (' + code + ' ' + ((f.data && f.data.message) || '') + ')';
        if (FATAL_CLOSE_CODES.has(code)) giveUp(why);
        else log(why);
        return;
      } else if (f.op === OP_FRAME && f.data && f.data.evt === 'READY') {
        ready = true;
        log('connected');
        flush(true);
      } else if (f.op === OP_FRAME && f.data && f.data.evt === 'ERROR') {
        giveUp('rejected: ' + JSON.stringify(f.data.data || {}));
        return;
      }
    }
  }

  // Discord derives its own progress bar from these, so they must stay put for
  // as long as a track plays. Recomputing them on every update moved the
  // reference point by however stale the reported position was and made the
  // bar visibly jump.
  let tsKey = null;
  let tsValue = null;

  function timestampsFor(track) {
    const pos = Math.min(track.position, track.duration);
    const key = track.title + '|' + track.artist + '|' + Math.round(track.duration);
    if (tsKey === key && tsValue) {
      // Same track: keep the existing anchor unless the user seeked, which
      // shows up as the real position drifting away from the projected one.
      const projected = (Date.now() - tsValue.start) / 1000;
      if (Math.abs(pos - projected) < 3) return tsValue;
    }
    const now = Date.now();
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
      // Overrides the application name in the member list, which is what makes
      // this read "Listening to <artist>" the way Spotify does instead of
      // naming the app. Discord only started honouring this field for RPC
      // clients recently; before that it was reserved for its own Spotify
      // integration. Falls back to the title when a track has no artist.
      name: String(track.artist || track.title).slice(0, 128),
      details: String(track.title).slice(0, 128),
      state: track.artist ? String(track.artist).slice(0, 128) : undefined,
    };
    if (track.art) {
      a.assets = { large_image: track.art, large_text: (track.album || track.title).slice(0, 128) };
    }
    // position is clamped: the poller reads it every 500 ms and can catch a
    // value just past duration, which would put the end in the past.
    if (track.duration > 0 && track.position >= 0) a.timestamps = timestampsFor(track);
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
        if (flushTimer.unref) flushTimer.unref();
      }
      return;
    }
    lastSent = Date.now();
    send(OP_FRAME, {
      cmd: 'SET_ACTIVITY',
      nonce: crypto.randomUUID(),
      args: { pid: process.pid, activity: activityFor(pending) },
    });
  }

  return {
    get enabled() {
      return enabled;
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
        if (wasReady) send(OP_FRAME, { cmd: 'SET_ACTIVITY', nonce: crypto.randomUUID(), args: { pid: process.pid } });
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
