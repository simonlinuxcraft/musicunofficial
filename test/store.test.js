'use strict';

const { test, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'musicunofficial-store-'));
after(() => fs.rmSync(dir, { recursive: true, force: true }));
require('./stub')('electron', { app: { getPath: () => dir } });
const store = require('../src/store');

test('writes the settings whole, through a temp file that does not stay', () => {
  store.settings.uiZoom = 1;
  store.saveSettings();
  assert.deepEqual(fs.readdirSync(dir), ['settings.json']);
  assert.equal(store.read('settings.json').uiZoom, 1);
});

test('reads a half written file as none instead of throwing', () => {
  fs.writeFileSync(path.join(dir, 'settings.json'), '{"uiZoom": 1, "las');
  assert.equal(store.read('settings.json'), null);
});
