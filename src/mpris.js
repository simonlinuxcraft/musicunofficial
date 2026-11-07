'use strict';

// Our own MPRIS player on the session bus, for media keys and the desktop's media
// controls. Chromium's own one is switched off in main.js: it registers as
// "chromium.instance<pid>" with no desktop entry, so desktops show it as Chromium
// without the app's icon, and it only appears once the page has played unmuted.

const dbus = require('@homebridge/dbus-native');
const { positionNow } = require('./pure');

const NAME = 'org.mpris.MediaPlayer2.musicunofficial';
const PATH = '/org/mpris/MediaPlayer2';
const PLAYER = 'org.mpris.MediaPlayer2.Player';
const NO_TRACK = '/org/mpris/MediaPlayer2/TrackList/NoTrack';
// MPRIS counts time in microseconds.
const US = 1e6;
const DO_NOT_QUEUE = 4;
const PRIMARY_OWNER = 1;

let bus = null;
let track = null;
let actions = null;

const ROOT_IFACE = {
  name: 'org.mpris.MediaPlayer2',
  methods: { Raise: ['', ''], Quit: ['', ''] },
  properties: {
    CanQuit: 'b',
    CanRaise: 'b',
    HasTrackList: 'b',
    Identity: 's',
    DesktopEntry: 's',
    SupportedUriSchemes: 'as',
    SupportedMimeTypes: 'as',
  },
  signals: {},
};

const PLAYER_IFACE = {
  name: PLAYER,
  methods: {
    Next: ['', ''],
    Previous: ['', ''],
    Pause: ['', ''],
    PlayPause: ['', ''],
    Stop: ['', ''],
    Play: ['', ''],
    Seek: ['x', '', ['Offset']],
    SetPosition: ['ox', '', ['TrackId', 'Position']],
    OpenUri: ['s', '', ['Uri']],
  },
  properties: {
    PlaybackStatus: 's',
    LoopStatus: 's',
    Rate: 'd',
    Shuffle: 'b',
    Metadata: 'a{sv}',
    Volume: 'd',
    Position: 'x',
    MinimumRate: 'd',
    MaximumRate: 'd',
    CanGoNext: 'b',
    CanGoPrevious: 'b',
    CanPlay: 'b',
    CanPause: 'b',
    CanSeek: 'b',
    CanControl: 'b',
  },
  signals: { Seeked: ['x', 'Position'] },
};

// Object path segments allow letters, digits and underscores only.
const trackId = (t) => '/org/musicunofficial/track/' + (t.videoId ? t.videoId.replace(/[^A-Za-z0-9_]/g, '_') : 'current');

function metadata(t) {
  if (!t) return [['mpris:trackid', ['o', NO_TRACK]]];
  const m = [
    ['mpris:trackid', ['o', trackId(t)]],
    ['xesam:title', ['s', t.title]],
  ];
  if (t.artist) m.push(['xesam:artist', ['as', [t.artist]]]);
  if (t.album) m.push(['xesam:album', ['s', t.album]]);
  if (t.art) m.push(['mpris:artUrl', ['s', t.art]]);
  if (t.duration > 0) m.push(['mpris:length', ['x', Math.round(t.duration * US)]]);
  if (t.videoId) m.push(['xesam:url', ['s', 'https://music.youtube.com/watch?v=' + t.videoId]]);
  return m;
}

// Seeked follows from update() once the page confirms the jump, like any other seek.
function seekTo(seconds) {
  if (!track || !(track.duration > 0)) return;
  actions.command('seek', Math.min(Math.max(0, seconds), track.duration));
}

const root = {
  CanQuit: true,
  CanRaise: true,
  HasTrackList: false,
  Identity: 'MusicUnofficial',
  DesktopEntry: 'musicunofficial',
  SupportedUriSchemes: [],
  SupportedMimeTypes: [],
  Raise: () => actions.raise(),
  Quit: () => actions.quit(),
};

// MPRIS names for the player bar's repeat modes.
const LOOP = { NONE: 'None', ALL: 'Playlist', ONE: 'Track' };

