'use strict';

const APP_TITLE = 'MusicUnofficial';

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

  // When position was measured, so consumers can project it forward instead of
  // treating a stale value as current. A missing or absurd stamp falls back to
  // now, which is the old behaviour and never worse.
  const now = Date.now();
  let at = typeof raw.at === 'number' && Number.isFinite(raw.at) ? raw.at : now;
  if (at > now || now - at > 60000) at = now;

  return {
    title,
    artist: str(raw.artist),
    album: str(raw.album),
    art,
    playing: raw.playing === true,
    position: num(raw.position),
    duration: num(raw.duration),
    at,
  };
}

// Position projected to right now. Only advances while playing, and never runs
// past the end of the track.
function positionNow(track, now = Date.now()) {
  if (!track || !(track.duration > 0)) return 0;
  const elapsed = track.playing ? Math.max(0, now - (track.at || now)) / 1000 : 0;
  return Math.min(track.duration, track.position + elapsed);
}

// A resume snapshot comes from the player API in the renderer and becomes a
// navigation target on next launch, so the id is validated hard: no id, no
// resume. videoId is YouTube's fixed 11-char handle; list is a playlist/radio
// id. Anything that fails the shape is dropped rather than trusted.
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const LIST_ID = /^[A-Za-z0-9_-]{2,64}$/;

function sanitizeResume(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const videoId = typeof raw.videoId === 'string' && VIDEO_ID.test(raw.videoId) ? raw.videoId : null;
  if (!videoId) return null;

  const num = (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0);
  const now = Date.now();
  let at = typeof raw.at === 'number' && Number.isFinite(raw.at) ? raw.at : now;
  if (at > now || now - at > 60000) at = now;

  return {
    videoId,
    list: typeof raw.list === 'string' && LIST_ID.test(raw.list) ? raw.list : null,
    position: num(raw.position),
    duration: num(raw.duration),
    playing: raw.playing === true,
    at,
  };
}

module.exports = { APP_TITLE, isInternal, INTERNAL_HOSTS, keyAction, sanitizeTrack, positionNow, sanitizeResume };
