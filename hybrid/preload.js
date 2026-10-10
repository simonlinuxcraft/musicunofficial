'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('hybrid', {
  browse: (id) => ipcRenderer.invoke('hybrid:browse', id),
  search: (query) => ipcRenderer.invoke('hybrid:search', query),
  more: (kind, token) => ipcRenderer.invoke('hybrid:more', kind, token),
  suggest: (input) => ipcRenderer.invoke('hybrid:suggest', input),
  navigate: (endpoint) => ipcRenderer.invoke('hybrid:navigate', endpoint),
  lyrics: (videoId) => ipcRenderer.invoke('hybrid:lyrics', videoId),
  queueAdd: (target, position) => ipcRenderer.invoke('hybrid:queue-add', target, position),
  playlists: (videoId) => ipcRenderer.invoke('hybrid:playlists', videoId),
  playlistAdd: (playlistId, videoId) => ipcRenderer.invoke('hybrid:playlist-add', playlistId, videoId),
  nowLinks: () => ipcRenderer.invoke('hybrid:now-links'),
  controls: () => ipcRenderer.invoke('hybrid:controls'),
  control: (action, arg) => ipcRenderer.invoke('hybrid:control', action, arg),
  queue: () => ipcRenderer.invoke('hybrid:queue'),
  queuePlay: (index, videoId) => ipcRenderer.invoke('hybrid:queue-play', index, videoId),
  showPlayer: () => ipcRenderer.send('hybrid:show-player'),
  onTrack: (cb) => ipcRenderer.on('track:update', (_e, track) => cb(track)),
  request: () => ipcRenderer.send('track:request'),
  command: (cmd, arg) => ipcRenderer.send('track:command', cmd, arg),
  window: (action) => ipcRenderer.send('hybrid:window', action),
  onMaximized: (cb) => ipcRenderer.on('hybrid:maximized', (_e, value) => cb(value)),
  onPlayerReady: (cb) => ipcRenderer.on('hybrid:player-ready', () => cb()),
});
