'use strict';

const test = require('node:test');
const assert = require('node:assert');
const {
  isInternal,
  keyAction,
  sanitizeTrack,
  positionNow,
  sanitizeResume,
  parseItems,
  sanitizeControls,
  sanitizeQueue,
  sanitizeEndpoint,
  sanitizeQueueTarget,
  lyricsBrowseId,
  parseLyrics,
  parseSuggestions,
  parsePlaylistOptions,
  sanitizeLinks,
} = require('../src/pure');

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
  assert.equal(sanitizeTrack({ title: 'x', like: 'LIKE' }).like, 'LIKE');
  assert.equal(sanitizeTrack({ title: 'x', like: 'LOVE' }).like, null);
  assert.equal(sanitizeTrack({ title: 'x', videoId: 'iNjGNNoUjkk' }).videoId, 'iNjGNNoUjkk');
  assert.equal(sanitizeTrack({ title: 'x', videoId: '"><img>' }).videoId, null);
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

test('pulls tracks and cards out of an InnerTube response', () => {
  const runs = (...t) => ({ runs: t.map((x) => (typeof x === 'string' ? { text: x } : x)) });
  const artist = (text, browseId) => ({
    text,
    navigationEndpoint: {
      browseEndpoint: {
        browseId,
        browseEndpointContextSupportedConfigs: { browseEndpointContextMusicConfig: { pageType: 'MUSIC_PAGE_TYPE_ARTIST' } },
      },
    },
  });
  const thumbs = (...list) => ({
    musicThumbnailRenderer: { thumbnail: { thumbnails: list.map(([w, url]) => ({ width: w, url })) } },
  });
  const col = (text) => ({ musicResponsiveListItemFlexColumnRenderer: { text } });
  const play = (ep) => ({ musicItemThumbnailOverlayRenderer: { content: { musicPlayButtonRenderer: { playNavigationEndpoint: ep } } } });
  const menu = (...items) => ({ menuRenderer: { items } });
  const json = {
    contents: [
      {
        musicShelfRenderer: {
          title: runs('Top songs'),
          contents: [
            {
              musicResponsiveListItemRenderer: {
                thumbnail: thumbs([60, 'https://x/60.jpg'], [120, 'https://x/120.jpg'], [544, 'https://x/544.jpg']),
                flexColumns: [col(runs('Within')), col(runs(artist('Daft Punk', 'UCdaft'), ' • ', 'Album'))],
                fixedColumns: [{ musicResponsiveListItemFixedColumnRenderer: { text: runs('3:48') } }],
                overlay: play({ watchEndpoint: { videoId: 'iNjGNNoUjkk', playlistId: 'RDCLAK5uy_x', params: 'replayed?' } }),
                menu: menu(
                  { menuNavigationItemRenderer: { icon: { iconType: 'MIX' }, navigationEndpoint: { watchEndpoint: { videoId: 'iNjGNNoUjkk', playlistId: 'RDAMVMx' } } } },
                  { menuServiceItemRenderer: { icon: { iconType: 'QUEUE_PLAY_NEXT' }, serviceEndpoint: { queueAddEndpoint: { queueTarget: { videoId: 'iNjGNNoUjkk' } } } } }
                ),
              },
            },
          ],
        },
      },
      {
        musicCarouselShelfRenderer: {
          header: { musicCarouselShelfBasicHeaderRenderer: { title: runs('Albums') } },
          contents: [
            {
              musicTwoRowItemRenderer: {
                title: runs('phonk'),
                subtitle: runs('Various'),
                thumbnailRenderer: thumbs([226, 'https://x/226.jpg'], [544, 'http://x/insecure.jpg']),
                navigationEndpoint: { browseEndpoint: { browseId: 'VLRDCLAK5uy_x' } },
                thumbnailOverlay: play({ watchPlaylistEndpoint: { playlistId: 'RDCLAK5uy_x', params: 'wAEB' } }),
                menu: menu({
                  menuNavigationItemRenderer: {
                    icon: { iconType: 'MUSIC_SHUFFLE' },
                    navigationEndpoint: { watchPlaylistEndpoint: { playlistId: 'RDCLAK5uy_x', params: 'wAEB8gECGAE%3D' } },
                  },
                }),
              },
            },
            { musicTwoRowItemRenderer: { title: runs('bad id'), navigationEndpoint: { watchEndpoint: { videoId: 'short' } } } },
            { musicTwoRowItemRenderer: { title: runs('bad browse'), navigationEndpoint: { browseEndpoint: { browseId: '../x' } } } },
          ],
        },
      },
      { continuationItemRenderer: { continuationEndpoint: { continuationCommand: { token: '4qmFsgKNARItVkxS' } } } },
    ],
    header: {
      menuNavigationItemRenderer: {
        icon: { iconType: 'MUSIC_SHUFFLE' },
        navigationEndpoint: { watchPlaylistEndpoint: { playlistId: 'RDCLAK5uy_x', params: 'wAEB8gECGAE%3D' } },
      },
    },
  };
  const page = parseItems(json);
  assert.deepEqual(page.shuffle, { playlistId: 'RDCLAK5uy_x', params: 'wAEB8gECGAE%3D' });
  assert.equal(page.next, '4qmFsgKNARItVkxS');
  assert.deepEqual(
    page.sections.map((x) => [x.title, x.items.length]),
    [
      ['Top songs', 1],
      ['Albums', 1],
    ]
  );
  const [track, card] = page.items;
  assert.equal(page.items.length, 2);
  assert.equal(track.title, 'Within');
  assert.equal(track.subtitle, 'Daft Punk • Album • 3:48');
  // Smallest picture still sharp at row size, not the 544 px one.
  assert.equal(track.thumb, 'https://x/120.jpg');
  assert.deepEqual(track.watch, { videoId: 'iNjGNNoUjkk', playlistId: 'RDCLAK5uy_x' });
  assert.deepEqual(track.play, { watchEndpoint: { videoId: 'iNjGNNoUjkk', playlistId: 'RDCLAK5uy_x' } });
  assert.deepEqual(track.radio, { watchEndpoint: { videoId: 'iNjGNNoUjkk', playlistId: 'RDAMVMx' } });
  assert.deepEqual(track.queue, { videoId: 'iNjGNNoUjkk' });
  assert.equal(track.artistId, 'UCdaft');
  assert.deepEqual(track.parts[0], { text: 'Daft Punk', browseId: 'UCdaft' });
  assert.equal(card.card, true);
  assert.equal(card.browseId, 'VLRDCLAK5uy_x');
  assert.equal(card.thumb, 'https://x/226.jpg');
  assert.deepEqual(card.play, { watchPlaylistEndpoint: { playlistId: 'RDCLAK5uy_x', params: 'wAEB' } });
  assert.deepEqual(card.shuffle, { watchPlaylistEndpoint: { playlistId: 'RDCLAK5uy_x', params: 'wAEB8gECGAE%3D' } });
  assert.deepEqual(parseItems(null), { items: [], sections: [], shuffle: null, next: null });
});

