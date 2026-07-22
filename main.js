'use strict';

const { app, BrowserWindow, Tray, Menu, shell, session, nativeImage, ipcMain, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const { isInternal, keyAction, sanitizeTrack, positionNow, sanitizeResume } = require('./utils/pure');
const { createPresence } = require('./utils/discord');

const APP_TITLE = 'MusicUnofficial';
const START_URL = 'https://music.youtube.com/';
const DEFAULT_BOUNDS = { width: 1280, height: 860 };
const MINI_SIZE = { width: 344, height: 104 };
const INJECT_CSS = fs.readFileSync(path.join(__dirname, 'inject', 'style.css'), 'utf8');
const INJECT_JS = fs.readFileSync(path.join(__dirname, 'inject', 'controls.js'), 'utf8');
const INJECT_NOWPLAYING = fs.readFileSync(path.join(__dirname, 'inject', 'nowplaying.js'), 'utf8');
const INJECT_RESUME = fs.readFileSync(path.join(__dirname, 'inject', 'resume.js'), 'utf8');

// How stale a saved track may be and still be reopened on launch. A week keeps
// "quit today, back tomorrow" working without resuming something from a
// different listening session weeks ago.
const MAX_RESUME_AGE = 7 * 24 * 3600 * 1000;

// Discord application id. Client ids are public by design, this is not a
// secret. The override lets a fork point at its own application without
// patching the source; empty falls back to the feature staying greyed out
// rather than failing at runtime.
const DISCORD_CLIENT_ID = process.env.MUSICUNOFFICIAL_DISCORD_ID || '1528803144937635890';

let win = null;
let mini = null;
let tray = null;
let quitting = false;
let hasTray = false;
let track = null;
let presence = null;
// Last track+position seen this session, and the one to reopen at launch.
let lastResume = null;
let pendingResume = null;

// Pin the profile directory instead of letting Electron derive it from the app
// name. Otherwise every rename moves userData and silently signs the user out.
// Must run before requestSingleInstanceLock, which uses this path for its lock.
app.setPath('userData', path.join(app.getPath('appData'), 'musicunofficial'));

if (!app.requestSingleInstanceLock()) {
  app.quit();
  return;
}

// Chromium's classic scrollbar takes up layout width and sits on top of the
// page design. Overlay scrollbars fade out instead.
app.commandLine.appendSwitch('enable-features', 'OverlayScrollbar,FluentOverlayScrollbar');

function statePath() {
  return path.join(app.getPath('userData'), 'window-state.json');
}

function settingsPath() {
  return path.join(app.getPath('userData'), 'settings.json');
}

let settings = { discord: false, miniBounds: null };

function loadSettings() {
  try {
    const s = JSON.parse(fs.readFileSync(settingsPath(), 'utf8'));
    if (s && typeof s === 'object') settings = { ...settings, ...s };
  } catch {}
}

function saveSettings() {
  try {
    fs.writeFileSync(settingsPath(), JSON.stringify(settings));
  } catch {}
}

function loadBounds() {
  try {
    const s = JSON.parse(fs.readFileSync(statePath(), 'utf8'));
    if (Number.isInteger(s.width) && Number.isInteger(s.height)) return s;
  } catch {}
  return { ...DEFAULT_BOUNDS };
}

// Only sampled while the window is mapped: isMaximized() reports false on a
// hidden or minimised window, so reading it then would persist a wrong state.
// The last good sample is kept so quitting from the tray still writes the real
// geometry instead of writing nothing.
let lastBounds = null;

function saveBounds() {
  if (!win || win.isDestroyed()) return;
  if (win.isVisible() && !win.isMinimized()) {
    lastBounds = { ...win.getNormalBounds(), maximized: win.isMaximized() };
  }
  if (!lastBounds) return;
  try {
    fs.writeFileSync(statePath(), JSON.stringify(lastBounds));
  } catch {}
}

// resize and move fire continuously while dragging, and saveBounds writes
// synchronously. Without this the state file is rewritten hundreds of times
// per drag.
let saveTimer = null;
function scheduleSaveBounds() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveBounds, 400);
}

