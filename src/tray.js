'use strict';

const { app, Menu, Tray, nativeImage } = require('electron');
const path = require('path');
const player = require('./player');
const { APP_TITLE } = require('./pure');
const { uiLanguage } = require('./i18n');

let tray = null;
let actions = null;

const STRINGS = {
  en: {
    toggle: 'Show / Hide',
    mini: 'Mini player',
    discord: 'Discord Rich Presence',
    discordOff: 'Discord Rich Presence (not configured)',
    quit: 'Quit',
  },
  de: {
    toggle: 'Anzeigen / Verbergen',
    mini: 'Miniplayer',
    discord: 'Discord Rich Presence',
    discordOff: 'Discord Rich Presence (nicht eingerichtet)',
    quit: 'Beenden',
  },
};

function rebuild() {
  if (!tray) return;
  const T = STRINGS[uiLanguage()];
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: T.toggle, click: actions.toggle },
      { label: T.mini, accelerator: 'CommandOrControl+M', click: actions.openMini },
      { type: 'separator' },
      {
        label: player.discordAvailable ? T.discord : T.discordOff,
        type: 'checkbox',
        enabled: player.discordAvailable,
        checked: player.discordEnabled(),
        click: (item) => {
          player.setDiscord(item.checked);
          rebuild();
        },
      },
      { type: 'separator' },
      { label: T.quit, accelerator: 'CommandOrControl+Q', click: () => app.quit() },
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