test('only rebuilds endpoints and queue targets from well-formed ids', () => {
  assert.deepEqual(sanitizeEndpoint({ watchEndpoint: { videoId: 'iNjGNNoUjkk', params: 'x', index: 5 } }), {
    watchEndpoint: { videoId: 'iNjGNNoUjkk' },
  });
  assert.equal(sanitizeEndpoint({ watchEndpoint: { videoId: "x'); alert(1); //" } }), null);
  assert.equal(sanitizeEndpoint({ browseEndpoint: { browseId: 'UCx' } }), null);
  assert.deepEqual(sanitizeQueueTarget({ playlistId: 'PLabc', videoId: 'bad' }), { playlistId: 'PLabc' });
  assert.equal(sanitizeQueueTarget({}), null);
});

test('keeps only artist and album links from the player bar', () => {
  assert.deepEqual(
    sanitizeLinks([
      { text: ' ZXKAI ', href: 'channel/UCDx-HqH50Z2wks1xClUeD-Q' },
      { text: 'Album', href: 'browse/MPREb_8B6isuTVwhv' },
      { text: 'evil', href: 'javascript:alert(1)' },
      { text: '', href: 'channel/UCx' },
    ]),
    [
      { text: 'ZXKAI', browseId: 'UCDx-HqH50Z2wks1xClUeD-Q' },
      { text: 'Album', browseId: 'MPREb_8B6isuTVwhv' },
    ]
  );
  assert.deepEqual(sanitizeLinks(null), []);
});

test('reads lyrics, suggestions and playlist choices', () => {
  const lyricsTab = {
    tabRenderer: {
      endpoint: {
        browseEndpoint: {
          browseId: 'MPLYt_abc',
          browseEndpointContextSupportedConfigs: { browseEndpointContextMusicConfig: { pageType: 'MUSIC_PAGE_TYPE_TRACK_LYRICS' } },
        },
      },
    },
  };
  assert.equal(lyricsBrowseId({ tabs: [{ tabRenderer: {} }, lyricsTab] }), 'MPLYt_abc');
  assert.equal(lyricsBrowseId({}), null);
  assert.deepEqual(
    parseLyrics({ x: { musicDescriptionShelfRenderer: { description: { runs: [{ text: 'a\r\nb' }] }, footer: { runs: [{ text: 'Source: X' }] } } } }),
    { text: 'a\nb', source: 'Source: X' }
  );
  assert.deepEqual(parseLyrics({}), { text: '', source: '' });
  const sugg = (query) => ({ searchSuggestionRenderer: { navigationEndpoint: { searchEndpoint: { query } } } });
  assert.deepEqual(parseSuggestions({ c: [sugg('daft punk'), sugg('daft punk'), sugg(' around ')] }), ['daft punk', 'around']);
  assert.deepEqual(
    parsePlaylistOptions({
      p: [
        { playlistAddToOptionRenderer: { playlistId: 'PLmine', title: { runs: [{ text: 'Mine' }] } } },
        { playlistAddToOptionRenderer: { playlistId: 'bad id!', title: { runs: [{ text: 'x' }] } } },
      ],
    }),
    [{ playlistId: 'PLmine', title: 'Mine' }]
  );
});

test('retypes player bar state and queue rows from the page', () => {
  assert.deepEqual(sanitizeControls({ shuffle: true, repeat: 'ONE', like: 'LIKE', volume: 140, muted: 'yes' }), {
    shuffle: true,
    repeat: 'ONE',
    like: 'LIKE',
    volume: 100,
    muted: false,
  });
  assert.equal(sanitizeControls({ repeat: 'SOMETIMES' }).repeat, 'NONE');
  assert.equal(sanitizeControls({ like: '<b>' }).like, null);
  const q = sanitizeQueue([
    { videoId: 'iNjGNNoUjkk', title: 'Within', artist: 'Daft Punk', length: '3:48', thumb: 'javascript:x', selected: true },
    { videoId: 'nope', title: 'dropped' },
    null,
  ]);
  assert.deepEqual(q, [
    { videoId: 'iNjGNNoUjkk', title: 'Within', artist: 'Daft Punk', length: '3:48', thumb: '', selected: true },
  ]);
  assert.deepEqual(sanitizeQueue('not a list'), []);
});
