'use strict';

const crypto = require('crypto');

const APP_TITLE = 'Music';

// Shapes of YouTube's ids. Anything that does not match is dropped, not trusted.
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const LIST_ID = /^[A-Za-z0-9_-]{2,64}$/;
const BROWSE_ID = /^[A-Za-z0-9_-]{2,128}$/;
const PARAMS = /^[A-Za-z0-9%_=-]{1,100}$/;
// Browse and search params of chips and "see all" links run longer than a watch's.
const PAGE_PARAMS = /^[A-Za-z0-9%_=-]{1,400}$/;
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
// After signing in, Google sets the session on the country's domain too (accounts.google.de);
// sent to the browser, that step leaves the login hanging. Only the accounts host, no other.
const ACCOUNTS_CC = /^accounts\.google\.(?:[a-z]{2,3}|co\.[a-z]{2}|com\.[a-z]{2})$/;

function isInternal(url) {
  const host = URL.parse(url)?.hostname.toLowerCase();
  return !!host && (ACCOUNTS_CC.test(host) || INTERNAL_HOSTS.some((h) => host === h || host.endsWith('.' + h)));
}

// Whether the player page is on YouTube Music itself, not on a consent or sign-in page.
// An empty or broken URL counts as away.
function onSite(url) {
  return URL.parse(url)?.hostname === 'music.youtube.com';
}

const SITE = 'https://music.youtube.com/';

// Ids are validated before they get here; encoded anyway so a format change cannot add parameters.
function watchUrl(videoId, list) {
  let u = SITE + 'watch?v=' + encodeURIComponent(videoId);
  if (list) u += '&list=' + encodeURIComponent(list);
  return u;
}

const SLEEP_CHOICES = ['off', 'track', 15, 30, 45, 60, 90];

