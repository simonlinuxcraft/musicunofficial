'use strict';

// Start at login through an XDG autostart entry, which every desktop reads.
// Only for the installed package: the entry has to name a launcher that stays put.

const { app } = require('electron');
const fs = require('fs');
const path = require('path');
const { autostartEntry, autostartMode } = require('./pure');

const LAUNCHER = '/opt/MusicUnofficial/musicunofficial';
const file = () => path.join(app.getPath('appData'), 'autostart', 'musicunofficial.desktop');

// 'off', 'on' or 'tray'; null where the app is not installed and the setting is not offered.
function get() {
  if (!fs.existsSync(LAUNCHER)) return null;
  try {
    return autostartMode(fs.readFileSync(file(), 'utf8'));
  } catch {
    return 'off';
  }
}

function set(mode) {
  if (get() === null) return;
  try {
    if (mode === 'off') return fs.rmSync(file(), { force: true });
    fs.mkdirSync(path.dirname(file()), { recursive: true });
    fs.writeFileSync(file(), autostartEntry(LAUNCHER, mode));
  } catch (e) {
    console.log('[autostart] ' + e.message);
  }
}

module.exports = { get, set };
