'use strict';

const { test, after } = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const stub = require('./stub');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'musicunofficial-update-'));
after(() => fs.rmSync(dir, { recursive: true, force: true }));
const deb = path.join(dir, 'musicunofficial_0.0.7_amd64.deb');

// A release whose asset serves `body` and claims the sha256 of `claimed`.
let body = '';
let claimed = '';
let downloads = 0;
stub('electron', {
  app: { isPackaged: true, getVersion: () => '0.0.6', getPath: () => dir },
  net: {
    fetch: async (url) => {
      if (url.includes('/releases/')) {
        const digest = 'sha256:' + crypto.createHash('sha256').update(claimed).digest('hex');
        return Response.json({ tag_name: 'v0.0.7', assets: [{ name: 'musicunofficial_0.0.7_amd64.deb', digest, browser_download_url: 'https://example.invalid/a' }] });
      }
      downloads++;
      return new Response(body);
    },
  },
});
const update = require('../src/update');
const { isNewer } = require('../src/pure');

test('only a plain higher x.y.z counts as newer', () => {
  assert.ok(isNewer('0.0.7', '0.0.6'));
  assert.ok(isNewer('0.1.0', '0.0.9'));
  assert.ok(isNewer('1.0.0', '0.10.10'));
  assert.ok(!isNewer('0.0.6', '0.0.6'));
  assert.ok(!isNewer('0.0.5', '0.0.6'));
  assert.ok(!isNewer('0.0.7-beta', '0.0.6'));
  assert.ok(!isNewer('', '0.0.6'));
});

test('a download with the wrong checksum is dropped', async () => {
  body = 'tampered';
  claimed = 'new';
  await update.check();
  assert.equal(downloads, 1);
  assert.ok(!fs.existsSync(deb));
  assert.ok(!fs.existsSync(deb + '.part'));
  assert.equal(update.state().ready, null);
});

test('a verified package waits for the install', async () => {
  body = claimed = 'new';
  await update.check();
  assert.equal(fs.readFileSync(deb, 'utf8'), 'new');
  assert.equal(fs.statSync(deb).mode & 0o077, 0);
  assert.equal(update.state().ready, '0.0.7');
});
