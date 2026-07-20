'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('windowControls', {
  minimize: () => ipcRenderer.send('window:minimize'),
  toggleMaximize: () => ipcRenderer.send('window:toggle-maximize'),
  close: () => ipcRenderer.send('window:close'),
  openMini: () => ipcRenderer.send('mini:open'),
  onMaximized: (cb) => ipcRenderer.on('window:maximized', (_e, value) => cb(value)),
});

contextBridge.exposeInMainWorld('nowPlaying', {
  report: (track) => ipcRenderer.send('nowplaying:update', track),
  onCommand: (cb) => ipcRenderer.on('player:command', (_e, cmd) => cb(cmd)),
  onActive: (cb) => ipcRenderer.on('nowplaying:active', (_e, on) => cb(on)),
});