// Whether the settings page may set key to value. Quality names come from the page.
function validSetting(key, value, qualities) {
  if (key === 'language') return ['system', 'de', 'en'].includes(value);
  if (key === 'videoQuality') return qualities.includes(value);
  if (key === 'notify' || key === 'richPresence' || key === 'syncedLyrics' || key === 'miniLyrics') return typeof value === 'boolean';
  if (key === 'sleep') return SLEEP_CHOICES.includes(value);
  return false;
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
    aspect: Number.isFinite(raw.aspect) && raw.aspect >= 0.3 && raw.aspect <= 4 ? Math.round(raw.aspect * 1000) / 1000 : 0,
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

// True while at most max calls fell into the last windowMs, so a renderer that
// crashes on load is not restarted forever.
function rateLimit(max, windowMs) {
  let times = [];
  return (now = Date.now()) => {
    times = times.filter((t) => now - t < windowMs).concat(now);
    return times.length <= max;
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
    case 'rate': {
      const path = { LIKE: '/like/like', DISLIKE: '/like/dislike', INDIFFERENT: '/like/removelike' }[pick(c.status, LIKE_STATES)];
      return path && matching(c.videoId, VIDEO_ID) && [path, { target: { videoId: c.videoId } }];
    }
    case 'subscribe':
      if (!matching(c.channelId, BROWSE_ID)) return null;
      return [c.on ? '/subscription/subscribe' : '/subscription/unsubscribe', { channelIds: [c.channelId] }];
    case 'create': {
      // Empty from the library's + button, with tracks from a menu.
      const none = Array.isArray(c.videoIds) && !c.videoIds.length;
      return title && (ids || none) && ['/playlist/create', { title, privacyStatus: 'PRIVATE', ...(ids ? { videoIds: ids } : {}) }];
    }
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

// "Random Access Memories (Drumless Edition)" -> the name and the edition apart, so the
// edition can sit under a large title instead of being cut off. Only suffixes that name
// a release form; "(feat. X)" and ordinary brackets stay in the title.
const EDITION =
  /edition|deluxe|remaster|anniversary|jubil|soundtrack|expanded|ausgabe|fassung|reissue|collector|\b(live|version|mono|stereo|bonus|special|acoustic|akustik|instrumental|demos?|edit|remix|mix|redux|sessions?|extended)\b/i;
function splitEdition(title) {
  const t = typeof title === 'string' ? title.trim() : '';
  const m = t.match(/^(.+?)\s*[([]([^()[\]]{2,60})[)\]]$/) || t.match(/^(.+?)\s+[-\u2013\u2014]\s+([^-\u2013\u2014]{2,60})$/);
  if (!m || !EDITION.test(m[2]) || /^(feat|ft|with|mit)\b/i.test(m[2])) return { base: t, edition: '' };
  return { base: m[1].trim(), edition: m[2].trim() };
}

// What a result is: songs and videos by their video type, the rest by the page they open.
// Every type but the audio track and the episode is a video (OMV, UGC, SHOULDER and more).
const VIDEO_KINDS = { MUSIC_VIDEO_TYPE_ATV: 'song', MUSIC_VIDEO_TYPE_PODCAST_EPISODE: 'episode' };
const PAGE_KINDS = {
  MUSIC_PAGE_TYPE_ALBUM: 'album',
  MUSIC_PAGE_TYPE_ARTIST: 'artist',
  MUSIC_PAGE_TYPE_LIBRARY_ARTIST: 'artist',
  MUSIC_PAGE_TYPE_PLAYLIST: 'playlist',
  MUSIC_PAGE_TYPE_USER_CHANNEL: 'profile',
  MUSIC_PAGE_TYPE_PODCAST_SHOW_DETAIL_PAGE: 'podcast',
  MUSIC_PAGE_TYPE_NON_MUSIC_AUDIO_TRACK_PAGE: 'episode',
};
function kindOf(watch, browse) {
  if (!watch) return PAGE_KINDS[pageType(browse)] || '';
  const type = watch.watchEndpointMusicSupportedConfigs?.watchEndpointMusicConfig?.musicVideoType;
  return VIDEO_KINDS[type] || (typeof type === 'string' ? 'video' : 'song');
}

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
  let header = null;
  let chips = null;
  // Rows inside search's top result card belong beside it, not in the list under it.
  let underTop = false;
  const runsOf = (t) => (Array.isArray(t?.runs) ? t.runs.filter((r) => typeof r?.text === 'string') : []);
  const text = (t, max = 256) => runsOf(t).map((r) => r.text).join('').trim().slice(0, max);
  const browseOf = (b) => matching(b?.browseId, BROWSE_ID);
  // A browse or search target with its params, as chips and "see all" links carry them.
  const target = (b) => {
    // Params that fail the check drop the target; without them it would open the unfiltered page.
    if (b?.params !== undefined && !matching(b.params, PAGE_PARAMS)) return null;
    const params = matching(b?.params, PAGE_PARAMS);
    if (b?.query !== undefined) {
      const query = typeof b.query === 'string' ? b.query.trim().slice(0, 200) : '';
      return query ? { query, params } : null;
    }
    const browseId = browseOf(b);
    return browseId ? { browseId, params } : null;
  };
  // The smallest picture that is still sharp at the size it is shown, so a long
  // list does not decode 544 px covers for 48 px rows.
  const thumb = (t, min) => {
    const raw = (t?.musicThumbnailRenderer || t?.croppedSquareThumbnailRenderer)?.thumbnail?.thumbnails;
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
    item.underTop = underTop;
    if (!item.play) item.play = item.watch ? { watchEndpoint: item.watch } : null;
    if (!section) sections.push((section = { title: '', items: [] }));
    section.items.push(item);
    out.push(item);
  };
  const overlayPlay = (o) => o?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer?.playNavigationEndpoint;
  const shelfTitle = (sh) => text(sh.title) || text(Object.values(sh.header || {})[0]?.title);
  const shelfMore = (sh) =>
    target(Object.values(sh.header || {})[0]?.moreContentButton?.buttonRenderer?.navigationEndpoint?.browseEndpoint) ||
    target(sh.bottomEndpoint?.browseEndpoint) ||
    target(sh.bottomEndpoint?.searchEndpoint);
  const ROUND = ['MUSIC_PAGE_TYPE_ARTIST', 'MUSIC_PAGE_TYPE_USER_CHANNEL', 'MUSIC_PAGE_TYPE_LIBRARY_ARTIST'];
  // The head of a playlist, album or artist page: what the page is, drawn above its list.
  const headerOf = (o) => {
    const l = o.musicResponsiveHeaderRenderer || o.musicDetailHeaderRenderer;
    if (l) {
      const buttons = Array.isArray(l.buttons) ? l.buttons : [];
      // The head's own play button, and from its menu shuffle, mix and queueing the whole list.
      const acts = { shuffle: null, radio: null, queue: null };
      for (const b of buttons) if (b?.menuRenderer) menuOf(b, acts);
      const playBtn = buttons.find((b) => b?.musicPlayButtonRenderer)?.musicPlayButtonRenderer;
      const face = l.facepile?.avatarStackViewModel;
      const avatars = (Array.isArray(face?.avatars) ? face.avatars : []).flatMap((a) => a?.avatarViewModel?.image?.sources || []);
      const avatar = avatars.filter((x) => httpsUrl(x?.url)).sort((a, b) => (a.width || 0) - (b.width || 0)).find((x) => x.width >= 48);
      return {
        kind: 'list',
        title: text(l.title),
        ...splitEdition(text(l.title)),
        subtitle: text(l.subtitle),
        second: text(l.secondSubtitle),
        strap: parts(l.straplineTextOne),
        thumb: thumb(l.thumbnail, 400),
        description: text(l.description?.musicDescriptionShelfRenderer?.description || l.description, 1200),
        play: sanitizeEndpoint(playBtn?.playNavigationEndpoint),
        shuffle: acts.shuffle,
        radio: acts.radio,
        queue: acts.queue,
        owner: typeof face?.text?.content === 'string' ? face.text.content.trim().slice(0, 128) : '',
        ownerThumb: avatar ? avatar.url : thumb(l.straplineThumbnail, 48),
      };
    }
    const a = o.musicImmersiveHeaderRenderer || o.musicVisualHeaderRenderer;
    if (!a) return null;
    return {
      kind: 'artist',
      title: text(a.title),
      base: text(a.title),
      edition: '',
      subtitle: text(a.monthlyListenerCount) || text(a.subscriptionButton?.subscribeButtonRenderer?.subscriberCountText),
      second: '',
      strap: [],
      thumb: thumb(a.thumbnail, 1400) || thumb(a.foregroundThumbnail, 400),
      description: text(a.description, 1200),
      // The artist's own shuffle and radio, from the head's two buttons.
      shuffle: sanitizeEndpoint(a.playButton?.buttonRenderer?.navigationEndpoint),
      radio: sanitizeEndpoint(a.startRadioButton?.buttonRenderer?.navigationEndpoint),
    };
  };
  const chipOf = (c) => {
    const to$ = (nav) => target(nav?.browseEndpoint || nav?.searchEndpoint);
    const to = (c.isSelected === true && to$(c.onDeselectedCommand)) || to$(c.navigationEndpoint);
    const label = text(c.text, 64);
    return to && label ? { text: label, selected: c.isSelected === true, ...to } : null;
  };
  // A list row, a card or the top result. menuOf() and push() fill in the rest.
  const entry = ({ index = '', title, subtitle, parts, thumb, big = '', card = false, watch, rawWatch, browse, play, row = {} }) => ({
    ...splitEdition(title),
    kind: kindOf(watch ? rawWatch || {} : null, browse),
    byline: row.byline || parts,
    album: row.album || null,
    extra: row.extra || '',
    duration: row.duration || '',
    explicit: row.explicit === true,
    like: row.like || null,
    round: !watch && ROUND.includes(pageType(browse)),
    top: row.top === true,
    underTop: false,
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
    big,
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
    if (!header) header = headerOf(o);
    if (!chips && Array.isArray(o.chipCloudRenderer?.chips)) {
      chips = o.chipCloudRenderer.chips.map((c) => c?.chipCloudChipRenderer && chipOf(c.chipCloudChipRenderer)).filter(Boolean).slice(0, 20);
    }
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
      const rawWatch = play?.watchEndpoint || titleWatch || rowWatch || li.navigationEndpoint?.watchEndpoint;
      const watch = sanitizeWatch(rawWatch);
      const byline = parts(cols[1]);
      const links = parts(cols[1]);
      for (const f of fixed) links.push(...(links.length ? [{ text: ' • ', browseId: null }] : []), { text: f, browseId: null });
      // Past the byline: the album as a link (playlists, artist pages), else plays or views.
      let album = null;
      let extra = '';
      for (const c of cols.slice(2)) {
        const al = runsOf(c).find((r) => browseOf(r.navigationEndpoint?.browseEndpoint)?.startsWith('MPRE'));
        if (al && !album) album = { text: al.text.slice(0, 256), browseId: browseOf(al.navigationEndpoint.browseEndpoint) };
        else if (!al && !extra) extra = text(c);
      }
      const top = li.menu?.menuRenderer?.topLevelButtons;
      const lb = (Array.isArray(top) ? top : []).map((b) => b?.likeButtonRenderer).find(Boolean);
      const row = {
        byline,
        album,
        extra,
        duration: fixed.find((f) => /^\d{1,2}(:\d\d){1,2}$/.test(f)) || '',
        explicit: (Array.isArray(li.badges) ? li.badges : []).some((b) => b?.musicInlineBadgeRenderer?.icon?.iconType === 'MUSIC_EXPLICIT_BADGE'),
        like: watch && lb?.target?.videoId === watch.videoId ? pick(lb.likeStatus, LIKE_STATES) : null,
      };
      const item = entry({
        index: text(li.index),
        title: text(cols[0]),
        subtitle: links.map((r) => r.text).join('').trim(),
        parts: links,
        thumb: thumb(li.thumbnail, 96),
        // For search's shelves, where a row becomes a card.
        big: thumb(li.thumbnail, 226),
        watch,
        rawWatch,
        browse: li.navigationEndpoint?.browseEndpoint,
        play,
        row,
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
        rawWatch: nav.watchEndpoint,
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
        thumb: thumb(top.thumbnail, 226),
        watch: sanitizeWatch(nav.watchEndpoint),
        rawWatch: nav.watchEndpoint,
        browse: nav.browseEndpoint,
        play: overlayPlay(top.thumbnailOverlay),
        row: { top: true },
      });
      // A section of its own, so the card and its rows are not mixed into the list before it.
      section = null;
      push(item, top.menu, links);
      underTop = true;
      for (const c of top.contents || []) walk(c);
      underTop = false;
      section = null;
    } else if (shelf) {
      // A titled shelf opens its own section; whatever follows it starts a fresh one.
      section = null;
      const title = shelfTitle(shelf);
      if (title) sections.push((section = { title, items: [], more: shelfMore(shelf) }));
      for (const k in shelf) walk(shelf[k]);
      section = null;
    } else {
      for (const k in o) walk(o[k]);
    }
  };
  walk(json);
  return { items: out, sections: sections.filter((x) => x.items.length), shuffle, next, library, subscribe, own, header, chips: chips || [] };
}

// The signed-in account's name and picture, from the account menu.
function parseAccount(json) {
  let h = null;
  const walk = (o) => {
    if (h || !o || typeof o !== 'object') return;
    if (o.activeAccountHeaderRenderer) h = o.activeAccountHeaderRenderer;
    else for (const k in o) walk(o[k]);
  };
  walk(json);
  if (!h) return null;
  const text = (t) => (Array.isArray(t?.runs) ? t.runs.map((r) => (typeof r?.text === 'string' ? r.text : '')).join('').trim().slice(0, 128) : '');
  const photos = (Array.isArray(h.accountPhoto?.thumbnails) ? h.accountPhoto.thumbnails : []).filter((x) => httpsUrl(x?.url));
  const photo = photos.sort((a, b) => (a.width || 0) - (b.width || 0)).find((x) => x.width >= 64) || photos[photos.length - 1];
  return { name: text(h.accountName), handle: text(h.channelHandle), photo: photo ? photo.url : '' };
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
  // Under the typed completions YouTube Music suggests artists, songs and albums directly.
  return { texts: out, items: parseItems(json).items.slice(0, 6) };
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
// Timed lyrics in LRC form ("[01:02.34] text") as [{ time, text }] in seconds, in order.
// Lines without a time stamp (credits, [ar:] tags) are dropped.
function parseLrc(lrc) {
  if (typeof lrc !== 'string') return [];
  const out = [];
  for (const raw of lrc.slice(0, 200000).split(/\r?\n/)) {
    const stamps = [...raw.matchAll(/\[(\d{1,3}):(\d{1,2}(?:\.\d{1,3})?)\]/g)];
    if (!stamps.length) continue;
    const text = raw.replace(/\[[^\]]*\]/g, '').trim().slice(0, 300);
    for (const m of stamps) out.push({ time: Number(m[1]) * 60 + Number(m[2]), text });
  }
  return out.sort((a, b) => a.time - b.time).slice(0, 3000);
}

// Of LRCLIB's results the synced one whose length is closest to the playing track,
// within a few seconds; another recording of the same song would run out of step.
function pickSynced(results, duration) {
  const synced = (Array.isArray(results) ? results : [results]).filter((r) => typeof r?.syncedLyrics === 'string' && r.syncedLyrics.trim());
  if (!(duration > 0)) return synced[0] || null;
  const gap = (r) => (Number.isFinite(r.duration) ? Math.abs(r.duration - duration) : Infinity);
  return synced.filter((r) => gap(r) <= 4).sort((a, b) => gap(a) - gap(b))[0] || null;
}

// A YouTube Music title without the parts lyrics sites leave out: features, "official video" and the like.
function lyricsTitle(title) {
  const t = typeof title === 'string' ? title : '';
  return t.replace(/\s*[([](?:feat\.?|ft\.?|mit|with|official|offizielle[sr]?|music video|video|audio|lyric[s]?|visuali[sz]er)\b[^)\]]*[)\]]/gi, '').trim().slice(0, 200) || t.trim().slice(0, 200);
}

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
  SITE,
  watchUrl,
  validSetting,
  rateLimit,
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
  splitEdition,
  lyricsBrowseId,
  parseLyrics,
  parseSuggestions,
  parseAccount,
  PAGE_PARAMS,
  parseLrc,
  pickSynced,
  lyricsTitle,
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
