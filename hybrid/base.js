'use strict';

const $ = (id) => document.getElementById(id);
const api = window.hybrid;

const ICON_PLAY = 'M8 5v14l11-7z';
const ICON_OPEN = 'M8.6 16.6 10 18l6-6-6-6-1.4 1.4 4.6 4.6z';
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
  if (url) img.src = url;
  return img;
}

function div(cls, text) {
  const el = document.createElement('div');
  el.className = cls;
  if (text != null) el.textContent = text;
  return el;
}

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

let toastTimer = null;
function toast(text) {
  const t = $('toast');
  t.textContent = text;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 2500);
}
