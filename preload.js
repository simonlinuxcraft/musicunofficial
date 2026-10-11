'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('nowPlaying', {
  report: (track) => ipcRenderer.send('nowplaying:update', track),
  onCommand: (cb) => ipcRenderer.on('player:command', (_e, cmd, arg) => cb(cmd, arg)),
  onActive: (cb) => ipcRenderer.on('nowplaying:active', (_e, on) => cb(on)),
});
