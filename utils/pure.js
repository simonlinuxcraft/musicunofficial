'use strict';

// Google's login flow bounces across accounts.google.com and back, so those
// hosts have to stay in-app. Everything else is a real outbound link.
const INTERNAL_HOSTS = ['youtube.com', 'google.com', 'ytimg.com', 'ggpht.com'];

function isInternal(url) {
  let host;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  return INTERNAL_HOSTS.some((h) => host === h || host.endsWith('.' + h));
}

// The window is frameless and has no menu bar, so these shortcuts are the only
// way out if the tray is missing or the page stops responding.
function keyAction(input) {
  if (!input || input.type !== 'keyDown' || !input.control) return null;
  switch (String(input.key).toLowerCase()) {
    case 'q':
      return 'quit';
    case 'r':
      return 'reload';
    case '+':
    case '=':
      return 'zoom-in';
    case '-':
      return 'zoom-out';
    case '0':
      return 'zoom-reset';
    case 'm':
      return 'mini';
    default:
      return null;
  }
}

// Track data arrives over IPC from a window that runs YouTube's own code, and
// parts of it are forwarded to Discord. Everything is clamped and retyped here
// rather than trusted.
function sanitizeTrack(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const str = (v) => (typeof v === 'string' ? v.trim().slice(0, 256) : '');
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0);

  const title = str(raw.title);
  if (!title) return null;

  // Only https images. A file: or data: url here would be handed straight to
  // Discord and rendered by the mini player.
  let art = '';
  if (typeof raw.art === 'string' && raw.art.length < 2048) {
    try {
      if (new URL(raw.art).protocol === 'https:') art = raw.art;
    } catch {}
  }

  return {
    title,
    artist: str(raw.artist),
    album: str(raw.album),
    art,
    playing: raw.playing === true,
    position: num(raw.position),
    duration: num(raw.duration),
  };
}

module.exports = { isInternal, INTERNAL_HOSTS, keyAction, sanitizeTrack };
