'use strict';

// The YouTube Music page that plays. A view inside the own interface's window:
// out of sight, as the stage of the now-playing view (only its player, cover or
// video), or whole for sign-in and whatever the interface lacks.

const { WebContentsView, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const player = require('./player');
const { isInternal, isWebLink, onSite } = require('./pure');
const { bindKeys } = require('./keys');

const ROOT = path.join(__dirname, '..');
const START_URL = 'https://music.youtube.com/';
// YouTube Music's own page background, so the view does not flash while it loads.
const DARK = '#030303';
// One pixel in the window corner, where page and UI are the same #030303. At
// 0x0 the page counts as hidden, and Chromium pauses a muted video in a hidden page.
const OUT_OF_SIGHT = { x: 0, y: 0, width: 1, height: 1 };
// Below about 616 px YouTube Music switches to its mobile layout, which has no like button or volume.
const DESKTOP_WIDTH = 720;

// Out of sight a small desktop page; a narrower stage keeps that layout, scaled down to fit.
function emulation() {
  if (where === 'page' || (where === 'stage' && placed.width >= DESKTOP_WIDTH)) return null;
  const scale = where ? Math.max(placed.width, 1) / DESKTOP_WIDTH : 1;
  const size = { width: DESKTOP_WIDTH, height: where ? Math.round(placed.height / scale) : 360 };
  return { screenPosition: 'desktop', screenSize: size, viewSize: size, viewPosition: { x: 0, y: 0 }, deviceScaleFactor: 0, scale };
}

// A new document needs it again; otherwise only a change is sent.
let emulated = '';
function layOut(wc, again = false) {
  const e = emulation();
  const key = JSON.stringify(e);
  if (key === emulated && !again) return;
  emulated = key;
  if (e) wc.enableDeviceEmulation(e);
  else wc.disableDeviceEmulation();
}
const inject = (name) => fs.readFileSync(path.join(ROOT, 'inject', name), 'utf8');
const CSS = inject('style.css');
const STAGE_CSS = inject('stage.css');
const NOWPLAYING = inject('nowplaying.js');
const RESUME = inject('resume.js');

let view = null;
let where = null;
let placed = null;
// The key of the inserted stage CSS, as a promise; null while not inserted.
let stageCss = null;

const live = () => (view && !view.webContents.isDestroyed() ? view.webContents : null);

// Ids are validated by sanitizeResume; encoded anyway so a format change cannot add parameters.
function watchUrl(r) {
  let u = 'https://music.youtube.com/watch?v=' + encodeURIComponent(r.videoId);
  if (r.list) u += '&list=' + encodeURIComponent(r.list);
  return u;
}

// Through mainFrame: webContents.executeJavaScript holds the code back until the
// page has finished loading.
function injectAll(wc, resume) {
  const log = (what) => (e) => console.log('[inject] ' + what + ': ' + e.message);
  const run = (code) => wc.mainFrame.executeJavaScript(code);
  wc.insertCSS(CSS).catch(log('css'));
  run(NOWPLAYING).then(player.sync).catch(log('nowplaying'));
  if (resume) {
    const unmute = () => !wc.isDestroyed() && wc.setAudioMuted(false);
    // A new document kills resume.js, and its promise then never settles.
    wc.once('did-navigate', unmute);
    run(RESUME.replaceAll('__RESUME_DATA__', () => JSON.stringify(resume)))
      .catch(log('resume'))
      .finally(unmute);
  }
}

function openOutside(url) {
  if (isWebLink(url)) shell.openExternal(url);
}

// will-navigate misses server redirects, and popups bring none of the parent's listeners.
function guard(wc) {
  // Main frame only: ads and Google's cookie frames redirect across hosts all the time.
  const check = (e, url) => {
    if (e.isMainFrame === false || isInternal(url)) return;
    e.preventDefault();
    console.log('[nav] sent outside: ' + (URL.parse(url)?.host || 'invalid url'));
    openOutside(url);
  };
  wc.on('will-navigate', check);
  wc.on('will-redirect', check);
  wc.setWindowOpenHandler(({ url }) => {
    if (isInternal(url)) return { action: 'allow' };
    openOutside(url);
    return { action: 'deny' };
  });
  wc.on('did-create-window', (child) => guard(child.webContents));
}

// The player sizes its video on resize only, and a stylesheet alone fires none.
function setStage(on) {
  const wc = live();
  if (!wc || on === !!stageCss) return;
  let done;
  if (on) done = stageCss = wc.insertCSS(STAGE_CSS).catch(() => null);
  else {
    done = stageCss.then((key) => key && !wc.isDestroyed() && wc.removeInsertedCSS(key));
    stageCss = null;
  }
  done
    .then(() => !wc.isDestroyed() && wc.mainFrame.executeJavaScript("dispatchEvent(new Event('resize'))"))
    .catch(() => {});
}

function create({ resume, openMini }) {
  // Keeps the page visible while the window sits in the tray, for the same reason.
  // Measured: 2.3 % CPU playing in the tray.
  view = new WebContentsView({ webPreferences: { preload: path.join(ROOT, 'preload.js'), backgroundThrottling: false } });
  view.setBackgroundColor(DARK);
  view.setBounds(OUT_OF_SIGHT);
  const wc = view.webContents;

  // Muted until resume.js settles, so an ad or autoplay cannot blast sound first.
  // The watch URL pins the exact track by id.
  if (resume) {
    wc.setAudioMuted(true);
    wc.loadURL(watchUrl(resume));
  } else {
    wc.loadURL(START_URL);
  }

  // dom-ready, not did-finish-load: lands the CSS before Polymer builds the nav bar, so the stock logo never flashes.
  wc.on('dom-ready', () => {
    injectAll(wc, resume);
    // Once only: an SPA navigation fires dom-ready again.
    resume = null;
    if (where === 'stage') setStage(true);
    layOut(wc, true);
  });

  // A reload drops the injected poller together with its last track.
  wc.on('did-start-navigation', (e, url, isInPlace, isMainFrame) => {
    if (isMainFrame && !isInPlace) player.setTrack(null);
  });
  wc.on('did-stop-loading', player.sync);

  // Google's consent page sets no background of its own and would show dark text on DARK.
  // A new document also starts without the stage CSS.
  wc.on('did-navigate', (e, url) => {
    stageCss = null;
    view.setBackgroundColor(onSite(url) ? DARK : '#ffffff');
  });

  guard(wc);

  bindKeys(wc, 'pageZoom', openMini);
}

// 'stage', 'page' or null for out of sight; bounds in the window's coordinates.
function place(kind, bounds) {
  if (!live()) return;
  // Left halfway through a consent or sign-in page: back to the site, which asks again if it must.
  if (where === 'page' && !kind && !onSite(view.webContents.getURL())) {
    view.webContents.loadURL(START_URL);
  }
  where = kind;
  placed = kind ? bounds : null;
  setStage(kind === 'stage');
  view.setBounds(kind ? bounds : OUT_OF_SIGHT);
  layOut(view.webContents);
  if (kind === 'page') view.webContents.focus();
}

// The page's beforeunload handler would veto a close that waits for it.
function destroy() {
  const wc = live();
  if (wc) wc.close();
}

module.exports = {
  create,
  attach: (win) => view && win.contentView.addChildView(view),
  place,
  destroy,
  isFocused: () => !!live() && live().isFocused(),
  webContents: live,
};
