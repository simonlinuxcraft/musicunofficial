'use strict';

const { test, beforeEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// A page that records every script it gets and answers from a list.
const sent = [];
let answers = [];
const wc = {
  isLoadingMainFrame: () => false,
  mainFrame: {
    executeJavaScript: async (code) => {
      new vm.Script(code);
      sent.push(code);
      return answers.shift();
    },
  },
};
require('./stub')('./main-window', { webContents: () => wc });
const page = require('../src/page');

beforeEach(() => {
  sent.length = 0;
  answers = [];
});

test('the bridge has every function src/page.js calls into', () => {
  const bridge = vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'inject', 'bridge.js'), 'utf8'), {});
  const called = [...fs.readFileSync(path.join(__dirname, '..', 'src', 'page.js'), 'utf8').matchAll(/call\('(\w+)'/g)].map((m) => m[1]);
  for (const fn of called) assert.equal(typeof bridge[fn], 'function', fn);
});

test('a queue add YouTube sends nothing for leaves the playing queue alone', async () => {
  answers = [0];
  assert.equal(await page.queueAdd({ videoId: 'aaaaaaaaaaa' }, 'INSERT_AT_END'), 0);
  assert.equal(sent.length, 1);
});

test('with nothing queued yet the target just starts', async () => {
  answers = [-1, undefined];
  assert.equal(await page.queueAdd({ videoId: 'aaaaaaaaaaa' }, 'INSERT_AT_END'), -1);
  assert.equal(sent.length, 2);
  assert.ok(sent[1].includes('b.navigate(app, ...[{"watchEndpoint":{"videoId":"aaaaaaaaaaa"}}])'));
});

test('arguments reach the page as JSON, never as code', async () => {
  await page.queuePlay('0); alert(1', 'x');
  assert.ok(sent[0].includes('b.queuePlay(app, ...["0); alert(1","x"])'));
});

test('an action outside the list never reaches the page', async () => {
  assert.equal(await page.control('reload'), null);
  assert.equal(sent.length, 0);
});
