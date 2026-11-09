'use strict';

const { app } = require('electron');
const fs = require('fs');
const path = require('path');

const file = (name) => path.join(app.getPath('userData'), name);

// An unreadable file is moved aside, so the next write does not wipe what is left in it.
function read(name) {
  const f = file(name);
  try {
    return JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    console.log('[store] ' + name + ' unreadable, kept as ' + name + '.broken: ' + e.message);
    try {
      fs.renameSync(f, f + '.broken');
    } catch {}
    return null;
  }
}

// Through a temp file: a crash mid-write would leave half a file, and read() would drop all settings.
function write(name, value) {
  const f = file(name);
  try {
    fs.writeFileSync(f + '.tmp', JSON.stringify(value));
    fs.renameSync(f + '.tmp', f);
  } catch (e) {
    console.log('[store] ' + name + ': ' + e.message);
  }
}

// richPresence replaces "discord", which an old bug switched off by itself.
const settings = { richPresence: true, miniBounds: null };

function loadSettings() {
  const s = read('settings.json');
  if (s && typeof s === 'object') Object.assign(settings, s);
}

function saveSettings() {
  write('settings.json', settings);
}

module.exports = { read, write, settings, loadSettings, saveSettings };