// Properties are read straight off this object on every Get, and the writable
// ones are set through it; both go through the current track.
const player = {
  get PlaybackStatus() {
    return !track ? 'Stopped' : track.playing ? 'Playing' : 'Paused';
  },
  get Metadata() {
    return metadata(track);
  },
  get Position() {
    return track ? Math.round(positionNow(track) * US) : 0;
  },
  get Volume() {
    return !track ? 1 : track.muted ? 0 : track.volume / 100;
  },
  set Volume(v) {
    if (typeof v === 'number' && Number.isFinite(v)) actions.control('volume', Math.round(Math.min(1, Math.max(0, v)) * 100));
  },
  get LoopStatus() {
    return LOOP[track ? track.repeat : 'NONE'];
  },
  set LoopStatus(v) {
    const mode = Object.keys(LOOP).find((k) => LOOP[k] === v);
    if (mode) actions.control('repeatTo', mode);
  },
  get Shuffle() {
    return !!(track && track.shuffle);
  },
  set Shuffle(v) {
    if (typeof v === 'boolean') actions.control('shuffleTo', v);
  },
  get CanGoNext() {
    return !!track;
  },
  get CanGoPrevious() {
    return !!track;
  },
  get CanPlay() {
    return !!track;
  },
  get CanPause() {
    return !!track;
  },
  get CanSeek() {
    return !!track;
  },
  Rate: 1,
  MinimumRate: 1,
  MaximumRate: 1,
  CanControl: true,
  Next: () => actions.command('next'),
  Previous: () => actions.command('previous'),
  Pause: () => actions.command('pause'),
  PlayPause: () => actions.command('playpause'),
  Stop: () => actions.command('pause'),
  Play: () => actions.command('play'),
  Seek: (offset) => track && seekTo(positionNow(track) + offset / US),
  // Ignored for a track that is no longer the current one, as the spec asks.
  SetPosition: (id, position) => track && id === trackId(track) && seekTo(position / US),
  OpenUri: () => {},
  // Replaced by the bus with one that also sends the signal.
  emit: () => {},
};

// What clients were last told, so only real changes go out.
const told = {};
const WATCHED = {
  PlaybackStatus: 's',
  Metadata: 'a{sv}',
  Volume: 'd',
  LoopStatus: 's',
  Shuffle: 'b',
  CanGoNext: 'b',
  CanGoPrevious: 'b',
  CanPlay: 'b',
  CanPause: 'b',
  CanSeek: 'b',
};

function update(next) {
  const prev = track;
  track = next;
  if (!bus) return;
  const changed = [];
  for (const [key, sig] of Object.entries(WATCHED)) {
    const value = player[key];
    if (JSON.stringify(told[key]) === JSON.stringify(value)) continue;
    told[key] = value;
    changed.push([key, [sig, value]]);
  }
  if (changed.length) {
    bus.sendSignal(PATH, 'org.freedesktop.DBus.Properties', 'PropertiesChanged', 'sa{sv}as', [PLAYER, changed, []]);
  }
  // Clients project Position themselves; a jump they cannot project gets announced.
  if (prev && next && prev.videoId === next.videoId && Math.abs(positionNow(prev, next.at) - next.position) > 2) {
    player.emit('Seeked', Math.round(next.position * US));
  }
}

function start(opts) {
  actions = opts;
  try {
    bus = dbus.sessionBus();
  } catch (e) {
    console.log('[mpris] no session bus: ' + e.message);
    return;
  }
  // Unhandled, a dropped bus connection would take the main process down with it.
  // error and end can both come for one connection, hence the check.
  const mine = bus;
  const drop = () => {
    if (bus !== mine) return;
    bus = null;
    // Clients on a new connection have been told nothing yet.
    for (const k in told) delete told[k];
    setTimeout(() => start(actions), 10000).unref();
  };
  bus.connection.on('error', (e) => {
    console.log('[mpris] ' + e.message);
    drop();
  });
  bus.connection.on('end', drop);
  bus.exportInterface(root, PATH, ROOT_IFACE);
  bus.exportInterface(player, PATH, PLAYER_IFACE);
  // A second copy beside this one (a dev run next to the installed app) takes an
  // instance name, which the spec allows for exactly this.
  bus.requestName(NAME, DO_NOT_QUEUE, (err, code) => {
    if (err || code === PRIMARY_OWNER || !bus) return;
    bus.requestName(NAME + '.instance' + process.pid, DO_NOT_QUEUE, () => {});
  });
  update(track);
}

// On this module's bus since it is open anyway. null when it cannot ask, so "no" stays a real answer.
function nameHasOwner(name) {
  return new Promise((ok) => {
    if (!bus) return ok(null);
    const t = setTimeout(() => ok(null), 1000);
    bus.nameHasOwner(name, (err, has) => {
      clearTimeout(t);
      ok(err ? null : !!has);
    });
  });
}

module.exports = { start, update, metadata, nameHasOwner, active: () => !!bus };
