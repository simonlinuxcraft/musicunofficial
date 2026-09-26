'use strict';

const { app, Menu, Tray, nativeImage } = require('electron');
const path = require('path');
const player = require('./player');
const { APP_TITLE } = require('./pure');

let tray = null;
let actions = null;

function rebuild() {
  if (!tray) return;
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Show / Hide', click: actions.toggle },
      { label: 'Mini player', accelerator: 'CommandOrControl+M', click: actions.openMini },
      { type: 'separator' },
      {
        label: player.discordAvailable ? 'Discord Rich Presence' : 'Discord Rich Presence (not configured)',
        type: 'checkbox',
        enabled: player.discordAvailable,
        checked: player.discordEnabled(),
        click: (item) => {
          player.setDiscord(item.checked);
          rebuild();
        },
      },
      { type: 'separator' },
      { label: 'Quit', accelerator: 'CommandOrControl+Q', click: () => app.quit() },
    ])
  );
}

// Electron falls back to GtkStatusIcon without throwing, so a missing icon file
// is the only failure detectable here.
function create(opts) {
  actions = opts;
  const icon = nativeImage.createFromPath(path.join(__dirname, '..', 'icon-tray.png'));
  if (icon.isEmpty()) {
    console.log('[tray] icon missing, running without tray');
    return;
  }
  tray = new Tray(icon);
  tray.setToolTip(APP_TITLE);
  tray.on('click', actions.toggle);
  rebuild();
}

module.exports = { create, rebuild, exists: () => !!tray };
