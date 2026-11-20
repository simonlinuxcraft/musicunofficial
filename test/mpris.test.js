'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { metadata } = require('../src/mpris');

const value = (m, key) => (m.find(([k]) => k === key) || [])[1];

test('describes the track in MPRIS terms', () => {
  const m = metadata({ title: 'Within', artist: 'Daft Punk', album: 'RAM', art: 'https://x/a.jpg', duration: 228.5, videoId: 'iNjGNN-Ujkk' });
  // A dash is not allowed in an object path; the whole signal would be rejected.
  assert.deepEqual(value(m, 'mpris:trackid'), ['o', '/org/musicunofficial/track/iNjGNN_Ujkk']);
  assert.match(value(m, 'mpris:trackid')[1], /^(\/[A-Za-z0-9_]+)+$/);
  assert.deepEqual(value(m, 'xesam:artist'), ['as', ['Daft Punk']]);
  assert.deepEqual(value(m, 'mpris:length'), ['x', 228500000]);
  assert.deepEqual(value(m, 'xesam:url'), ['s', 'https://music.youtube.com/watch?v=iNjGNN-Ujkk']);
});

test('leaves out what the track does not have', () => {
  const m = metadata({ title: 'x', artist: '', album: '', art: '', duration: 0, videoId: null });
  assert.deepEqual(m.map(([k]) => k), ['mpris:trackid', 'xesam:title']);
  assert.deepEqual(metadata(null), [['mpris:trackid', ['o', '/org/mpris/MediaPlayer2/TrackList/NoTrack']]]);
});

test('refuses the calls the bus library would throw on', () => {
  const { refused } = require('../src/mpris');
  const call = (iface, member, body) => ({ type: 1, path: '/org/mpris/MediaPlayer2', interface: iface, member, body });
  const props = (member, ...body) => call('org.freedesktop.DBus.Properties', member, body);
  const PLAYER = 'org.mpris.MediaPlayer2.Player';
  assert.equal(refused(props('Get', 'org.mpris.MediaPlayer2', 'Fullscreen')), true);
  assert.equal(refused(props('Get', 'org.mpris.MediaPlayer2', 'Identity')), false);
  assert.equal(refused(props('Set', PLAYER, 'Next', [[], ['x']])), true);
  assert.equal(refused(props('Set', PLAYER, 'Rate', [[], [2]])), true);
  assert.equal(refused(props('Set', PLAYER, 'Volume', [[], [0.5]])), false);
  assert.equal(refused(props('GetAll', PLAYER)), false);
  assert.equal(refused(call(PLAYER, 'Rate')), true);
  assert.equal(refused(call(PLAYER, 'Next')), false);
});
