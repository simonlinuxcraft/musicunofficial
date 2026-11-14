'use strict';

const { test, mock, afterEach } = require('node:test');
const assert = require('node:assert');
const sleep = require('../src/sleep');

afterEach(() => {
  mock.timers.reset();
  mock.restoreAll();
});

test('pauses once the next track actually plays, not for an ad or while it loads', () => {
  let paused = 0;
  sleep.init(() => paused++);
  sleep.onTrack({ videoId: 'aaaaaaaaaaa', title: 'A', playing: true });
  sleep.set('track');
  sleep.onTrack({ videoId: 'aaaaaaaaaaa', title: 'A', playing: true });
  sleep.onTrack({ ad: true, title: 'Ad', playing: true });
  sleep.onTrack({ videoId: 'bbbbbbbbbbb', title: 'B', playing: false });
  assert.equal(paused, 0);
  sleep.onTrack({ videoId: 'bbbbbbbbbbb', title: 'B', playing: true });
  assert.equal(paused, 1);
  assert.equal(sleep.state().mode, 'off');
});

test('pauses when the minutes are up', () => {
  mock.timers.enable({ apis: ['setInterval', 'Date'] });
  let paused = 0;
  sleep.init(() => paused++);
  sleep.set(15);
  assert.equal(sleep.state().mode, 'time');
  mock.timers.tick(15 * 60000 - 1);
  assert.equal(paused, 0);
  mock.timers.tick(1);
  assert.equal(paused, 1);
  assert.equal(sleep.active(), false);
});

test('repeat-one: pauses when the same track starts over, not on a seek', () => {
  let paused = 0;
  sleep.init(() => paused++);
  const a = (position, playing = true) => ({ videoId: 'aaaaaaaaaaa', title: 'A', playing, position, duration: 200 });
  sleep.onTrack(a(100));
  sleep.set('track');
  sleep.onTrack(a(5));
  sleep.onTrack(a(150));
  sleep.onTrack(a(196));
  sleep.onTrack(a(0, false));
  assert.equal(paused, 0);
  sleep.onTrack(a(1));
  assert.equal(paused, 1);
});

test('the minutes count while the machine is suspended', () => {
  // Timers and wall clock apart: a suspend moves only the wall clock.
  mock.timers.enable({ apis: ['setInterval'] });
  let now = 0;
  mock.method(Date, 'now', () => now);
  let paused = 0;
  sleep.init(() => paused++);
  sleep.set(30);
  mock.timers.tick(10 * 60000);
  now += 31 * 60000;
  mock.timers.tick(10000);
  assert.equal(paused, 1);
});
