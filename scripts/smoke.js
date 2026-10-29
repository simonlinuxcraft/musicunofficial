'use strict';

// End-to-end check of a dev build: npm run smoke
//
// Starts the app with a profile of its own under the temp
// directory, so the installed app and its sign-in stay untouched, and drives it
// over the DevTools protocol and D-Bus: the UI loads, MPRIS registers, a track
// plays (muted), MPRIS pauses it, the queue fills, and the app quits.
// The profile is kept between runs so the consent page only shows the first time.

const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.SMOKE_PORT) || 9333;
const PROFILE = path.join(os.tmpdir(), 'musicunofficial-smoke');
const MPRIS = 'org.mpris.MediaPlayer2.musicunofficial';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failed = 0;
function report(ok, name, detail = '') {
  if (!ok) failed++;
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  (' + detail + ')' : ''));
}

async function until(fn, ms, step = 500) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      const v = await fn();
      if (v) return v;
    } catch {}
    await sleep(step);
  }
  return null;
}

async function target(match) {
  const list = await (await fetch('http://127.0.0.1:' + PORT + '/json')).json();
  return list.find((t) => t.type === 'page' && t.url.includes(match)) || null;
}

// One Runtime.evaluate over a short-lived DevTools connection.
async function evaluate(match, expression) {
  const t = await target(match);
  if (!t) throw new Error('no page ' + match);
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((ok, no) => {
    ws.onopen = ok;
    ws.onerror = no;
  });
  try {
    return await new Promise((ok, no) => {
      ws.onmessage = (m) => {
        const d = JSON.parse(m.data);
        if (d.id !== 1) return;
        if (d.result.exceptionDetails) no(new Error(d.result.exceptionDetails.text));
        else ok(d.result.result.value);
      };
      ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }));
    });
  } finally {
    ws.close();
  }
}

function gdbus(...args) {
  return execFileSync('gdbus', ['call', '--session', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
}

// The name the started copy holds. With the installed app running, that one owns
// the plain name and this copy takes an instance name; talking to the plain name
// would pause and quit the user's own player.
let bus = null;
function ownName(pid) {
  for (const name of [MPRIS, MPRIS + '.instance' + pid]) {
    try {
      const owner = gdbus('--dest', 'org.freedesktop.DBus', '--object-path', '/org/freedesktop/DBus', '--method', 'org.freedesktop.DBus.GetConnectionUnixProcessID', name);
      // The reply reads (uint32 <pid>,); the first number in it is the 32 of the type.
      if (Number((owner.match(/\d+/g) || []).pop()) === pid) return name;
    } catch {}
  }
  return null;
}
const mpris = (method) => gdbus('--dest', bus, '--object-path', '/org/mpris/MediaPlayer2', '--method', method);
const mprisGet = (prop) =>
  gdbus('--dest', bus, '--object-path', '/org/mpris/MediaPlayer2', '--method', 'org.freedesktop.DBus.Properties.Get', 'org.mpris.MediaPlayer2.Player', prop);

async function main() {
  fs.mkdirSync(PROFILE, { recursive: true });
  const env = { ...process.env, XDG_CONFIG_HOME: PROFILE };
  delete env.ELECTRON_RUN_AS_NODE;
  const electron = require(path.join(ROOT, 'node_modules', 'electron'));
  const app = spawn(electron, ['.', '--no-sandbox', '--ozone-platform-hint=auto', '--remote-debugging-port=' + PORT], {
    cwd: ROOT,
    env,
    stdio: 'ignore',
  });
  const exited = new Promise((r) => app.once('exit', r));

  try {
    // A fresh profile meets Google's consent page first; reject all, as a careful user would.
    const loaded = await until(async () => {
      if (await target('consent.')) {
        await evaluate('consent.', "(() => { const b = [...document.querySelectorAll('button')].find((x) => /Alle ablehnen|Reject all/.test(x.textContent)); if (b) b.click(); return 0; })()");
        return 0;
      }
      return evaluate('hybrid/index.html', "document.querySelectorAll('.tile, .item').length");
    }, 90000, 1000);
    report(!!loaded, 'hybrid UI loads its home page', loaded ? loaded + ' entries' : 'nothing after 90 s');

    bus = await until(() => ownName(app.pid), 10000);
    report(!!bus, 'MPRIS player registered', bus || 'no name owned by this copy');

    await evaluate('music.youtube.com', "document.getElementById('movie_player').mute(), 1");
    await evaluate('hybrid/index.html', "window.hybrid.navigate({ watchEndpoint: { videoId: 'iNjGNNoUjkk' } }), 1");
    // Ads come first on a profile that is not signed in.
    const playing = await until(
      () => evaluate('music.youtube.com', "(() => { const p = document.getElementById('movie_player'); return !p.classList.contains('ad-showing') && p.getPlayerState() === 1; })()"),
      90000,
      1000
    );
    const shown = await until(() => evaluate('hybrid/index.html', "document.body.classList.contains('playing') && document.getElementById('title').textContent"), 10000);
    report(!!(playing && shown), 'a track plays and the player bar shows it', shown || '');

    if (bus) {
      mpris('org.mpris.MediaPlayer2.Player.Pause');
      const paused = await until(() => /Paused/.test(mprisGet('PlaybackStatus')) && evaluate('hybrid/index.html', "!document.body.classList.contains('playing')"), 10000);
      report(!!paused, 'MPRIS Pause reaches the page and the UI');
    }

    await evaluate('hybrid/index.html', "document.getElementById('queue-toggle').click(), 1");
    const rows = await until(() => evaluate('hybrid/index.html', "document.querySelectorAll('.qrow').length"), 15000);
    report(!!rows, 'up next lists the queue', rows ? rows + ' rows' : '');

    // Skipping clicks the page's own button, which YouTube moves between layouts.
    if (bus) {
      const id = "document.getElementById('movie_player').getVideoData().video_id";
      const before = await evaluate('music.youtube.com', id);
      mpris('org.mpris.MediaPlayer2.Player.Next');
      const after = await until(async () => {
        const now = await evaluate('music.youtube.com', id);
        return now && now !== before && now;
      }, 20000);
      report(!!after, 'MPRIS Next skips to another track', after || 'still ' + before);
    }
  } catch (e) {
    report(false, 'run', e.message);
  }

  // Quit through its own MPRIS name, so it saves state as on a normal quit.
  try {
    if (!bus) throw new Error('no bus');
    mpris('org.mpris.MediaPlayer2.Quit');
  } catch {
    app.kill();
  }
  const quit = await Promise.race([exited.then(() => true), sleep(20000).then(() => false)]);
  report(quit, 'app quits');
  if (!quit) app.kill('SIGKILL');
  console.log(failed ? failed + ' check(s) failed' : 'all checks passed');
  process.exit(failed ? 1 : 0);
}

main();
