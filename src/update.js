'use strict';

// Self-update of the AppImage from the newest GitHub release. The new file
// replaces the old one under the same name, so desktop entries keep working;
// the running copy keeps its open file and the next start runs the new one.

const { app, net } = require('electron');
const { spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');
const { isNewer } = require('./pure');

const LATEST = process.env.MUSICUNOFFICIAL_UPDATE_URL || 'https://api.github.com/repos/simonlinuxcraft/musicunofficial/releases/latest';
const FIRST_CHECK = 60 * 1000;
const EVERY = 6 * 3600 * 1000;
const LOOKUP_MS = 30 * 1000;
const DOWNLOAD_MS = 30 * 60 * 1000;

const file = process.env.APPIMAGE;
let on = false;
let busy = false;
let ready = null;
let onReady = () => {};

const log = (msg) => console.log('[update] ' + msg);

function writable() {
  try {
    fs.accessSync(path.dirname(file), fs.constants.W_OK);
    fs.accessSync(file, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

async function check() {
  if (busy || ready) return;
  busy = true;
  // Next to the file, so the final rename stays on one filesystem.
  const part = file + '.part';
  try {
    const res = await net.fetch(LATEST, { headers: { Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(LOOKUP_MS) });
    if (!res.ok) throw new Error('release lookup: HTTP ' + res.status);
    const rel = await res.json();
    const version = String(rel.tag_name || '').replace(/^v/, '');
    if (!isNewer(version, app.getVersion())) return;
    const asset = (Array.isArray(rel.assets) ? rel.assets : []).find((a) => a && a.name === 'MusicUnofficial-' + version + '.AppImage');
    const sha = /^sha256:([0-9a-f]{64})$/.exec((asset && asset.digest) || '')?.[1];
    if (!sha) throw new Error(version + ': no AppImage with a sha256 digest in the release');
    const dl = await net.fetch(asset.browser_download_url, { signal: AbortSignal.timeout(DOWNLOAD_MS) });
    if (!dl.ok || !dl.body) throw new Error('download: HTTP ' + dl.status);
    const hash = crypto.createHash('sha256');
    await pipeline(
      Readable.fromWeb(dl.body),
      async function* (chunks) {
        for await (const c of chunks) {
          hash.update(c);
          yield c;
        }
      },
      fs.createWriteStream(part)
    );
    if (hash.digest('hex') !== sha) throw new Error(version + ': checksum mismatch');
    fs.chmodSync(part, 0o755);
    fs.renameSync(part, file);
    ready = version;
    log(version + ' installed, runs from the next start');
    onReady(version);
  } catch (e) {
    fs.rmSync(part, { force: true });
    log(e.message);
  } finally {
    busy = false;
  }
}

// Only a packaged AppImage in a folder the user can write to; other installs update their own way.
function start(cb) {
  if (!app.isPackaged || !file || !writable()) return;
  on = true;
  onReady = cb;
  setTimeout(check, FIRST_CHECK).unref();
  setInterval(check, EVERY).unref();
}

// app.relaunch never brought the AppImage back: its helper runs from this copy's
// mount. A host shell waits until this process, and its single-instance lock, is gone.
function restart() {
  if (!ready) return;
  spawn('/bin/sh', ['-c', 'while kill -0 "$1" 2>/dev/null; do sleep 0.2; done; exec "$2"', 'sh', String(process.pid), file], { detached: true, stdio: 'ignore' }).unref();
  app.quit();
}

module.exports = {
  start,
  check,
  restart,
  state: () => ({ version: app.getVersion(), on, ready }),
};
