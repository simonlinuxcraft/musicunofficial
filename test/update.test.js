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
const file = path.join(dir, 'MusicUnofficial.AppImage');
fs.writeFileSync(file, 'old');
process.env.APPIMAGE = file;

// A release whose asset serves `body` and claims the sha256 of `claimed`.
let body = '';
let claimed = '';
let downloads = 0;
stub('electron', {
  app: { isPackaged: true, getVersion: () => '0.0.6' },
  net: {
    fetch: async (url) => {
      if (url.includes('/releases/')) {
        const digest = 'sha256:' + crypto.createHash('sha256').update(claimed).digest('hex');
        return Response.json({ tag_name: 'v0.0.7', assets: [{ name: 'MusicUnofficial-0.0.7.AppImage', digest, browser_download_url: 'https://example.invalid/a' }] });
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

test('a download with the wrong checksum leaves the installed file alone', async () => {
  body = 'tampered';
  claimed = 'new';
  await update.check();
  assert.equal(downloads, 1);
  assert.equal(fs.readFileSync(file, 'utf8'), 'old');
  assert.ok(!fs.existsSync(file + '.part'));
  assert.equal(update.state().ready, null);
});

test('a verified release replaces the file under the same name', async () => {
  body = claimed = 'new';
  await update.check();
  assert.equal(fs.readFileSync(file, 'utf8'), 'new');
  assert.equal(fs.statSync(file).mode & 0o777, 0o755);
  assert.equal(update.state().ready, '0.0.7');
});
