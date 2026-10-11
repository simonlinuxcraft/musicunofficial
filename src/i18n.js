'use strict';

const { app, ipcMain } = require('electron');
const store = require('./store');

// The saved choice, or the system's language when it is German.
function uiLanguage() {
  const s = store.settings.language;
  if (s === 'de' || s === 'en') return s;
  return app.getLocale().toLowerCase().startsWith('de') ? 'de' : 'en';
}

// Synchronous on purpose: the preloads need it before the first paint.
ipcMain.on('ui:language', (e) => {
  e.returnValue = uiLanguage();
});

module.exports = { uiLanguage };
