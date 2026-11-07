'use strict';

const { app, Menu, Tray, nativeImage } = require('electron');
const path = require('path');
const player = require('./player');
const { APP_TITLE } = require('./pure');
const { uiLanguage } = require('./i18n');

let tray = null;
let actions = null;
let tip = APP_TITLE;

const STRINGS = {
  en: {
    toggle: 'Show / Hide',
    mini: 'Mini player',
    playpause: 'Play / Pause',
    next: 'Next track',
    previous: 'Previous track',
    discord: 'Discord Rich Presence',
    quit: 'Quit',
  },
  de: {
    toggle: 'Anzeigen / Verbergen',
    mini: 'Miniplayer',
    playpause: 'Wiedergabe / Pause',
    next: 'Nächster Titel',
    previous: 'Vorheriger Titel',
    discord: 'Discord Rich Presence',
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
      { label: T.playpause, click: () => player.command('playpause') },
      { label: T.next, click: () => player.command('next') },
      { label: T.previous, click: () => player.command('previous') },
      { type: 'separator' },
      {
        label: T.discord,
        type: 'checkbox',
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

// The playing track as the tooltip, so hovering the icon says what is on.
function setTrack(t) {
  const next = t && !t.ad ? t.title + (t.artist ? ' - ' + t.artist : '') : APP_TITLE;
  if (!tray || next === tip) return;
  tip = next;
  tray.setToolTip(tip);
}

module.exports = { create, rebuild, setTrack, exists: () => !!tray };
