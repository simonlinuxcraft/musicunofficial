'use strict';

const crypto = require('crypto');

const APP_TITLE = 'Music';

// Shapes of YouTube's ids. Anything that does not match is dropped, not trusted.
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const LIST_ID = /^[A-Za-z0-9_-]{2,64}$/;
const BROWSE_ID = /^[A-Za-z0-9_-]{2,128}$/;
const PARAMS = /^[A-Za-z0-9%_=-]{1,100}$/;
const CONTINUATION = /^[A-Za-z0-9%_=-]{8,4000}$/;
const TOKEN = /^[A-Za-z0-9%_=-]{8,1000}$/;
const SET_VIDEO_ID = /^[A-Za-z0-9_-]{1,64}$/;
const PRIVACY = ['PRIVATE', 'UNLISTED', 'PUBLIC'];

const REPEAT_MODES = ['NONE', 'ALL', 'ONE'];
const LIKE_STATES = ['LIKE', 'DISLIKE', 'INDIFFERENT'];

const matching = (v, re) => (typeof v === 'string' && re.test(v) ? v : null);
const pick = (v, allowed) => (allowed.includes(v) ? v : null);
const clampVolume = (v) => Math.min(100, Math.max(0, Math.round(v)));
const pageType = (b) => b?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType || '';

// Google's login flow bounces across accounts.google.com and back, so those
// hosts have to stay in-app. Everything else is a real outbound link.
const INTERNAL_HOSTS = ['youtube.com', 'google.com', 'ytimg.com', 'ggpht.com'];

function isInternal(url) {
  const host = URL.parse(url)?.hostname.toLowerCase();
  return !!host && INTERNAL_HOSTS.some((h) => host === h || host.endsWith('.' + h));
}

// Whether the player page is on YouTube Music itself, not on a consent or sign-in page.
// An empty or broken URL counts as away.
function onSite(url) {
  return URL.parse(url)?.hostname === 'music.youtube.com';
}

// What may leave the app through the system's handler. Any other scheme from the
// page could start a local program registered for it.
function isWebLink(url) {
  return ['https:', 'http:', 'mailto:'].includes(URL.parse(url)?.protocol);
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
  return URL.parse(v)?.protocol === 'https:' ? v : '';
}

const str = (v) => (typeof v === 'string' ? v.trim().slice(0, 256) : '');
const num = (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0);

// When a position was measured, so consumers can project it forward. A missing
// or absurd stamp falls back to now.
function stampAt(at, now = Date.now()) {
  return typeof at === 'number' && Number.isFinite(at) && at <= now && now - at <= 60000 ? at : now;
}

// Track data arrives over IPC from a window that runs YouTube's own code, and
// parts of it are forwarded to Discord. Everything is clamped and retyped here
// rather than trusted.
function sanitizeTrack(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const title = str(raw.title);
  if (!title) return null;

  // Only https images. A file: or data: url here would be handed straight to
  // Discord and rendered by the mini player.
  const art = httpsUrl(raw.art);

  return {
    title,
    artist: str(raw.artist),
    album: str(raw.album),
    art,
    playing: raw.playing === true,
    ad: raw.ad === true,
    like: pick(raw.like, LIKE_STATES),
    videoId: matching(raw.videoId, VIDEO_ID),
    video: raw.video === true,
    shuffle: raw.shuffle === true,
    repeat: pick(raw.repeat, REPEAT_MODES) || 'NONE',
    volume: Number.isFinite(raw.volume) ? clampVolume(raw.volume) : 100,
    muted: raw.muted === true,
    avMode: pick(raw.avMode, ['ATV_PREFERRED', 'OMV_PREFERRED']),
    avAvailable: raw.avAvailable === true,
    adSkip: raw.adSkip === true,
    position: num(raw.position),
    duration: num(raw.duration),
    at: stampAt(raw.at),
  };
}

// Position projected to right now. Only advances while playing, and never runs
// past the end of the track.
function positionNow(track, now = Date.now()) {
  if (!track || !(track.duration > 0)) return 0;
  const elapsed = track.playing ? Math.max(0, now - (track.at || now)) / 1000 : 0;
  return Math.min(track.duration, track.position + elapsed);
}

