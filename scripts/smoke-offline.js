'use strict';

// Offline start: npm run smoke:offline
// Starts the app behind a proxy that is not up yet, brings the proxy up after 12 s
// and expects the player page to load on its own. Uses the profile of npm run smoke.

const { spawn } = require('child_process');
const net = require('net');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PORT = 9334;
const PROXY = 39872;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function startProxy() {
  net
    .createServer((c) => {
      c.once('data', (buf) => {
        const m = /^CONNECT ([^:]+):(\d+)/.exec(buf.toString());
        if (!m) return c.destroy();
        const up = net.connect(Number(m[2]), m[1], () => {
          c.write('HTTP/1.1 200 OK\r\n\r\n');
          up.pipe(c);
          c.pipe(up);
        });
        up.on('error', () => c.destroy());
        c.on('error', () => up.destroy());
      });
    })
    .listen(PROXY);
}

async function playerBar() {
  const list = await (await fetch('http://127.0.0.1:' + PORT + '/json')).json();
  const t = list.find((t) => t.type === 'page' && t.url.includes('music.youtube.com'));
  if (!t) return false;
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((ok, no) => {
    ws.onopen = ok;
    ws.onerror = no;
  });
  try {
    return await new Promise((ok) => {
      ws.onmessage = (m) => {
        const d = JSON.parse(m.data);
        if (d.id === 1) ok(d.result.result.value);
      };
      const expression = "!!document.querySelector('ytmusic-player-bar')";
      ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, returnByValue: true } }));
    });
  } finally {
    ws.close();
  }
}

async function main() {
  const env = { ...process.env, XDG_CONFIG_HOME: path.join(os.tmpdir(), 'musicunofficial-smoke') };
  delete env.ELECTRON_RUN_AS_NODE;
  const electron = require(path.join(ROOT, 'node_modules', 'electron'));
  const args = ['.', '--ozone-platform-hint=auto', '--remote-debugging-port=' + PORT, '--proxy-server=http://127.0.0.1:' + PROXY];
  const app = spawn(electron, args, { cwd: ROOT, env, stdio: 'ignore' });
  let ok = false;
  try {
    await sleep(12000);
    if (await playerBar().catch(() => false)) throw new Error('page loaded without a network');
    startProxy();
    for (let i = 1; i <= 40 && !ok; i++) {
      await sleep(1000);
      ok = await playerBar().catch(() => false);
      if (ok) console.log('PASS page loaded ' + i + ' s after the network came back');
    }
    if (!ok) console.log('FAIL page did not load after the network came back');
  } finally {
    app.kill('SIGTERM');
    await sleep(2000);
  }
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.log('FAIL ' + e.message);
  process.exit(1);
});
