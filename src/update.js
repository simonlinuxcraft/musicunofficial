'use strict';

// Self-update of the deb package from the newest GitHub release. The package is
// downloaded and checked here. Installing needs root, so the helper the package
// ships runs dpkg through pkexec, and the desktop asks for the password.

const { app, net } = require('electron');
const { execFile, spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');
const { isNewer } = require('./pure');

const LATEST = process.env.MUSICUNOFFICIAL_UPDATE_URL || 'https://api.github.com/repos/simonlinuxcraft/musicunofficial/releases/latest';
const FIRST_CHECK = 60 * 1000;
// Waits until this process, and its single-instance lock, is gone, then starts the new build.
const RELAUNCH = 'while kill -0 "$1" 2>/dev/null; do sleep 0.2; done; exec "$2"';
const EVERY = 6 * 3600 * 1000;
const LOOKUP_MS = 30 * 1000;
const DOWNLOAD_MS = 30 * 60 * 1000;

let on = false;
let busy = false;
let ready = null;
let file = null;
let digest = null;
let onReady = () => {};

const log = (msg) => console.log('[update] ' + msg);

// Where the deb puts the app; the polkit policy names the helper by this path.
const INSTALLED = '/opt/MusicUnofficial';

async function check() {
  if (busy || ready) return;
  busy = true;
  let part = null;
  try {
    const res = await net.fetch(LATEST, { headers: { Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(LOOKUP_MS) });
    if (!res.ok) throw new Error('release lookup: HTTP ' + res.status);
    const rel = await res.json();
    const version = String(rel.tag_name || '').replace(/^v/, '');
    if (!isNewer(version, app.getVersion())) return;
    const name = 'musicunofficial_' + version + '_amd64.deb';
    const asset = (Array.isArray(rel.assets) ? rel.assets : []).find((a) => a && a.name === name);
    const sha = /^sha256:([0-9a-f]{64})$/.exec((asset && asset.digest) || '')?.[1];
    if (!sha) throw new Error(version + ': no ' + name + ' with a sha256 digest in the release');
    const dest = path.join(app.getPath('temp'), name);
    part = dest + '.part';
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
      fs.createWriteStream(part, { mode: 0o600 })
    );
    if (hash.digest('hex') !== sha) throw new Error(version + ': checksum mismatch');
    fs.renameSync(part, dest);
    file = dest;
    digest = sha;
    ready = version;
    log(version + ' downloaded, ready to install');
    onReady(version);
  } catch (e) {
    if (part) fs.rmSync(part, { force: true });
    log(e.message);
  } finally {
    busy = false;
  }
}

// Only the installed deb; a development run or an unpacked build updates its own way.
function start(cb) {
  if (!app.isPackaged || path.dirname(process.execPath) !== INSTALLED) return;
  on = true;
  onReady = cb;
  setTimeout(check, FIRST_CHECK).unref();
  setInterval(check, EVERY).unref();
}

// false when the password prompt was cancelled or dpkg failed; the update stays ready for another try.
function install() {
  if (!ready) return Promise.resolve(false);
  const helper = path.join(INSTALLED, 'resources', 'update-helper');
  // The wrapper, not process.execPath: it adds the sandbox and Wayland switches.
  const launcher = path.join(INSTALLED, 'musicunofficial');
  return new Promise((done) => {
    execFile('pkexec', [helper, file, digest], (err, stdout, stderr) => {
      if (err) {
        log('install: ' + (String(stderr).trim().split('\n').pop() || err.message));
        return done(false);
      }
      log(ready + ' installed, restarting');
      spawn('/bin/sh', ['-c', RELAUNCH, 'sh', String(process.pid), launcher], { detached: true, stdio: 'ignore' }).unref();
      done(true);
      app.quit();
    });
  });
}

module.exports = {
  start,
  check,
  install,
  state: () => ({ version: app.getVersion(), on, ready }),
};
