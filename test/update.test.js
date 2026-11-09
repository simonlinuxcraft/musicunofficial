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

// A release `tag` whose asset serves `body` and claims the sha256 of `claimed`.
let tag = 'v0.0.7';
let body = '';
let claimed = '';
let downloads = 0;
// Serves `body`, then holds the connection open without sending more.
let stall = false;
process.env.MUSICUNOFFICIAL_UPDATE_IDLE_MS = '200';
process.env.MUSICUNOFFICIAL_UPDATE_URL = 'https://example.invalid/releases/latest';
stub('electron', {
  app: { isPackaged: false, getVersion: () => '0.0.6', getPath: () => dir },
  net: {
    fetch: async (url) => {
      if (url.includes('/releases/')) {
        const digest = 'sha256:' + crypto.createHash('sha256').update(claimed).digest('hex');
        const assets = claimed ? [{ name: 'musicunofficial_0.0.7_amd64.deb', digest, size: claimed.length, browser_download_url: 'https://example.invalid/a' }] : [];
        return Response.json({ tag_name: tag, assets });
      }
      downloads++;
      if (!stall) return new Response(body);
      return new Response(new ReadableStream({ start: (c) => c.enqueue(new TextEncoder().encode(body)) }));
    },
  },
});
const update = require('../src/update');
const { isNewer } = require('../src/pure');

const events = [];
update.start((event, data) => events.push([event, data]));

test('only a plain higher x.y.z counts as newer', () => {
  assert.ok(isNewer('0.0.7', '0.0.6'));
  assert.ok(isNewer('0.1.0', '0.0.9'));
  assert.ok(isNewer('1.0.0', '0.10.10'));
  assert.ok(!isNewer('0.0.6', '0.0.6'));
  assert.ok(!isNewer('0.0.5', '0.0.6'));
  assert.ok(!isNewer('0.0.7-beta', '0.0.6'));
  assert.ok(!isNewer('', '0.0.6'));
});

test('the check tells current, error and available apart without downloading', async () => {
  tag = 'v0.0.6';
  assert.equal(await update.check(), 'current');
  tag = 'v0.0.7';
  assert.equal(await update.check(), 'error');
  claimed = 'new';
  const both = await Promise.all([update.check(), update.check()]);
  assert.deepEqual(both, ['available', 'available']);
  assert.equal(update.state().available, '0.0.7');
  assert.equal(downloads, 0);
});

test('a download with the wrong checksum is dropped', async () => {
  body = 'tampered';
  await assert.rejects(update.download(), /checksum mismatch/);
  assert.equal(downloads, 1);
  assert.ok(!fs.existsSync(deb));
  assert.ok(!fs.existsSync(deb + '.part'));
  assert.equal(update.state().progress, null);
});

test('a verified package is kept and the bar went from 0 to 1', async () => {
  body = 'new';
  events.length = 0;
  await update.download();
  assert.equal(fs.readFileSync(deb, 'utf8'), 'new');
  assert.equal(fs.statSync(deb).mode & 0o077, 0);
  const bar = events.filter(([e]) => e === 'progress').map(([, v]) => v);
  assert.equal(bar[0], 0);
  assert.equal(bar[bar.length - 1], 1);
  assert.ok(bar.every((v, i) => i === 0 || v >= bar[i - 1]));
  downloads = 0;
  await update.download();
  assert.equal(downloads, 0);
  fs.rmSync(deb);
  await update.download();
  assert.equal(downloads, 1);
  assert.ok(fs.existsSync(deb));
});

test('a download that stops sending gives up and leaves no part file', async () => {
  fs.rmSync(deb, { force: true });
  stall = true;
  try {
    await assert.rejects(update.download(), /no data/);
  } finally {
    stall = false;
  }
  assert.ok(!fs.existsSync(deb));
  assert.ok(!fs.existsSync(deb + '.part'));
});

test('a release that is no longer newer clears the offer', async () => {
  tag = 'v0.0.6';
  assert.equal(await update.check(), 'current');
  assert.equal(update.state().available, null);
  assert.equal(await update.install(), false);
});
