'use strict';

// Scripts and styles for the YouTube Music page, with the shared selectors set in.

const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'inject');
const read = (name) => fs.readFileSync(path.join(DIR, name), 'utf8');
const SELECTORS = read('selectors.js').trim();

module.exports = (name) => read(name).replaceAll('__SELECTORS__', () => SELECTORS);
