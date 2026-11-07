'use strict';

const { test, mock, after, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const stub = require('./stub');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'musicunofficial-lastfm-'));
after(() => fs.rmSync(dir, { recursive: true, force: true }));
stub('electron', {
  app: { getPath: () => dir },
  net: { fetch: () => Promise.reject(new Error('offline')) },
  shell: {},
  // A keyring that does not open: every stored key is unreadable.
  safeStorage: { decryptStringAsync: () => Promise.reject(new Error('locked')) },
});
stub('./page', { nowLinks: async () => [] });
const store = require('../src/store');
const lastfm = require('../src/lastfm');

// Everything queued behind fake timers runs as microtasks; one real turn drains them.
const settle = () => new Promise((r) => setImmediate(r));
const track = (videoId, position) => ({ videoId, title: 'Song', artist: 'Artist', album: '', duration: 200, position, playing: true, ad: false });

function connect() {
  lastfm.disconnect();
  store.settings.lastfm = { key: 'k', session: 'sealed', name: 'me' };
}

afterEach(() => mock.timers.reset());

test('keeps a scrobble while the keyring is locked, and says so', async () => {
  mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000_000 });
  connect();
  lastfm.onTrack(track('aaaaaaaaaaa', 0));
  // The artist lookup a moment after the track starts.
  mock.timers.tick(1500);
  await settle();
  for (let s = 5; s <= 120; s += 5) {
    mock.timers.tick(5000);
    lastfm.onTrack(track('aaaaaaaaaaa', s));
  }
  await settle();
  assert.equal(lastfm.state().locked, true);
  assert.equal(store.settings.lastfm.pending.length, 1);
  assert.equal(store.settings.lastfm.pending[0].track, 'Song');
});

test('a suspend between two updates does not count as listening', async () => {
  mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 5_000_000 });
  connect();
  lastfm.onTrack(track('bbbbbbbbbbb', 0));
  mock.timers.tick(1500);
  await settle();
  mock.timers.tick(3600 * 1000);
  lastfm.onTrack(track('bbbbbbbbbbb', 3));
  await settle();
  assert.equal(store.settings.lastfm.pending, undefined);
});