// A resume snapshot becomes a navigation target on next launch: no valid id, no resume.
function sanitizeResume(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const videoId = matching(raw.videoId, VIDEO_ID);
  if (!videoId) return null;

  return {
    videoId,
    list: matching(raw.list, LIST_ID),
    position: num(raw.position),
    duration: num(raw.duration),
    playing: raw.playing === true,
    at: stampAt(raw.at),
  };
}

// Only the ids a navigation needs. The rest of a watchEndpoint (params, tracking)
// stays behind, so nothing from a response is replayed into the page unchecked.
function sanitizeWatch(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const videoId = matching(raw.videoId, VIDEO_ID);
  if (!videoId) return null;
  const playlistId = matching(raw.playlistId, LIST_ID);
  return playlistId ? { videoId, playlistId } : { videoId };
}

// A playlist or album header's shuffle entry, which plays the whole list shuffled.
function sanitizePlaylistWatch(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const playlistId = matching(raw.playlistId, LIST_ID);
  if (!playlistId) return null;
  const params = matching(raw.params, PARAMS);
  return params ? { playlistId, params } : { playlistId };
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

// What "play next" and "add to queue" put in: one track, several (a selection) or a whole list.
function sanitizeQueueTarget(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const ids = videoIds(raw.videoIds);
  if (ids) return { videoIds: ids };
  const videoId = matching(raw.videoId, VIDEO_ID);
  if (videoId) return { videoId };
  const playlistId = matching(raw.playlistId, LIST_ID);
  return playlistId ? { playlistId } : null;
}

// A library change named by one of YouTube's own endpoints: a feedback token
// (save a song, not interested) or a like on a list (save an album or playlist).
function changeOf(raw) {
  const feedback = matching(raw?.feedbackEndpoint?.feedbackToken, TOKEN);
  if (feedback) return { kind: 'feedback', feedback };
  const like = raw?.likeEndpoint;
  const playlistId = matching(like?.target?.playlistId, LIST_ID);
  return playlistId && ['LIKE', 'INDIFFERENT'].includes(like.status) ? { kind: 'like', like: playlistId, status: like.status } : null;
}

// A save-to-library toggle. Signed out, saving is a sign-in prompt, so save is null.
function libraryToggle(t, save, unsave) {
  const out = { saved: t.isToggled === true, save: changeOf(save), unsave: changeOf(unsave) };
  return out.save || out.unsave ? out : null;
}

const videoIds = (v) => (Array.isArray(v) && v.length && v.length <= 500 && v.every((id) => matching(id, VIDEO_ID)) ? v : null);
const editPlaylist = (playlistId, actions) => ['/browse/edit_playlist', { playlistId, actions }];

// The InnerTube call for one change the UI asks for, as [endpoint, body], or null
// when anything in it is off. Only these calls leave the UI.
const changeRequest = (c) => buildChange(c) || null;

function buildChange(c) {
  if (!c || typeof c !== 'object') return null;
  const list = matching(c.playlistId, LIST_ID);
  const ids = videoIds(c.videoIds);
  const title = typeof c.title === 'string' ? c.title.trim().slice(0, 150) : '';
  switch (c.kind) {
    case 'feedback':
      return matching(c.feedback, TOKEN) && ['/feedback', { feedbackTokens: [c.feedback] }];
    case 'like':
      if (!matching(c.like, LIST_ID) || !['LIKE', 'INDIFFERENT'].includes(c.status)) return null;
      return [c.status === 'LIKE' ? '/like/like' : '/like/removelike', { target: { playlistId: c.like } }];
    case 'subscribe':
      if (!matching(c.channelId, BROWSE_ID)) return null;
      return [c.on ? '/subscription/subscribe' : '/subscription/unsubscribe', { channelIds: [c.channelId] }];
    case 'create':
      return title && ids && ['/playlist/create', { title, privacyStatus: 'PRIVATE', videoIds: ids }];
    case 'add':
      return list && ids && editPlaylist(list, ids.map((id) => ({ action: 'ACTION_ADD_VIDEO', addedVideoId: id })));
    case 'remove': {
      const rows = Array.isArray(c.rows) && c.rows.length <= 500 ? c.rows : [];
      if (!list || !rows.length || !rows.every((r) => matching(r?.videoId, VIDEO_ID) && matching(r?.setVideoId, SET_VIDEO_ID))) return null;
      return editPlaylist(list, rows.map((r) => ({ action: 'ACTION_REMOVE_VIDEO', removedVideoId: r.videoId, setVideoId: r.setVideoId })));
    }
    case 'rename':
      return list && title && editPlaylist(list, [{ action: 'ACTION_SET_PLAYLIST_NAME', playlistName: title }]);
    case 'privacy':
      return list && pick(c.privacy, PRIVACY) && editPlaylist(list, [{ action: 'ACTION_SET_PLAYLIST_PRIVACY', playlistPrivacy: c.privacy }]);
    case 'delete':
      return list && ['/playlist/delete', { playlistId: list }];
  }
  return null;
}

// Error answers carry an error object, playlist edits a status, feedback a flag per token.
const changeDone = (res) =>
  !!res && !res.error && (!res.status || res.status === 'STATUS_SUCCEEDED') && (res.feedbackResponses || []).every((r) => r?.isProcessed !== false);

// Tracks and cards of a browse or search response, grouped by shelf, plus the
// header's shuffle entry and the next page token. Walks the whole tree because
// the shelves change per page and over time, the item renderers have stayed put.
function parseItems(json) {
  const out = [];
  const sections = [];
  let section = null;
  let shuffle = null;
  let next = null;
  let library = null;
  let subscribe = null;
  let own = null;
  const runsOf = (t) => (Array.isArray(t?.runs) ? t.runs.filter((r) => typeof r?.text === 'string') : []);
  const text = (t) => runsOf(t).map((r) => r.text).join('').trim().slice(0, 256);
  const browseOf = (b) => matching(b?.browseId, BROWSE_ID);
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
      const t = entry?.toggleMenuServiceItemRenderer;
      if (t?.defaultIcon?.iconType === 'BOOKMARK_BORDER') item.library = libraryToggle(t, t.defaultServiceEndpoint, t.toggledServiceEndpoint);
      const v = entry && (entry.menuNavigationItemRenderer || entry.menuServiceItemRenderer);
      const icon = v?.icon?.iconType;
      const nav = v?.navigationEndpoint || {};
      const service = v?.serviceEndpoint || {};
      if (icon === 'MUSIC_SHUFFLE') item.shuffle = item.shuffle || sanitizeEndpoint(nav);
      else if (icon === 'MIX') item.radio = item.radio || sanitizeEndpoint(nav);
      else if (icon === 'NOT_INTERESTED') item.notInterested = changeOf(service);
      else if (service.playlistEditEndpoint) {
        const a = (service.playlistEditEndpoint.actions || []).find((x) => x?.action === 'ACTION_REMOVE_VIDEO');
        const playlistId = matching(service.playlistEditEndpoint.playlistId, LIST_ID);
        if (playlistId && matching(a?.setVideoId, SET_VIDEO_ID) && matching(a.removedVideoId, VIDEO_ID)) {
          item.remove = { playlistId, setVideoId: a.setVideoId, videoId: a.removedVideoId };
        }
      } else if (service.queueAddEndpoint) item.queue = item.queue || sanitizeQueueTarget(service.queueAddEndpoint.queueTarget);
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
  const overlayPlay = (o) => o?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer?.playNavigationEndpoint;
  const shelfTitle = (sh) => text(sh.title) || text(Object.values(sh.header || {})[0]?.title);
  // A list row, a card or the top result. menuOf() and push() fill in the rest.
  const entry = ({ index = '', title, subtitle, parts, thumb, card = false, watch, browse, play }) => ({
    play: sanitizeEndpoint(play),
    shuffle: null,
    radio: null,
    queue: null,
    artistId: null,
    albumId: null,
    library: null,
    notInterested: null,
    remove: null,
    index,
    title,
    subtitle,
    parts,
    thumb,
    card,
    watch,
    browseId: watch ? null : browseOf(browse),
  });
  const walk = (o) => {
    if (!o || typeof o !== 'object') return;
    // The page's own buttons: save to library, subscribe, and the editor of a playlist of the account's own.
    const tb = o.toggleButtonRenderer;
    if (!library && tb?.defaultIcon?.iconType === 'BOOKMARK_BORDER') {
      library = libraryToggle(tb, tb.defaultServiceEndpoint || tb.defaultNavigationEndpoint, tb.toggledServiceEndpoint || tb.toggledNavigationEndpoint);
    }
    const sb = o.subscribeButtonRenderer;
    if (!subscribe && matching(sb?.channelId, BROWSE_ID)) subscribe = { channelId: sb.channelId, subscribed: sb.subscribed === true };
    if (!own && o.musicPlaylistEditHeaderRenderer) own = { privacy: pick(o.musicPlaylistEditHeaderRenderer.privacy, PRIVACY) };
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
      const titleWatch = runsOf(cols[0])[0]?.navigationEndpoint?.watchEndpoint;
      const rowWatch = li.playlistItemData && { videoId: li.playlistItemData.videoId };
      const watch = sanitizeWatch(play?.watchEndpoint || titleWatch || rowWatch);
      const links = parts(cols[1]);
      for (const f of fixed) links.push(...(links.length ? [{ text: ' • ', browseId: null }] : []), { text: f, browseId: null });
      const item = entry({
        index: text(li.index),
        title: text(cols[0]),
        subtitle: links.map((r) => r.text).join('').trim(),
        parts: links,
        thumb: thumb(li.thumbnail, 96),
        watch,
        browse: li.navigationEndpoint?.browseEndpoint,
        play,
      });
      push(item, li.menu, links);
    } else if (card) {
      const nav = card.navigationEndpoint || {};
      const links = parts(card.subtitle);
      const item = entry({
        title: text(card.title),
        subtitle: text(card.subtitle),
        parts: links,
        thumb: thumb(card.thumbnailRenderer, 300),
        card: true,
        watch: sanitizeWatch(nav.watchEndpoint),
        browse: nav.browseEndpoint,
        play: overlayPlay(card.thumbnailOverlay),
      });
      push(item, card.menu, links);
    } else if (top) {
      // Search's top result: the entity itself, then the tracks the card lists under it.
      const nav = runsOf(top.title)[0]?.navigationEndpoint || {};
      const links = parts(top.subtitle);
      const item = entry({
        title: text(top.title),
        subtitle: text(top.subtitle),
        parts: links,
        thumb: thumb(top.thumbnail, 96),
        watch: sanitizeWatch(nav.watchEndpoint),
        browse: nav.browseEndpoint,
        play: overlayPlay(top.thumbnailOverlay),
      });
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
  return { items: out, sections: sections.filter((x) => x.items.length), shuffle, next, library, subscribe, own };
}

// The "Lyrics" tab of a /next response points at a page of its own.
function lyricsBrowseId(json) {
  let found = null;
  const walk = (o) => {
    if (found || !o || typeof o !== 'object') return;
    const b = o.tabRenderer?.endpoint?.browseEndpoint;
    if (pageType(b) === 'MUSIC_PAGE_TYPE_TRACK_LYRICS' && matching(b.browseId, BROWSE_ID)) {
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
    if (p && matching(p.playlistId, LIST_ID)) {
      const title = (p.title?.runs || []).map((r) => (typeof r?.text === 'string' ? r.text : '')).join('').trim();
      if (title) out.push({ playlistId: p.playlistId, title: title.slice(0, 256) });
      return;
    }
    for (const k in o) walk(o[k]);
  };
  walk(json);
  return out;
}

// The dialog's options with cover and subtitle from the library's playlist page,
// which has them; the add-to-playlist answer has titles only.
function withCovers(options, library) {
  const byId = new Map((library?.items || []).map((i) => [i.browseId, i]));
  return options.map((o) => {
    const i = byId.get('VL' + o.playlistId);
    return { ...o, thumb: i ? i.thumb : '', subtitle: i ? i.subtitle : '' };
  });
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
  const volume = Number(raw.volume);
  return {
    shuffle: raw.shuffle === true,
    repeat: pick(raw.repeat, REPEAT_MODES) || 'NONE',
    like: pick(raw.like, LIKE_STATES),
    volume: Number.isFinite(volume) ? clampVolume(volume) : 100,
    muted: raw.muted === true,
  };
}

// The rendered queue, read out of the hidden page.
function sanitizeQueue(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const q of raw.slice(0, 500)) {
    if (!q || !matching(q.videoId, VIDEO_ID)) continue;
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
  keyAction,
  sanitizeTrack,
  positionNow,
  sanitizeResume,
  sanitizeWatch,
  sanitizeEndpoint,
  sanitizeQueueTarget,
  changeRequest,
  changeDone,
  withCovers,
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
  REPEAT_MODES,
  clampVolume,
  isNewer,
};
