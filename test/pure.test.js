'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { isInternal, keyAction } = require('../utils/pure');

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
});

test('ignores plain typing, key releases and unknown combos', () => {
  assert.equal(keyAction({ type: 'keyDown', control: false, key: 'q' }), null);
  assert.equal(keyAction({ type: 'keyUp', control: true, key: 'q' }), null);
  assert.equal(keyAction(down('a')), null);
  assert.equal(keyAction(null), null);
});