function watchUrl(r) {
  // videoId and list are already validated to [A-Za-z0-9_-] by sanitizeResume;
  // encode anyway so a future format change cannot inject query parameters.
  let u = 'https://music.youtube.com/watch?v=' + encodeURIComponent(r.videoId);
  if (r.list) u += '&list=' + encodeURIComponent(r.list);
  return u;
}

// Pulls a resume snapshot straight from the injected player helper. Independent
// of the now-playing IPC pipeline, which is idle whenever neither the mini
// player nor Discord is on, so this is the only path that sees the track in the
// common case. Held as last-known-good for before-quit to persist.
function captureResume() {
  if (!win || win.isDestroyed()) return;
  win.webContents
    .executeJavaScript('window.__ytmSnapshot && window.__ytmSnapshot()')
    .then((snap) => {
      const r = sanitizeResume(snap);
      if (r) lastResume = r;
    })
    .catch(() => {});
}

function createWindow() {
  const s = loadBounds();

  win = new BrowserWindow({
    x: s.x,
    y: s.y,
    width: s.width,
    height: s.height,
    minWidth: 480,
    minHeight: 400,
    // No backgroundColor override: Google's consent page renders light and
    // sets no body background, so a dark window makes its text unreadable.
    show: false,
    // Frameless. Window controls are injected into the page's own nav bar by
    // inject/controls.js. A native titleBarOverlay was tried first and looked
    // like a black box pasted over the header gradient.
    frame: false,
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: {
      // Chromium throttles timers in hidden windows, which stalls playback
      // once the window is minimised or sent to the tray. It also keeps the
      // now playing poll running while the mini player is the only thing
      // on screen.
      backgroundThrottling: false,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  if (s.maximized) win.maximize();
  // Loading music.youtube.com takes long enough that the mini player can be
  // open by the time this fires. Showing the big window then would undo the
  // switch the user just made.
  win.once('ready-to-show', () => {
    if (!mini || mini.isDestroyed()) win.show();
  });
  win.setMenuBarVisibility(false);

  // Pin the title: the page overwrites it on every navigation, which would
  // otherwise put a changing string in the task bar and Alt-Tab.
  win.setTitle(APP_TITLE);
  win.on('page-title-updated', (e) => {
    e.preventDefault();
    win.setTitle(APP_TITLE);
  });

  // Muted so a pre-roll ad or an autoplay start cannot blast sound before the
  // resume settles; unmuted once resume.js finishes or gives up. Loading the
  // watch URL pins the exact track by id, which is what keeps resume off the
  // wrong song.
  if (pendingResume) {
    win.webContents.setAudioMuted(true);
    win.loadURL(watchUrl(pendingResume));
  } else {
    win.loadURL(START_URL);
  }

  // dom-ready, not did-finish-load: this lands the stylesheet and arms the
  // observer before Polymer builds the nav bar, which keeps the original logo
  // from flashing up first.
  win.webContents.on('dom-ready', () => {
    win.webContents.insertCSS(INJECT_CSS).catch((e) => console.log('[inject] css: ' + e.message));
    win.webContents
      .executeJavaScript(INJECT_JS)
      .then(() => win.webContents.send('window:maximized', win.isMaximized()))
      .catch((e) => console.log('[inject] js: ' + e.message));
    win.webContents
      .executeJavaScript(INJECT_NOWPLAYING)
      .then(syncPolling)
      .catch((e) => console.log('[inject] nowplaying: ' + e.message));
    // Resume runs once, on the first load. Cleared immediately so an SPA
    // navigation firing dom-ready again cannot re-arm it, and unmute always
    // runs even if the seek path throws.
    if (pendingResume) {
      const data = pendingResume;
      pendingResume = null;
      const js = INJECT_RESUME.replaceAll('__RESUME_DATA__', () => JSON.stringify(data));
      win.webContents
        .executeJavaScript(js)
        .catch((e) => console.log('[resume] ' + e.message))
        .finally(() => {
          if (win && !win.isDestroyed()) win.webContents.setAudioMuted(false);
        });
    }
  });

  // A reload throws away the injected poller and its last known track. Without
  // this the mini player would keep showing the previous song until the user
  // starts a new one.
  win.webContents.on('did-start-navigation', (e, url, isInPlace, isMainFrame) => {
    if (isMainFrame && !isInPlace) setTrack(null);
  });

  // Safety net: whatever the state ended up being after a load or a reload,
  // reconcile it once the page has settled.
  win.webContents.on('did-stop-loading', syncPolling);

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isInternal(url)) return { action: 'allow' };
    shell.openExternal(url);
    return { action: 'deny' };
  });

  win.webContents.on('will-navigate', (e, url) => {
    if (isInternal(url)) return;
    e.preventDefault();
    shell.openExternal(url);
  });

  win.webContents.on('before-input-event', (e, input) => {
    const action = keyAction(input);
    if (!action) return;
    e.preventDefault();
    const wc = win.webContents;
    if (action === 'quit') {
      quitting = true;
      app.quit();
    } else if (action === 'reload') {
      wc.reload();
    } else if (action === 'mini') {
      openMini();
    } else if (action === 'zoom-in') {
      wc.setZoomLevel(Math.min(wc.getZoomLevel() + 0.5, 5));
    } else if (action === 'zoom-out') {
      wc.setZoomLevel(Math.max(wc.getZoomLevel() - 0.5, -5));
    } else if (action === 'zoom-reset') {
      wc.setZoomLevel(0);
    }
  });

  win.on('close', (e) => {
    saveBounds();
    // hasTray only tells us the Tray object was created, NOT that this desktop
    // actually renders a status area: Electron falls back to GtkStatusIcon
    // without throwing, and GNOME has not drawn those since 3.26. On such a
    // system the way back is Ctrl+Q, not the tray.
    if (!quitting && hasTray) {
      e.preventDefault();
      win.hide();
    }
  });

  const sendMaxState = () => {
    if (win && !win.isDestroyed()) win.webContents.send('window:maximized', win.isMaximized());
  };
  win.on('maximize', sendMaxState);
  win.on('unmaximize', sendMaxState);

  win.on('resize', scheduleSaveBounds);
  win.on('move', scheduleSaveBounds);
}

