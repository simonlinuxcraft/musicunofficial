'use strict';

// Separate from preload.js on purpose. That one is loaded into a window running
// YouTube's own code, so it only gets what that window needs.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('mini', {
  onTrack: (cb) => ipcRenderer.on('track:update', (_e, track) => cb(track)),
  request: () => ipcRenderer.send('track:request'),
  command: (cmd) => ipcRenderer.send('track:command', cmd),
  restore: () => ipcRenderer.send('mini:restore'),
  quit: () => ipcRenderer.send('mini:quit'),
});
