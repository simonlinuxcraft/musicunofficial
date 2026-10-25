'use strict';

// The shortcuts the own interface and the player page both answer to. Each keeps
// its zoom level under its own settings key, so it survives a restart.

const { app } = require('electron');
const store = require('./store');
const { keyAction } = require('./pure');

function bindKeys(wc, zoomKey, openMini) {
  const zoom = () => (Number.isFinite(store.settings[zoomKey]) ? store.settings[zoomKey] : 0);
  const setZoom = (level) => {
    store.settings[zoomKey] = Math.min(5, Math.max(-5, level));
    store.saveSettings();
    wc.setZoomLevel(store.settings[zoomKey]);
  };
  // A new document starts at the default level.
  wc.on('did-navigate', () => wc.setZoomLevel(zoom()));
  wc.on('before-input-event', (e, input) => {
    const action = keyAction(input);
    if (!action) return;
    e.preventDefault();
    if (action === 'quit') app.quit();
    else if (action === 'reload') wc.reload();
    else if (action === 'mini') openMini();
    else if (action === 'zoom-in') setZoom(zoom() + 0.5);
    else if (action === 'zoom-out') setZoom(zoom() - 0.5);
    else if (action === 'zoom-reset') setZoom(0);
  });
}

module.exports = { bindKeys };