function setTrack(next) {
  track = next;
  if (mini && !mini.isDestroyed()) mini.webContents.send('mini:track', track);
  if (presence) presence.update(track);
}

// The page only polls while someone consumes the result. Measured during
// playback: polling regardless cost about 14 CPU points, roughly two thirds of
// the app's total, and nothing was reading it.
function syncPolling() {
  // No isLoading() guard here. dom-ready fires while the page is still pulling
  // resources, so it would swallow the one call that follows injection and
  // leave Rich Presence without a single track for the whole session. By the
  // time the injected script has resolved its listener is registered, which is
  // all that matters.
  if (!win || win.isDestroyed()) return;
  const needed = !!(mini && !mini.isDestroyed()) || !!(presence && presence.enabled);
  win.webContents.send('nowplaying:active', needed);
  if (!needed) setTrack(null);
}

let miniSaveTimer = null;

function saveMiniBounds() {
  clearTimeout(miniSaveTimer);
  miniSaveTimer = null;
  if (!mini || mini.isDestroyed()) return;
  const b = mini.getBounds();
  settings.miniBounds = { x: b.x, y: b.y };
  saveSettings();
}

function scheduleSaveMiniBounds() {
  clearTimeout(miniSaveTimer);
  miniSaveTimer = setTimeout(saveMiniBounds, 400);
}

function miniStartBounds() {
  const b = settings.miniBounds;
  // Reject a saved position that no longer lands on a connected display, which
  // is what happens after unplugging the monitor it was parked on.
  if (b && Number.isInteger(b.x) && Number.isInteger(b.y)) {
    const fits = screen.getAllDisplays().some((d) => {
      const a = d.workArea;
      return b.x >= a.x - 50 && b.y >= a.y - 50 && b.x < a.x + a.width - 50 && b.y < a.y + a.height - 50;
    });
    if (fits) return { x: b.x, y: b.y };
  }
  const area = screen.getPrimaryDisplay().workArea;
  return {
    x: area.x + area.width - MINI_SIZE.width - 24,
    y: area.y + area.height - MINI_SIZE.height - 24,
  };
}

