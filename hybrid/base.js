'use strict';

const $ = (id) => document.getElementById(id);
const api = window.hybrid;
// Set by app.js once every script has loaded; events that arrive earlier are dropped
// (the track is pulled again then), so no handler calls into a script not yet loaded.
let uiReady = false;

const ICON_PLAY = 'M8 5v14l11-7z';
const ICON_OPEN = 'M8.6 16.6 10 18l6-6-6-6-1.4 1.4 4.6 4.6z';
const ICON_BACK = 'M15.4 16.6 14 18l-6-6 6-6 1.4 1.4-4.6 4.6z';
const ICON_MORE = 'M12 8a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm0 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm0 6a2 2 0 1 0 0 4 2 2 0 0 0 0-4z';
const ICON_REPEAT = 'M7 7h10v3l4-4-4-4v3H5v6h2zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2z';
const ICON_REPEAT_ONE = ICON_REPEAT + 'm-4-2V9h-1l-2 1v1h1.5v4z';

function svg(d) {
  const ns = 'http://www.w3.org/2000/svg';
  const s = document.createElementNS(ns, 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  const p = document.createElementNS(ns, 'path');
  p.setAttribute('d', d);
  s.append(p);
  return s;
}

function thumb(url) {
  const img = document.createElement('img');
  img.className = 'thumb';
  img.alt = '';
  img.loading = 'lazy';
  // Off the main thread, so a burst of covers does not stall scrolling.
  img.decoding = 'async';
  // Fades in once decoded instead of popping in line by line.
  img.addEventListener('load', () => img.classList.add('in'), { once: true });
  // A cover that fails keeps its grey box visible instead of an empty gap.
  img.addEventListener('error', () => img.classList.add('in'), { once: true });
  if (url) img.src = url;
  else img.classList.add('in');
  return img;
}

// Menu and button glyphs, one family, 24 px grid.
const ICONS = {
  play: ICON_PLAY,
  open: 'M8.6 16.6 10 18l6-6-6-6-1.4 1.4 4.6 4.6z',
  shuffle: 'M10.59 9.17 5.41 4 4 5.41l5.17 5.17zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4zm.33 9.41-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04z',
  radio: 'M3.24 6.15C2.51 6.43 2 7.17 2 8v12a2 2 0 0 0 2 2h16c1.11 0 2-.89 2-2V8c0-1.11-.89-2-2-2H8.3l8.26-3.34L15.88 1zM7 20c-1.66 0-3-1.34-3-3s1.34-3 3-3 3 1.34 3 3-1.34 3-3 3m13-8h-2v-2h-2v2H4V8h16z',
  next: 'M21 3H3c-1.11 0-2 .89-2 2v12a2 2 0 0 0 2 2h5v2h8v-2h2v-2H3V5h18v8h2V5a2 2 0 0 0-2-2m-8 7V7h-2v3H8v2h3v3h2v-3h3v-2zm11 8-4.5 4.5L18 21l3-3-3-3 1.5-1.5z',
  queue: 'M3 6h12v2H3zm0 4h12v2H3zm0 4h8v2H3zm14-4v8l6-4z',
  add: 'M14 10H3v2h11zm0-4H3v2h11zm4 8v-4h-2v4h-4v2h4v4h2v-4h4v-2zM3 16h7v-2H3z',
  plus: 'M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6z',
  save: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2m0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8m1-13h-2v4H7v2h4v4h2v-4h4v-2h-4z',
  saved: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2m-2 15-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8z',
  remove: 'M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6zM19 4h-3.5l-1-1h-5l-1 1H5v2h14z',
  artist: 'M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4m0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4',
  album: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2m0 14.5c-2.49 0-4.5-2.01-4.5-4.5S9.51 7.5 12 7.5s4.5 2.01 4.5 4.5-2.01 4.5-4.5 4.5m0-5.5c-.55 0-1 .45-1 1s.45 1 1 1 1-.45 1-1-.45-1-1-1',
  link: 'M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1M8 13h8v-2H8zm9-6h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1s-1.39 3.1-3.1 3.1h-4V17h4c2.76 0 5-2.24 5-5s-2.24-5-5-5',
  block: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2M4 12c0-4.42 3.58-8 8-8 1.85 0 3.55.63 4.9 1.69L5.69 16.9A7.902 7.902 0 0 1 4 12m8 8c-1.85 0-3.55-.63-4.9-1.69L18.31 7.1A7.902 7.902 0 0 1 20 12c0 4.42-3.58 8-8 8',
  like: 'M21 8h-6.31l.95-4.57.03-.32c0-.41-.17-.79-.44-1.06L14.17 1 7.59 7.59C7.22 7.95 7 8.45 7 9v10c0 1.1.9 2 2 2h9c.83 0 1.54-.5 1.84-1.22l3.02-7.05c.09-.23.14-.47.14-.73v-2c0-1.1-.9-2-2-2zm0 4-3 7H9V9l4.34-4.34L12.23 10H21zM1 9h4v12H1z',
  liked: 'M1 21h4V9H1zm22-11c0-1.1-.9-2-2-2h-6.31l.95-4.57.03-.32c0-.41-.17-.79-.44-1.06L14.17 1 7.59 7.59C7.22 7.95 7 8.45 7 9v10c0 1.1.9 2 2 2h9c.83 0 1.54-.5 1.84-1.22l3.02-7.05c.09-.23.14-.47.14-.73z',
  dislike: 'M15 3H6c-.83 0-1.54.5-1.84 1.22l-3.02 7.05c-.09.23-.14.47-.14.73v2c0 1.1.9 2 2 2h6.31l-.95 4.57-.03.32c0 .41.17.79.44 1.06L9.83 23l6.58-6.59c.37-.36.59-.86.59-1.41V5c0-1.1-.9-2-2-2zm0 12-4.34 4.34L11.77 14H3v-2l3-7h9zm4-12h4v12h-4z',
  bell: 'M12 22c1.1 0 2-.9 2-2h-4a2 2 0 0 0 2 2m6-6v-5c0-3.07-1.64-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.63 5.36 6 7.92 6 11v5l-2 2v1h16v-1z',
  edit: 'M3 17.25V21h3.75L17.81 9.94l-3.75-3.75zM20.71 7.04a.996.996 0 0 0 0-1.41l-2.34-2.34a.996.996 0 0 0-1.41 0l-1.83 1.83 3.75 3.75z',
  lock: 'M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2m-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2m3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1s3.1 1.39 3.1 3.1z',
  settings: 'M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.49.49 0 0 0-.59-.22l-2.39.96a7.03 7.03 0 0 0-1.62-.94l-.36-2.54a.48.48 0 0 0-.48-.41h-3.84a.48.48 0 0 0-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.48.48 0 0 0-.59.22L2.74 8.87a.48.48 0 0 0 .12.61l2.03 1.58c-.05.3-.07.63-.07.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32a.48.48 0 0 0-.12-.61zM12 15.6A3.6 3.6 0 1 1 12 8.4a3.6 3.6 0 0 1 0 7.2z',
  check: 'M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z',
  chevron: 'M10 6 8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z',
  note: 'M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3z',
  search: 'M15.5 14h-.79l-.28-.27A6.47 6.47 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14',
  clock: 'M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2M12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8m.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z',
  pin: 'M16 9V4h1c.55 0 1-.45 1-1s-.45-1-1-1H7c-.55 0-1 .45-1 1s.45 1 1 1h1v5c0 1.66-1.34 3-3 3v2h5.97v7l1 1 1-1v-7H19v-2c-1.66 0-3-1.34-3-3',
  close: 'M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z',
  history: 'M13 3a9 9 0 0 0-9 9H1l3.89 3.89.07.14L9 12H6c0-3.87 3.13-7 7-7s7 3.13 7 7-3.13 7-7 7c-1.93 0-3.68-.79-4.94-2.06l-1.42 1.42A8.954 8.954 0 0 0 13 21a9 9 0 0 0 0-18m-1 5v5l4.28 2.54.72-1.21-3.5-2.08V8z',
  person: 'M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4m0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4',
};

function div(cls, text) {
  const el = document.createElement('div');
  el.className = cls;
  if (text != null) el.textContent = text;
  return el;
}

// Clickable text inside a line of other text.
function link(text, onClick) {
  const a = document.createElement('span');
  a.className = 'link';
  a.textContent = text;
  a.addEventListener('click', onClick);
  return a;
}

// Quoted and escaped so a stray quote cannot end the value; main only passes https urls anyway.
const cssUrl = (url) => (url ? 'url("' + url.replace(/["\\]/g, encodeURIComponent) + '")' : '');

function iconButton(cls, icon, label, onClick) {
  const b = document.createElement('button');
  b.className = cls;
  b.title = label;
  b.setAttribute('aria-label', label);
  b.append(svg(icon));
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    onClick(e);
  });
  return b;
}

// Notices

function status(text, withButton) {
  const s = $('status');
  s.textContent = text;
  if (withButton) {
    const b = document.createElement('button');
    b.textContent = T.openPlayer;
    b.addEventListener('click', () => setSlot('page'));
    s.append(' ', b);
  }
}

// invoke() wraps the page's error in its own prefix and the page adds a stack;
// neither tells the reader anything, and the known cases get words of their own.
function errorText(e) {
  const msg = String(e && e.message ? e.message : e)
    .replace(/^Error invoking remote method '[^']+': (\w*Error: )?/, '')
    .split('\n')[0];
  if (/^[A-Z_]+$/.test(msg) && T[msg]) return T[msg];
  return /did not finish loading|did not answer|player window is gone/.test(msg) ? T.notReady : msg;
}

function fail(e) {
  status(T.failed + errorText(e) + T.failedHint, true);
}

// A notice with the cover it is about and, optionally, one thing to do about it.
let toastTimer = null;
function toast(text, { art = '', action = null } = {}) {
  const t = $('toast');
  const label = document.createElement('span');
  label.textContent = text;
  t.replaceChildren(label);
  t.classList.toggle('has-art', !!art);
  if (art) {
    const img = document.createElement('img');
    img.alt = '';
    img.src = art;
    t.prepend(img);
  }
  if (action) {
    const b = document.createElement('button');
    b.textContent = action[0];
    b.addEventListener('click', () => {
      t.hidden = true;
      action[1]();
    });
    t.append(b);
  }
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), action ? 4000 : 2500);
}
