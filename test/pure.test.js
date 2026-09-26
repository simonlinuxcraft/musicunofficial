'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { isInternal, keyAction, sanitizeTrack, positionNow, sanitizeResume } = require('../src/pure');

test('keeps YouTube Music and the Google login flow in-app', () => {
  assert.ok(isInternal('https://music.youtube.com/'));
  assert.ok(isInternal('https://accounts.google.com/ServiceLogin'));
  assert.ok(isInternal('https://www.youtube.com/watch?v=x'));
  assert.ok(isInternal('https://i.ytimg.com/vi/x/hq.jpg'));
});

test('sends everything else to the system browser', () => {
  assert.ok(!isInternal('https://example.com/'));
  assert.ok(!isInternal('https://youtube.com.evil.test/'));
  assert.ok(!isInternal('https://notgoogle.com/'));
  assert.ok(!isInternal('javascript:alert(1)'));
  assert.ok(!isInternal('not a url'));
});

const down = (key) => ({ type: 'keyDown', control: true, key });

test('keeps a way out that does not depend on the tray', () => {
  assert.equal(keyAction(down('q')), 'quit');
  assert.equal(keyAction(down('Q')), 'quit');
  assert.equal(keyAction(down('r')), 'reload');
  assert.equal(keyAction(down('+')), 'zoom-in');
  assert.equal(keyAction(down('=')), 'zoom-in');
  assert.equal(keyAction(down('-')), 'zoom-out');
  assert.equal(keyAction(down('0')), 'zoom-reset');
  assert.equal(keyAction(down('m')), 'mini');
});

test('ignores plain typing, key releases and unknown combos', () => {
  assert.equal(keyAction({ type: 'keyDown', control: false, key: 'q' }), null);
  assert.equal(keyAction({ type: 'keyUp', control: true, key: 'q' }), null);
  assert.equal(keyAction(down('a')), null);
  assert.equal(keyAction(null), null);
});

test('accepts a normal track and clamps the strings', () => {
  const t = sanitizeTrack({
    title: '  Song  ',
    artist: 'Band',
    album: 'Record',
    art: 'https://lh3.googleusercontent.com/x=w544',
    playing: true,
    position: 12.5,
    duration: 200,
  });
  assert.equal(t.title, 'Song');
  assert.equal(t.artist, 'Band');
  assert.equal(t.art, 'https://lh3.googleusercontent.com/x=w544');
  assert.equal(t.playing, true);
  assert.equal(t.position, 12.5);
});

test('drops artwork that is not an https url', () => {
  const bad = (art) => sanitizeTrack({ title: 'x', art }).art;
  assert.equal(bad('file:///etc/passwd'), '');
  assert.equal(bad('data:image/png;base64,AAAA'), '');
  assert.equal(bad('javascript:alert(1)'), '');
  assert.equal(bad('http://insecure.test/a.png'), '');
  assert.equal(bad('not a url'), '');
  assert.equal(bad(42), '');
});

test('rejects junk instead of forwarding it to Discord', () => {
  assert.equal(sanitizeTrack(null), null);
  assert.equal(sanitizeTrack('a string'), null);
  assert.equal(sanitizeTrack({}), null);
  assert.equal(sanitizeTrack({ title: '   ' }), null);
  const t = sanitizeTrack({ title: 'x', artist: { toString: () => 'nope' }, position: NaN, duration: -5, playing: 'yes' });
  assert.equal(t.artist, '');
  assert.equal(t.position, 0);
  assert.equal(t.duration, 0);
  assert.equal(t.playing, false);
  assert.equal(sanitizeTrack({ title: 'x'.repeat(500) }).title.length, 256);
});

test('stamps the track so consumers can project the position', () => {
  const before = Date.now();
  const t = sanitizeTrack({ title: 'x', position: 10, duration: 100, playing: true });
  assert.ok(t.at >= before && t.at <= Date.now());
  // A stamp from the future or the distant past is not trustworthy.
  assert.ok(sanitizeTrack({ title: 'x', at: Date.now() + 99999 }).at <= Date.now());
  assert.ok(sanitizeTrack({ title: 'x', at: 1 }).at > 1);
  assert.ok(sanitizeTrack({ title: 'x', at: 'nope' }).at > 0);
});

test('projects the position forward from when it was measured', () => {
  const at = Date.now() - 3000;
  const playing = { position: 10, duration: 100, playing: true, at };
  // Three seconds passed since the reading, so the position is 13, not 10.
  assert.ok(Math.abs(positionNow(playing) - 13) < 0.05);
  // Paused tracks do not advance.
  assert.equal(positionNow({ ...playing, playing: false }), 10);
});

test('never projects past the end of the track', () => {
  const t = { position: 95, duration: 100, playing: true, at: Date.now() - 60000 };
  assert.equal(positionNow(t), 100);
});

test('handles tracks with no duration', () => {
  assert.equal(positionNow({ position: 5, duration: 0, playing: true, at: Date.now() }), 0);
  assert.equal(positionNow(null), 0);
});

test('only keeps a resume snapshot with a well-formed video id', () => {
  const r = sanitizeResume({ videoId: 'YdYqwJxA-ro', list: 'RDTMAK5uy_k', position: 42, duration: 119, playing: true });
  assert.equal(r.videoId, 'YdYqwJxA-ro');
  assert.equal(r.list, 'RDTMAK5uy_k');
  assert.equal(r.position, 42);
  assert.equal(r.playing, true);
});

test('drops the whole snapshot when the id is not a real video id', () => {
  assert.equal(sanitizeResume(null), null);
  assert.equal(sanitizeResume({}), null);
  assert.equal(sanitizeResume({ videoId: 'short' }), null);
  assert.equal(sanitizeResume({ videoId: 'waytoolongforanid' }), null);
  assert.equal(sanitizeResume({ videoId: 'bad/chars!!!' }), null);
  assert.equal(sanitizeResume({ videoId: 42 }), null);
});

test('nulls a malformed list instead of carrying it into a url', () => {
  const bad = (list) => sanitizeResume({ videoId: 'YdYqwJxA-ro', list }).list;
  assert.equal(bad('has spaces'), null);
  assert.equal(bad('x'), null);
  assert.equal(bad('a'.repeat(65)), null);
  assert.equal(bad(undefined), null);
});
