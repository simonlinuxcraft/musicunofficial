'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { createPresence, encodeFrame, decodeFrames, socketPaths } = require('../src/discord');

test('round-trips a frame', () => {
  const buf = encodeFrame(0, { v: 1, client_id: '123' });
  const { frames, rest } = decodeFrames(buf);
  assert.equal(frames.length, 1);
  assert.equal(frames[0].op, 0);
  assert.deepEqual(frames[0].data, { v: 1, client_id: '123' });
  assert.equal(rest.length, 0);
});

test('holds back a frame that arrived in pieces', () => {
  const buf = encodeFrame(1, { cmd: 'SET_ACTIVITY' });
  const cut = decodeFrames(buf.subarray(0, buf.length - 4));
  assert.equal(cut.frames.length, 0);
  assert.equal(cut.rest.length, buf.length - 4);

  const whole = decodeFrames(Buffer.concat([cut.rest, buf.subarray(buf.length - 4)]));
  assert.equal(whole.frames.length, 1);
  assert.equal(whole.frames[0].data.cmd, 'SET_ACTIVITY');
});

test('splits two frames that arrived glued together', () => {
  const buf = Buffer.concat([encodeFrame(3, { a: 1 }), encodeFrame(4, { b: 2 })]);
  const { frames, rest } = decodeFrames(buf);
  assert.equal(frames.length, 2);
  assert.equal(frames[0].op, 3);
  assert.equal(frames[1].op, 4);
  assert.equal(rest.length, 0);
});

test('gives up on a bogus length instead of allocating for it', () => {
  const head = Buffer.alloc(8);
  head.writeInt32LE(1, 0);
  head.writeInt32LE(-99, 4);
  assert.deepEqual(decodeFrames(head), { frames: [], rest: Buffer.alloc(0) });
});

test('survives a payload that is not JSON', () => {
  const body = Buffer.from('<html>not json</html>');
  const head = Buffer.alloc(8);
  head.writeInt32LE(1, 0);
  head.writeInt32LE(body.length, 4);
  const { frames } = decodeFrames(Buffer.concat([head, body]));
  assert.equal(frames.length, 1);
  assert.equal(frames[0].data, null);
});

test('looks in the flatpak and snap locations too', () => {
  const paths = socketPaths({ XDG_RUNTIME_DIR: '/run/user/1000' });
  assert.ok(paths.includes('/run/user/1000/discord-ipc-0'));
  assert.ok(paths.includes('/run/user/1000/snap.discord/discord-ipc-0'));
  assert.ok(paths.includes('/run/user/1000/app/com.discordapp.Discord/discord-ipc-0'));
  assert.ok(paths.includes('/run/user/1000/discord-ipc-9'));
});

test('keeps reconnecting after a refusal and clears a rejected activity once', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ipc-'));
  process.env.XDG_RUNTIME_DIR = dir;
  const seen = [];
  let conns = 0;
  const server = net.createServer((c) => {
    const n = ++conns;
    let buf = Buffer.alloc(0);
    c.on('data', (chunk) => {
      const out = decodeFrames(Buffer.concat([buf, chunk]));
      buf = out.rest;
      for (const f of out.frames) {
        if (f.op === 0 && n === 1) c.end(encodeFrame(2, { code: 4000, message: 'Invalid Client ID' }));
        else if (f.op === 0) c.write(encodeFrame(1, { evt: 'READY' }));
        else if (f.data.cmd === 'SET_ACTIVITY') {
          seen.push(f.data.args.activity);
          c.write(encodeFrame(1, { cmd: 'SET_ACTIVITY', evt: 'ERROR', nonce: f.data.nonce, data: { code: 4000 } }));
        }
      }
    });
  });
  await new Promise((r) => server.listen(path.join(dir, 'discord-ipc-0'), r));

  let readyChanges = 0;
  const p = createPresence('1', () => {}, () => readyChanges++, 50);
  p.update({ title: 'A', artist: 'B', album: 'C', art: 'https://x/y.jpg', playing: true, position: 0, duration: 60, at: Date.now() });
  p.setEnabled(true);
  await new Promise((r) => setTimeout(r, 400));

  assert.equal(conns, 2);
  assert.equal(p.ready, true);
  assert.equal(readyChanges, 1);
  // The rejected activity, then one clear, and the refused clear is left alone.
  assert.equal(seen.length, 2);
  assert.equal(seen[1], undefined);
  assert.equal(seen[0].details.length, 2);
  assert.equal(seen[0].assets.large_text.length, 2);

  p.setEnabled(false);
  assert.equal(readyChanges, 2);
  await new Promise((r) => server.close(r));
  fs.rmdirSync(dir);
});