function openMini() {
  if (mini && !mini.isDestroyed()) {
    mini.show();
    mini.focus();
    return;
  }
  const pos = miniStartBounds();

  mini = new BrowserWindow({
    ...MINI_SIZE,
    ...pos,
    frame: false,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    backgroundColor: '#0f0f0f',
    show: false,
    icon: path.join(__dirname, 'icon.png'),
    title: APP_TITLE,
    webPreferences: {
      backgroundThrottling: false,
      preload: path.join(__dirname, 'miniplayer-preload.js'),
    },
  });

  mini.setMenuBarVisibility(false);
  mini.loadFile(path.join(__dirname, 'miniplayer.html'));

  mini.once('ready-to-show', () => {
    mini.show();
    if (win && !win.isDestroyed()) win.hide();
  });

  syncPolling();

  // Debounced for the same reason the main window's geometry is: moved fires
  // continuously while dragging and saveSettings writes synchronously. Writing
  // on every event blocks the main process and makes the whole app stutter.
  mini.on('moved', scheduleSaveMiniBounds);

  // Runs before the window is gone, so a move made within the debounce window
  // still gets written. 'closed' would be too late, the bounds are unreadable
  // by then and the pending timer bails out on the destroyed window.
  mini.on('close', saveMiniBounds);

  // Covers Alt+F4 and the window manager's own close as well as our button.
  // Without this the main window would stay hidden with no way back.
  mini.on('closed', () => {
    mini = null;
    syncPolling();
    if (!quitting && win && !win.isDestroyed()) {
      win.show();
      win.focus();
    }
  });
}

function closeMini() {
  if (mini && !mini.isDestroyed()) mini.close();
}

function toggleWindow() {
  if (!win) return;
  if (win.isVisible() && !win.isMinimized()) {
    win.hide();
  } else {
    closeMini();
    win.show();
    win.focus();
  }
}

function buildTrayMenu() {
  if (!tray) return;
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Show / Hide', click: toggleWindow },
      { label: 'Mini player', accelerator: 'CommandOrControl+M', click: openMini },
      { type: 'separator' },
      {
        label: DISCORD_CLIENT_ID ? 'Discord Rich Presence' : 'Discord Rich Presence (not configured)',
        type: 'checkbox',
        enabled: !!DISCORD_CLIENT_ID,
        checked: settings.discord,
        click: (item) => setDiscord(item.checked),
      },
      { type: 'separator' },
      {
        label: 'Quit',
        accelerator: 'CommandOrControl+Q',
        click: () => {
          quitting = true;
          app.quit();
        },
      },
    ])
  );
}

function setDiscord(on) {
  settings.discord = !!on && !!DISCORD_CLIENT_ID;
  saveSettings();
  if (presence) {
    presence.setEnabled(settings.discord);
    if (settings.discord) presence.update(track);
  }
  syncPolling();
  buildTrayMenu();
}

function createTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, 'icon-tray.png'));
  // Guards a missing or unreadable icon file, nothing more. Whether the desktop
  // shows status icons at all cannot be detected from here.
  if (icon.isEmpty()) {
    console.log('[tray] icon missing, running without tray');
    return;
  }
  tray = new Tray(icon);
  tray.setToolTip(APP_TITLE);
  buildTrayMenu();
  tray.on('click', toggleWindow);
  hasTray = true;
}

const alive = () => win && !win.isDestroyed();

ipcMain.on('window:minimize', () => alive() && win.minimize());
ipcMain.on('window:toggle-maximize', () => {
  if (!alive()) return;
  if (win.isMaximized()) win.unmaximize();
  else win.maximize();
});
ipcMain.on('window:close', () => alive() && win.close());
ipcMain.on('mini:open', () => openMini());

