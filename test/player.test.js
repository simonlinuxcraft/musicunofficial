'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const stub = require('./stub');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'musicunofficial-player-'));
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));
stub('electron', { app: { getPath: () => dir }, ipcMain: { on() {} } });
const store = require('../src/store');
const player = require('../src/player');

const track = (videoId, position) => ({ title: 'Song', videoId, position, duration: 200, playing: false, at: Date.now(), ad: false });

test('the resume record follows the track but never pairs a new track with the old list', () => {
  store.settings.resume = { videoId: 'aaaaaaaaaaa', list: 'OLAK5uy_kiGK7CsP2rcBJgmlYu5r8sl7D0zynwXrM', position: 10, duration: 200, savedAt: Date.now() };
  assert.equal(player.takeResume().videoId, 'aaaaaaaaaaa');
  assert.equal(store.settings.resume, undefined);
  // Quit before any capture: the record is written back.
  assert.equal(player.resumePoint().position, 10);
  player.setTrack(track('aaaaaaaaaaa', 50));
  assert.deepEqual([player.resumePoint().position, player.resumePoint().list], [50, 'OLAK5uy_kiGK7CsP2rcBJgmlYu5r8sl7D0zynwXrM']);
  // Another track with no page to capture from: the old record stays whole.
  player.setTrack(track('bbbbbbbbbbb', 5));
  assert.equal(player.resumePoint().videoId, 'aaaaaaaaaaa');
});
