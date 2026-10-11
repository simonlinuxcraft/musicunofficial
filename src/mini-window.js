'use strict';

const { app, BrowserWindow, ipcMain, screen } = require('electron');
const path = require('path');
const store = require('./store');
const player = require('./player');
// The own interface, which the mini player stands in for.
const front = require('./hybrid-window');
const { APP_TITLE } = require('./pure');

const ROOT = path.join(__dirname, '..');
const SIZE = { width: 344, height: 104 };

let mini = null;
let saveTimer = null;

const alive = () => !!mini && !mini.isDestroyed();

function saveBounds() {
  clearTimeout(saveTimer);
  if (!alive()) return;
  const { x, y } = mini.getBounds();
  store.settings.miniBounds = { x, y };
  store.saveSettings();
}

// moved fires continuously while dragging, and the write is synchronous.
function scheduleSaveBounds() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveBounds, 400);
}

// A saved spot on a monitor that is no longer connected falls back to the default corner.
function startBounds() {
  const b = store.settings.miniBounds;
  if (b && Number.isInteger(b.x) && Number.isInteger(b.y)) {
    const fits = screen.getAllDisplays().some(({ workArea: a }) => {
      return b.x >= a.x - 50 && b.y >= a.y - 50 && b.x < a.x + a.width - 50 && b.y < a.y + a.height - 50;
    });
    if (fits) return { x: b.x, y: b.y };
  }
  const a = screen.getPrimaryDisplay().workArea;
  return { x: a.x + a.width - SIZE.width - 24, y: a.y + a.height - SIZE.height - 24 };
}

function open() {
  if (alive()) {
    mini.show();
    mini.focus();
    return;
  }
  mini = new BrowserWindow({
    ...SIZE,
    ...startBounds(),
    frame: false,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    backgroundColor: '#0f0f0f',
    show: false,
    title: APP_TITLE,
    icon: path.join(ROOT, 'icon.png'),
    webPreferences: {
      preload: path.join(ROOT, 'mini', 'preload.js'),
    },
  });
  mini.setMenuBarVisibility(false);
  mini.loadFile(path.join(ROOT, 'mini', 'index.html'));
  mini.once('ready-to-show', () => {
    mini.show();
    front.hide();
  });
  player.sync();

  mini.on('moved', scheduleSaveBounds);
  // close, not closed: the bounds are unreadable once the window is gone.
  mini.on('close', saveBounds);
  // Covers Alt+F4 and the window manager's close too, otherwise the hidden main window has no way back.
  mini.on('closed', () => {
    mini = null;
    player.sync();
    front.show();
  });
}

function close() {
  if (alive()) mini.close();
}

function destroy() {
  if (alive()) mini.destroy();
}

ipcMain.on('mini:restore', () => {
  front.show();
  close();
});
ipcMain.on('mini:quit', () => app.quit());

module.exports = {
  open,
  close,
  destroy,
  saveBounds,
  isOpen: alive,
  reload: () => alive() && mini.webContents.reload(),
  webContents: () => (alive() ? mini.webContents : null),
};