ipcMain.on('nowplaying:update', (e, raw) => {
  // Only the main window reports playback. Anything else on this channel is
  // not ours.
  if (!win || win.isDestroyed() || e.sender !== win.webContents) return;
  setTrack(sanitizeTrack(raw));
});

// The mini player asks for the current track once it has loaded, instead of
// being pushed one on ready-to-show, which raced with its own script.
ipcMain.on('mini:request', (e) => {
  if (mini && !mini.isDestroyed() && e.sender === mini.webContents) e.sender.send('mini:track', track);
});

ipcMain.on('mini:command', (e, cmd) => {
  if (!['previous', 'playpause', 'next'].includes(cmd)) return;
  if (win && !win.isDestroyed()) win.webContents.send('player:command', cmd);
});

ipcMain.on('mini:quit', () => {
  quitting = true;
  app.quit();
});

ipcMain.on('mini:restore', () => {
  if (win && !win.isDestroyed()) {
    win.show();
    win.focus();
  }
  closeMini();
});

app.on('second-instance', () => {
  if (alive()) {
    closeMini();
    win.show();
    win.focus();
  }
});

app.on('before-quit', () => {
  quitting = true;
  saveBounds();
  if (presence) presence.setEnabled(false);
  // Persist the last-known track so the next launch can reopen it. positionNow
  // projects the up-to-12s-stale sample forward to this instant. Written
  // synchronously here, not awaited from the renderer, which would risk hanging
  // quit on a stuck page (the reason destroy() below exists).
  if (lastResume) {
    settings.resume = {
      videoId: lastResume.videoId,
      list: lastResume.list,
      title: lastResume.title,
      position: positionNow(lastResume),
      duration: lastResume.duration,
      savedAt: Date.now(),
    };
    saveSettings();
  }
  // YouTube Music installs a beforeunload handler while a track plays, which
  // vetoes win.close() and leaves app.quit() hanging with the window still up.
  // destroy() tears the windows down without asking the page, so quitting works
  // mid-playback.
  if (mini && !mini.isDestroyed()) mini.destroy();
  if (win && !win.isDestroyed()) win.destroy();
});

app.whenReady().then(() => {
  loadSettings();

  // Decide up front whether to reopen a track, then consume the record at once
  // (drop + save) so a launch that fails on resume cannot loop on the same bad
  // record. sanitizeResume drops anything without a valid videoId.
  const saved = settings.resume;
  if (saved && typeof saved.savedAt === 'number' && Date.now() - saved.savedAt < MAX_RESUME_AGE) {
    pendingResume = sanitizeResume(saved);
  }
  if (settings.resume) {
    delete settings.resume;
    saveSettings();
  }

  // On the session, not on a single webContents: the login flow opens popups,
  // and those would otherwise carry the Electron token that Google rejects.
  const ua = session.defaultSession.getUserAgent().replace(/ Electron\/[\d.]+/, '');
  session.defaultSession.setUserAgent(ua);

  if (DISCORD_CLIENT_ID) {
    presence = createPresence(
      DISCORD_CLIENT_ID,
      (m) => console.log('[discord] ' + m),
      // Discord turned us away for good. Untick the box rather than leaving it
      // on next to a feature that is not running.
      () => {
        settings.discord = false;
        saveSettings();
        syncPolling();
        buildTrayMenu();
      }
    );
    presence.setEnabled(settings.discord);
  }

  createWindow();
  // Sample the player on a slow timer; before-quit persists the last sample as
  // the resume record. Interval only, no event, keeps it cheap and off the hot
  // path.
  setInterval(captureResume, 12000);
  try {
    createTray();
  } catch (e) {
    // Rarely reached: Electron does not throw when the desktop lacks a status
    // area. Kept for a genuinely broken tray backend.
    console.log('[tray] unavailable: ' + e.message);
  }
});

// No window-all-closed handler. With a tray the close handler hides
// the window; without one it lets the close through and Electron's default
// quit-on-last-window applies.
