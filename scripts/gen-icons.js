'use strict';

// Generates every icon variant from assets/symbol.svg so a rebranding is one
// file plus "npm run icons". Needs inkscape on PATH.
//
//   icon.png       512px, symbol on a dark rounded tile (launcher convention)
//   icon-tray.png  128px, symbol only, transparent, stays visible on any panel
//   inject/style.css  symbol plus wordmark, inlined as base64 for the nav bar

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const WORDMARK = 'Music';
const TILE = '#0f0f0f';

const symbol = fs.readFileSync(path.join(ROOT, 'assets', 'symbol.svg'), 'utf8');
const inner = symbol.replace(/[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '').trim();

function render(svg, out, size) {
  const tmp = path.join(ROOT, '.icon-tmp.svg');
  fs.writeFileSync(tmp, svg);
  execFileSync('inkscape', [tmp, '-o', path.join(ROOT, out), '-w', String(size), '-h', String(size)], {
    stdio: 'ignore',
  });
  fs.unlinkSync(tmp);
  console.log('wrote ' + out + ' (' + size + 'px)');
}

const tray = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">${inner}</svg>`;
render(tray, 'icon-tray.png', 128);

const tile = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="14" fill="${TILE}"/>
  <g transform="translate(32 32) scale(0.62) translate(-32 -32)">${inner}</g>
</svg>`;
render(tile, 'icon.png', 512);

// Only the symbol goes in as an image. The wordmark is real text rendered by
// the browser: an SVG <text> scaled down to nav bar height renders muddy,
// because a background-image gets no font hinting or subpixel antialiasing. Same SVG as the tray icon.

const cssPath = path.join(ROOT, 'inject', 'style.css');
let css = fs.readFileSync(cssPath, 'utf8');
const b64 = Buffer.from(tray).toString('base64');

// Test for the rule, do not compare before/after: an unchanged wordmark
// produces identical output and would look like a missing rule.
const ICON_RULE = /(ytmusic-logo a \{[\s\S]*?background-image: url\(")[^"]*(")/;
if (!ICON_RULE.test(css)) throw new Error('logo rule not found in inject/style.css');
css = css.replace(ICON_RULE, (m, a, b) => a + 'data:image/svg+xml;base64,' + b64 + b);

const TEXT_RULE = /(ytmusic-logo a::after \{[\s\S]*?content: ')[^']*(')/;
if (!TEXT_RULE.test(css)) throw new Error('wordmark rule not found in inject/style.css');
css = css.replace(TEXT_RULE, (m, a, b) => a + WORDMARK + b);

fs.writeFileSync(cssPath, css);
console.log('patched inject/style.css: symbol + wordmark "' + WORDMARK + '"');
