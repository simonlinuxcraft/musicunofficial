'use strict';

// Self-update of the deb package from the newest GitHub release. The lookup
// runs on a timer or from the settings page; the download and the install
// wait for the user's go. Installing needs root, so the helper the package
// ships runs dpkg through pkexec, and the desktop asks for the password.

const { app, net } = require('electron');
const { execFile, spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');
const { isNewer } = require('./pure');

const TEST_URL = process.env.MUSICUNOFFICIAL_UPDATE_URL;
const LATEST = TEST_URL || 'https://api.github.com/repos/simonlinuxcraft/musicunofficial/releases/latest';
const FIRST_CHECK = 60 * 1000;
// Waits until this process, and its single-instance lock, is gone, then starts the new build.
const RELAUNCH = 'while kill -0 "$1" 2>/dev/null; do sleep 0.2; done; exec "$2"';
const EVERY = 6 * 3600 * 1000;
const LOOKUP_MS = 30 * 1000;
const DOWNLOAD_MS = 30 * 60 * 1000;

// Where the deb puts the app; the polkit policy names the helper by this path.
const INSTALLED = '/opt/MusicUnofficial';

let on = false;
let lookup = null;
let available = null;
let offered = null;
let progress = null;
let running = null;
let ready = null;
let file = null;
let emit = () => false;

const log = (msg) => console.log('[update] ' + msg);

async function fetchLatest() {
  const res = await net.fetch(LATEST, { headers: { Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(LOOKUP_MS) });
  if (!res.ok) throw new Error('release lookup: HTTP ' + res.status);
  const rel = await res.json();
  const version = String(rel.tag_name || '').replace(/^v/, '');
  if (!isNewer(version, app.getVersion())) {
    available = null;
    return 'current';
  }
  const name = 'musicunofficial_' + version + '_amd64.deb';
  const asset = (Array.isArray(rel.assets) ? rel.assets : []).find((a) => a && a.name === name);
  const sha = /^sha256:([0-9a-f]{64})$/.exec((asset && asset.digest) || '')?.[1];
  if (!sha) throw new Error(version + ': no ' + name + ' with a sha256 digest in the release');
  available = { version, name, url: asset.browser_download_url, sha, size: Number(asset.size) || 0 };
  return 'available';
}

// 'available', 'current' or 'error'. One lookup at a time; a second caller shares it.
function check() {
  if (!lookup) {
    lookup = fetchLatest()
      .catch((e) => {
        log(e.message);
        return 'error';
      })
      .finally(() => {
        lookup = null;
      });
  }
  return lookup;
}

// The timer offers each version once the window has seen it; the settings button asks again.
function autoCheck() {
  check().then((result) => {
    if (result !== 'available' || offered === available.version) return;
    if (emit('available', available.version)) offered = available.version;
  });
}

// Whole percent steps only; null when the size is unknown.
function report(value) {
  if (value === progress) return;
  if (value !== null && progress !== null && Math.floor(value * 100) === Math.floor(progress * 100)) return;
  progress = value;
  emit('progress', value);
}

async function download(target) {
  const { name, url, sha, size, version } = target;
  if (ready === version && fs.existsSync(file)) return;
  ready = null;
  const dest = path.join(app.getPath('temp'), name);
  const part = dest + '.part';
  try {
    const dl = await net.fetch(url, { signal: AbortSignal.timeout(DOWNLOAD_MS) });
    if (!dl.ok || !dl.body) throw new Error('download: HTTP ' + dl.status);
    const total = Number(dl.headers.get('content-length')) || size;
    const hash = crypto.createHash('sha256');
    let got = 0;
    report(0);
    await pipeline(
      Readable.fromWeb(dl.body),
      async function* (chunks) {
        for await (const c of chunks) {
          hash.update(c);
          got += c.length;
          report(total ? Math.min(got / total, 1) : null);
          yield c;
        }
      },
      fs.createWriteStream(part, { mode: 0o600 })
    );
    if (hash.digest('hex') !== sha) throw new Error(version + ': checksum mismatch');
    fs.renameSync(part, dest);
    if (file && file !== dest) fs.rmSync(file, { force: true });
    file = dest;
    ready = version;
    report(1);
    log(version + ' downloaded');
  } catch (e) {
    fs.rmSync(part, { force: true });
    throw e;
  } finally {
    progress = null;
  }
}

function runHelper(sha) {
  const helper = path.join(INSTALLED, 'resources', 'update-helper');
  return new Promise((done, fail) => {
    execFile('pkexec', [helper, file, sha], { maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) return fail(new Error(String(stderr).trim().split('\n').pop() || err.message));
      done();
    });
  });
}

// The version on offer when the user clicked, even if the timer finds a newer one meanwhile.
async function run(target) {
  try {
    await download(target);
    emit('installing', target.version);
    await runHelper(target.sha);
  } catch (e) {
    log('install: ' + e.message);
    return false;
  }
  log(target.version + ' installed, restarting');
  fs.rmSync(file, { force: true });
  // The wrapper, not process.execPath: it adds the sandbox and Wayland switches.
  const launcher = path.join(INSTALLED, 'musicunofficial');
  spawn('/bin/sh', ['-c', RELAUNCH, 'sh', String(process.pid), launcher], { detached: true, stdio: 'ignore' }).unref();
  app.quit();
  return true;
}

// Downloads if needed, installs, restarts. false when the download failed, the
// password prompt was cancelled or dpkg failed; the next try starts over.
// A second call while one runs waits for that one.
function install() {
  if (!available) return Promise.resolve(false);
  if (!running) {
    running = run(available).finally(() => {
      running = null;
    });
  }
  return running;
}

// Only the installed deb; a development run or an unpacked build updates its
// own way. The test URL turns it on anywhere, the install then fails harmlessly.
function start(send) {
  if (!TEST_URL && (!app.isPackaged || path.dirname(process.execPath) !== INSTALLED)) return;
  on = true;
  emit = send;
  setTimeout(autoCheck, FIRST_CHECK).unref();
  setInterval(autoCheck, EVERY).unref();
}

module.exports = {
  start,
  check,
  download: () => download(available),
  install,
  state: () => ({ version: app.getVersion(), on, available: available && available.version, busy: !!running, progress }),
};
