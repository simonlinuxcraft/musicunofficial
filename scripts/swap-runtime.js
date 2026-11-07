'use strict';

// electron-builder embeds the old AppImageKit runtime, which dlopens
// libfuse.so.2. Ubuntu 22.04+, Debian 12 and Fedora stopped shipping that, so
// the app dies before it starts with "dlopen(): error loading libfuse.so.2".
//
// vendor/runtime-x86_64 is the modern type2-runtime: static-pie linked with
// libfuse built in, and it falls back to extract-and-run when it cannot mount.
// An AppImage is just [runtime][squashfs], so swapping the front half is
// enough. The runtime locates the payload at the end of its own ELF.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const RUNTIME = path.join(ROOT, 'vendor', 'runtime-x86_64');
const DIST = process.argv[2] || path.join(ROOT, 'dist');

function payloadOffset(file) {
  // LC_ALL=C: readelf translates its field labels, and this parses them.
  const out = execFileSync('readelf', ['-h', file], {
    encoding: 'utf8',
    env: { ...process.env, LC_ALL: 'C' },
  });
  const num = (label) => {
    const m = out.match(new RegExp(label + ':\\s+(\\d+)'));
    if (!m) throw new Error('could not read "' + label + '" from ' + file);
    return parseInt(m[1], 10);
  };
  // Standard AppImage rule: the squashfs starts right behind the section headers.
  return num('Start of section headers') + num('Size of section headers') * num('Number of section headers');
}

const images = fs.readdirSync(DIST).filter((f) => f.endsWith('.AppImage'));
if (!images.length) throw new Error('no .AppImage in ' + DIST);

for (const name of images) {
  const file = path.join(DIST, name);
  const offset = payloadOffset(file);
  const whole = fs.readFileSync(file);
  const squashfs = whole.subarray(offset);

  // Sanity check before overwriting: squashfs little-endian magic is "hsqs".
  const magic = squashfs.subarray(0, 4).toString('latin1');
  if (magic !== 'hsqs') {
    throw new Error(`${name}: expected squashfs at offset ${offset}, found "${magic}"`);
  }

  fs.writeFileSync(file, Buffer.concat([fs.readFileSync(RUNTIME), squashfs]));
  fs.chmodSync(file, 0o755);
  console.log(`${name}: runtime swapped (payload was at ${offset}, ${squashfs.length} bytes kept)`);
}
