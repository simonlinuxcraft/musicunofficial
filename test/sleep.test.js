'use strict';

const { test, mock, afterEach } = require('node:test');
const assert = require('node:assert');
const sleep = require('../src/sleep');

afterEach(() => mock.timers.reset());

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
  mock.timers.enable({ apis: ['setTimeout', 'Date'] });
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
