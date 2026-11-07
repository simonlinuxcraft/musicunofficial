'use strict';

const crypto = require('crypto');

const APP_TITLE = 'Music';

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

// Whether the player page is on YouTube Music itself, not on a consent or sign-in page.
// An empty or broken URL counts as away.
function onSite(url) {
  try {
    return new URL(url).hostname === 'music.youtube.com';
  } catch {
    return false;
  }
}

// What may leave the app through the system's handler. Any other scheme from the
// page could start a local program registered for it.
function isWebLink(url) {
  try {
    return ['https:', 'http:', 'mailto:'].includes(new URL(url).protocol);
  } catch {
    return false;
  }
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

function httpsUrl(v) {
  if (typeof v !== 'string' || v.length >= 2048) return '';
  try {
    return new URL(v).protocol === 'https:' ? v : '';
  } catch {
    return '';
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
  const art = httpsUrl(raw.art);

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
    ad: raw.ad === true,
    like: ['LIKE', 'DISLIKE', 'INDIFFERENT'].includes(raw.like) ? raw.like : null,
    videoId: typeof raw.videoId === 'string' && VIDEO_ID.test(raw.videoId) ? raw.videoId : null,
    video: raw.video === true,
    shuffle: raw.shuffle === true,
    repeat: ['NONE', 'ALL', 'ONE'].includes(raw.repeat) ? raw.repeat : 'NONE',
    volume: Number.isFinite(raw.volume) ? Math.min(100, Math.max(0, Math.round(raw.volume))) : 100,
    muted: raw.muted === true,
    avMode: ['ATV_PREFERRED', 'OMV_PREFERRED'].includes(raw.avMode) ? raw.avMode : null,
    avAvailable: raw.avAvailable === true,
    adSkip: raw.adSkip === true,
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

const BROWSE_ID = /^[A-Za-z0-9_-]{2,128}$/;
const PARAMS = /^[A-Za-z0-9%_=-]{1,100}$/;

// Only the ids a navigation needs. The rest of a watchEndpoint (params, tracking)
// stays behind, so nothing from a response is replayed into the page unchecked.
function sanitizeWatch(raw) {
  if (!raw || typeof raw !== 'object' || typeof raw.videoId !== 'string' || !VIDEO_ID.test(raw.videoId)) return null;
  const w = { videoId: raw.videoId };
  if (typeof raw.playlistId === 'string' && LIST_ID.test(raw.playlistId)) w.playlistId = raw.playlistId;
  return w;
}

// A playlist or album header's shuffle entry, which plays the whole list shuffled.
function sanitizePlaylistWatch(raw) {
  if (!raw || typeof raw !== 'object' || typeof raw.playlistId !== 'string' || !LIST_ID.test(raw.playlistId)) return null;
  const w = { playlistId: raw.playlistId };
  if (typeof raw.params === 'string' && PARAMS.test(raw.params)) w.params = raw.params;
  return w;
}

// The two endpoints the hybrid UI may hand back to the page: play a track, or a
// whole list. Rebuilt from the ids, so nothing else in a response is replayed.
function sanitizeEndpoint(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const watch = raw.watchEndpoint && sanitizeWatch(raw.watchEndpoint);
  if (watch) return { watchEndpoint: watch };
  const list = raw.watchPlaylistEndpoint && sanitizePlaylistWatch(raw.watchPlaylistEndpoint);
  return list ? { watchPlaylistEndpoint: list } : null;
}

// What "play next" and "add to queue" put in: one track or a whole list.
function sanitizeQueueTarget(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (typeof raw.videoId === 'string' && VIDEO_ID.test(raw.videoId)) return { videoId: raw.videoId };
  if (typeof raw.playlistId === 'string' && LIST_ID.test(raw.playlistId)) return { playlistId: raw.playlistId };
  return null;
}

const CONTINUATION = /^[A-Za-z0-9%_=-]{8,4000}$/;

// Tracks and cards out of an InnerTube browse or search response, grouped by the
// shelves they sit in, plus the header's shuffle entry on a playlist or album and
// the token for the next page. Walks the whole tree instead of fixed paths: the
// shelves around the items differ per page and change over time, the item
// renderers have stayed put.
function parseItems(json) {
  const out = [];
  const sections = [];
  let section = null;
  let shuffle = null;
  let next = null;
  const runsOf = (t) => (Array.isArray(t?.runs) ? t.runs.filter((r) => typeof r?.text === 'string') : []);
  const text = (t) => runsOf(t).map((r) => r.text).join('').trim().slice(0, 256);
  const pageType = (b) => b?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType || '';
  const browseOf = (b) => (typeof b?.browseId === 'string' && BROWSE_ID.test(b.browseId) ? b.browseId : null);
  // The smallest picture that is still sharp at the size it is shown, so a long
  // list does not decode 544 px covers for 48 px rows.
  const thumb = (t, min) => {
    const raw = t?.musicThumbnailRenderer?.thumbnail?.thumbnails;
    const list = (Array.isArray(raw) ? raw : []).filter((x) => httpsUrl(x?.url)).sort((a, b) => (a.width || 0) - (b.width || 0));
    if (!list.length) return '';
    return (list.find((x) => x.width >= min) || list[list.length - 1]).url;
  };
  // Subtitle runs, keeping the links to artists, albums and playlists.
  const parts = (t) =>
    runsOf(t).map((r) => ({ text: r.text.slice(0, 256), browseId: browseOf(r.navigationEndpoint?.browseEndpoint) }));
  const menuOf = (m, item) => {
    for (const entry of m?.menuRenderer?.items || []) {
      const v = entry && (entry.menuNavigationItemRenderer || entry.menuServiceItemRenderer);
      const icon = v?.icon?.iconType;
      const nav = v?.navigationEndpoint || {};
      const service = v?.serviceEndpoint || {};
      if (icon === 'MUSIC_SHUFFLE') item.shuffle = item.shuffle || sanitizeEndpoint(nav);
      else if (icon === 'MIX') item.radio = item.radio || sanitizeEndpoint(nav);
      else if (service.queueAddEndpoint) item.queue = item.queue || sanitizeQueueTarget(service.queueAddEndpoint.queueTarget);
      else if (pageType(nav.browseEndpoint) === 'MUSIC_PAGE_TYPE_ARTIST') item.artistId = item.artistId || browseOf(nav.browseEndpoint);
      else if (pageType(nav.browseEndpoint) === 'MUSIC_PAGE_TYPE_ALBUM') item.albumId = item.albumId || browseOf(nav.browseEndpoint);
    }
  };
  const push = (item, menu, links) => {
    if (!item.title || !(item.watch || item.browseId)) return;
    for (const r of links || []) {
      if (!r.browseId) continue;
      if (!item.artistId && r.browseId.startsWith('UC')) item.artistId = r.browseId;
      if (!item.albumId && r.browseId.startsWith('MPRE')) item.albumId = r.browseId;
    }
    menuOf(menu, item);
    if (!item.play) item.play = item.watch ? { watchEndpoint: item.watch } : null;
    if (!section) sections.push((section = { title: '', items: [] }));
    section.items.push(item);
    out.push(item);
  };
  const base = () => ({ play: null, shuffle: null, radio: null, queue: null, artistId: null, albumId: null });
  const overlayPlay = (o) => o?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer?.playNavigationEndpoint;
  const shelfTitle = (sh) => text(sh.title) || text(Object.values(sh.header || {})[0]?.title);
  const walk = (o) => {
    if (!o || typeof o !== 'object') return;
    if (!shuffle && o.icon?.iconType === 'MUSIC_SHUFFLE') shuffle = sanitizePlaylistWatch(o.navigationEndpoint?.watchPlaylistEndpoint);
    if (!next) {
      const token = o.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token || o.nextContinuationData?.continuation;
      if (typeof token === 'string' && CONTINUATION.test(token)) next = token;
    }
    const li = o.musicResponsiveListItemRenderer;
    const card = o.musicTwoRowItemRenderer;
    const top = o.musicCardShelfRenderer;
    const shelf = o.musicCarouselShelfRenderer || o.musicShelfRenderer;
    if (li) {
      const cols = (li.flexColumns || []).map((c) => c?.musicResponsiveListItemFlexColumnRenderer?.text);
      const fixed = (li.fixedColumns || []).map((c) => text(c?.musicResponsiveListItemFixedColumnRenderer?.text)).filter(Boolean);
      const play = overlayPlay(li.overlay);
      const watch = sanitizeWatch(
        play?.watchEndpoint || runsOf(cols[0])[0]?.navigationEndpoint?.watchEndpoint || (li.playlistItemData && { videoId: li.playlistItemData.videoId })
      );
      const links = parts(cols[1]);
      for (const f of fixed) links.push({ text: ' • ', browseId: null }, { text: f, browseId: null });
      const item = { ...base(), title: text(cols[0]), subtitle: links.map((r) => r.text).join('').trim(), parts: links, thumb: thumb(li.thumbnail, 96), card: false, watch, browseId: watch ? null : browseOf(li.navigationEndpoint?.browseEndpoint) };
      item.play = sanitizeEndpoint(play);
      push(item, li.menu, links);
    } else if (card) {
      const nav = card.navigationEndpoint || {};
      const watch = sanitizeWatch(nav.watchEndpoint);
      const links = parts(card.subtitle);
      const item = { ...base(), title: text(card.title), subtitle: text(card.subtitle), parts: links, thumb: thumb(card.thumbnailRenderer, 300), card: true, watch, browseId: watch ? null : browseOf(nav.browseEndpoint) };
      item.play = sanitizeEndpoint(overlayPlay(card.thumbnailOverlay));
      push(item, card.menu, links);
    } else if (top) {
      // Search's top result: the entity itself, then the tracks the card lists under it.
      const nav = runsOf(top.title)[0]?.navigationEndpoint || {};
      const watch = sanitizeWatch(nav.watchEndpoint);
      const links = parts(top.subtitle);
      const item = { ...base(), title: text(top.title), subtitle: text(top.subtitle), parts: links, thumb: thumb(top.thumbnail, 96), card: false, watch, browseId: watch ? null : browseOf(nav.browseEndpoint) };
      item.play = sanitizeEndpoint(overlayPlay(top.thumbnailOverlay));
      push(item, top.menu, links);
      for (const c of top.contents || []) walk(c);
    } else if (shelf) {
      // A titled shelf opens its own section; whatever follows it starts a fresh one.
      section = null;
      const title = shelfTitle(shelf);
      if (title) sections.push((section = { title, items: [] }));
      for (const k in shelf) walk(shelf[k]);
      section = null;
    } else {
      for (const k in o) walk(o[k]);
    }
  };
  walk(json);
  return { items: out, sections: sections.filter((x) => x.items.length), shuffle, next };
}

// The "Lyrics" tab of a /next response points at a page of its own.
function lyricsBrowseId(json) {
  let found = null;
  const walk = (o) => {
    if (found || !o || typeof o !== 'object') return;
    const b = o.tabRenderer?.endpoint?.browseEndpoint;
    const type = b?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType;
    if (type === 'MUSIC_PAGE_TYPE_TRACK_LYRICS' && typeof b.browseId === 'string' && BROWSE_ID.test(b.browseId)) {
      found = b.browseId;
      return;
    }
    for (const k in o) walk(o[k]);
  };
  walk(json);
  return found;
}

function parseLyrics(json) {
  let shelf = null;
  const walk = (o) => {
    if (shelf || !o || typeof o !== 'object') return;
    if (o.musicDescriptionShelfRenderer) shelf = o.musicDescriptionShelfRenderer;
    else for (const k in o) walk(o[k]);
  };
  walk(json);
  const text = (t) => (Array.isArray(t?.runs) ? t.runs.map((r) => (typeof r?.text === 'string' ? r.text : '')).join('') : '');
  return { text: text(shelf?.description).replace(/\r\n/g, '\n').slice(0, 20000), source: text(shelf?.footer).slice(0, 256) };
}

function parseSuggestions(json) {
  const out = [];
  const walk = (o) => {
    if (!o || typeof o !== 'object' || out.length >= 8) return;
    const q = o.searchSuggestionRenderer?.navigationEndpoint?.searchEndpoint?.query;
    if (typeof q === 'string' && q.trim() && !out.includes(q.trim())) out.push(q.trim().slice(0, 200));
    for (const k in o) walk(o[k]);
  };
  walk(json);
  return out;
}

// The account's playlists offered by "Save to playlist".
function parsePlaylistOptions(json) {
  const out = [];
  const walk = (o) => {
    if (!o || typeof o !== 'object') return;
    const p = o.playlistAddToOptionRenderer;
    if (p && typeof p.playlistId === 'string' && LIST_ID.test(p.playlistId)) {
      const title = (p.title?.runs || []).map((r) => (typeof r?.text === 'string' ? r.text : '')).join('').trim();
      if (title) out.push({ playlistId: p.playlistId, title: title.slice(0, 256) });
      return;
    }
    for (const k in o) walk(o[k]);
  };
  walk(json);
  return out;
}

// Artist and album links read out of the page's player bar, as relative hrefs.
function sanitizeLinks(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const l of raw.slice(0, 20)) {
    const m = typeof l?.href === 'string' && l.href.match(/(?:^|\/)(?:channel|browse)\/([A-Za-z0-9_-]{2,128})$/);
    const text = typeof l?.text === 'string' ? l.text.trim().slice(0, 256) : '';
    if (m && text) out.push({ text, browseId: m[1] });
  }
  return out;
}

// Whether a saved window spot is still on a connected display (work areas), with
// 50 px of slack so a window dragged half off an edge keeps its place.
function onDisplays(b, areas) {
  return areas.some((a) => b.x >= a.x - 50 && b.y >= a.y - 50 && b.x < a.x + a.width - 50 && b.y < a.y + a.height - 50);
}

// Last.fm counts a play once half the track, or four minutes of it, have been
// heard, and only for tracks longer than 30 seconds.
function scrobbleDue(playedSeconds, durationSeconds) {
  return durationSeconds > 30 && (playedSeconds >= durationSeconds / 2 || playedSeconds >= 240);
}

// Repeat-one plays the same track again under the same id. A jump back to its
// start after it was scrobbled is a new play; a seek before that is not.
function replayed(scrobbled, lastPosition, position) {
  return scrobbled && position < 10 && lastPosition - position > 30;
}

// The first name of a joined artist line ("A und B", "A & B", "A, B", "A feat. B").
// Only a fallback: a duo called "A & B" is split too, the player bar's links are not.
// No " x ": it would cut "Lil Nas X feat. B" down to "Lil Nas".
function primaryArtist(line) {
  const s = typeof line === 'string' ? line.trim() : '';
  return s.split(/\s+(?:und|and|&|feat\.?|ft\.?)\s+|,\s*/i)[0].trim() || s;
}

// api_sig as Last.fm defines it: parameter names and values sorted by name and
// joined without separators, the shared secret appended, md5 of that in hex.
function lastfmSignature(params, secret) {
  const base = Object.keys(params)
    .filter((k) => k !== 'format' && k !== 'callback')
    .sort()
    .map((k) => k + params[k])
    .join('');
  return crypto.createHash('md5').update(base + secret, 'utf8').digest('hex');
}

// Last.fm error codes that pass: operation failed, service offline, temporarily
// unavailable, rate limit. Anything else (bad session, invalid parameters) stays.
function lastfmRetryable(status, code) {
  return status >= 500 || [8, 11, 16, 29].includes(code);
}

// Last.fm takes up to 50 scrobbles per call, and none older than 14 days.
function pendingBatch(pending, now) {
  const list = Array.isArray(pending) ? pending : [];
  const fresh = (p) => p && typeof p.timestamp === 'number' && now / 1000 - p.timestamp < 14 * 24 * 3600;
  return { batch: list.filter(fresh).slice(0, 50), stale: list.filter((p) => !fresh(p)) };
}

// track.scrobble's batch form: artist[0], track[0], ... artist[1], ...
function scrobbleBatchParams(batch) {
  const out = {};
  batch.forEach((p, i) => {
    for (const [k, v] of Object.entries(p)) out[k + '[' + i + ']'] = v;
  });
  return out;
}

// Player bar state read out of the hidden page.
function sanitizeControls(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const pick = (v, allowed) => (allowed.includes(v) ? v : null);
  const volume = Number(raw.volume);
  return {
    shuffle: raw.shuffle === true,
    repeat: pick(raw.repeat, ['NONE', 'ALL', 'ONE']) || 'NONE',
    like: pick(raw.like, ['LIKE', 'DISLIKE', 'INDIFFERENT']),
    volume: Number.isFinite(volume) ? Math.min(100, Math.max(0, Math.round(volume))) : 100,
    muted: raw.muted === true,
  };
}

// The rendered queue, read out of the hidden page.
function sanitizeQueue(raw) {
  if (!Array.isArray(raw)) return [];
  const str = (v) => (typeof v === 'string' ? v.trim().slice(0, 256) : '');
  const out = [];
  for (const q of raw.slice(0, 500)) {
    if (!q || typeof q.videoId !== 'string' || !VIDEO_ID.test(q.videoId)) continue;
    out.push({
      videoId: q.videoId,
      title: str(q.title),
      artist: str(q.artist),
      length: str(q.length).slice(0, 12),
      thumb: httpsUrl(q.thumb),
      selected: q.selected === true,
      // Place in the reorderable list, -1 for autoplay suggestions.
      top: Number.isInteger(q.top) && q.top >= -1 ? q.top : -1,
      itemId: Number.isInteger(q.itemId) && q.itemId >= 0 ? q.itemId : null,
    });
  }
  return out;
}

// Plain x.y.z only; a tag in any other form is never newer.
function isNewer(latest, current) {
  const parts = (v) => (/^\d+\.\d+\.\d+$/.test(v) ? v.split('.').map(Number) : null);
  const a = parts(latest);
  const b = parts(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}

module.exports = {
  APP_TITLE,
  isInternal,
  onSite,
  isWebLink,
  INTERNAL_HOSTS,
  keyAction,
  sanitizeTrack,
  positionNow,
  sanitizeResume,
  sanitizeWatch,
  sanitizePlaylistWatch,
  sanitizeEndpoint,
  sanitizeQueueTarget,
  sanitizeControls,
  sanitizeQueue,
  parseItems,
  lyricsBrowseId,
  parseLyrics,
  parseSuggestions,
  parsePlaylistOptions,
  sanitizeLinks,
  onDisplays,
  scrobbleDue,
  replayed,
  primaryArtist,
  lastfmSignature,
  lastfmRetryable,
  pendingBatch,
  scrobbleBatchParams,
  CONTINUATION,
  BROWSE_ID,
  isNewer,
};
