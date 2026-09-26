'use strict';

const { app } = require('electron');
const fs = require('fs');
const path = require('path');

const file = (name) => path.join(app.getPath('userData'), name);

function read(name) {
  try {
    return JSON.parse(fs.readFileSync(file(name), 'utf8'));
  } catch {
    return null;
  }
}

function write(name, value) {
  try {
    fs.writeFileSync(file(name), JSON.stringify(value));
  } catch {}
}

const settings = { discord: false, miniBounds: null };

function loadSettings() {
  const s = read('settings.json');
  if (s && typeof s === 'object') Object.assign(settings, s);
}

function saveSettings() {
  write('settings.json', settings);
}

module.exports = { read, write, settings, loadSettings, saveSettings };
