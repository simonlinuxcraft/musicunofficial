'use strict';

const test = require('node:test');
const assert = require('node:assert');
const {
  isInternal,
  onSite,
  isWebLink,
  keyAction,
  sanitizeTrack,
  positionNow,
  rateLimit,
  validSetting,
  watchUrl,
  sanitizeResume,
  parseItems,
  sanitizeControls,
  sanitizeQueue,
  sanitizeEndpoint,
  sanitizeQueueTarget,
  changeRequest,
  changeDone,
  lyricsBrowseId,
  parseLyrics,
  parseSuggestions,
  parseAccount,
  parseLrc,
  pickSynced,
  lyricsTitle,
  parsePlaylistOptions,
  withCovers,
  sanitizeLinks,
  scrobbleDue,
  replayed,
  lastfmRetryable,
  pendingBatch,
  scrobbleBatchParams,
  primaryArtist,
  onDisplays,
  lastfmSignature,
} = require('../src/pure');

test('keeps YouTube Music and the Google login flow in-app', () => {
  assert.ok(isInternal('https://music.youtube.com/'));
  assert.ok(isInternal('https://accounts.google.com/ServiceLogin'));
  assert.ok(isInternal('https://www.youtube.com/watch?v=x'));
  assert.ok(isInternal('https://i.ytimg.com/vi/x/hq.jpg'));
  assert.ok(isInternal('https://accounts.google.de/accounts/SetSID'));
  assert.ok(isInternal('https://accounts.google.co.uk/accounts/SetSID'));
  assert.ok(isInternal('https://accounts.google.com.br/accounts/SetSID'));
});

test('sends everything else to the system browser', () => {
  assert.ok(!isInternal('https://example.com/'));
  assert.ok(!isInternal('https://youtube.com.evil.test/'));
  assert.ok(!isInternal('https://notgoogle.com/'));
  assert.ok(!isInternal('https://www.google.de/search?q=x'));
  assert.ok(!isInternal('https://accounts.google.de.evil.test/'));
  assert.ok(!isInternal('https://accounts.google.example.test/'));
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
  assert.equal(sanitizeTrack({ title: 'x', video: true }).video, true);
  assert.equal(sanitizeTrack({ title: 'x', video: 'yes' }).video, false);
  const c = sanitizeTrack({ title: 'x', shuffle: 'yes', repeat: 'ONE', volume: 140.6, muted: true, avMode: 'OMV_PREFERRED', avAvailable: true });
  assert.deepEqual([c.shuffle, c.repeat, c.volume, c.muted, c.avMode, c.avAvailable, c.adSkip], [false, 'ONE', 100, true, 'OMV_PREFERRED', true, false]);
  assert.equal(sanitizeTrack({ title: 'x', repeat: 'SOMETIMES', avMode: 'X' }).repeat, 'NONE');
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
  assert.deepEqual(parseItems(null), { items: [], sections: [], shuffle: null, next: null, library: null, subscribe: null, own: null, header: null, chips: [] });
});

test('reads library toggles, removal, subscribe and the own-playlist editor', () => {
  const toggle = (isToggled, save) => ({
    toggleMenuServiceItemRenderer: {
      defaultIcon: { iconType: 'BOOKMARK_BORDER' },
      defaultServiceEndpoint: save,
      toggledServiceEndpoint: { feedbackEndpoint: { feedbackToken: 'AB9zremove' } },
      isToggled,
    },
  });
  const row = (menu) => ({
    musicResponsiveListItemRenderer: {
      flexColumns: [{ musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: 'Within' }] } } }],
      playlistItemData: { videoId: 'iNjGNNoUjkk' },
      menu: { menuRenderer: { items: menu } },
    },
  });
  const page = parseItems({
    header: {
      musicEditablePlaylistDetailHeaderRenderer: { editHeader: { musicPlaylistEditHeaderRenderer: { privacy: 'UNLISTED' } } },
      subscribeButtonRenderer: { channelId: 'UCdaft', subscribed: true },
      toggleButtonRenderer: {
        defaultIcon: { iconType: 'BOOKMARK_BORDER' },
        defaultServiceEndpoint: { likeEndpoint: { status: 'LIKE', target: { playlistId: 'OLAK5uy_x' } } },
        toggledServiceEndpoint: { likeEndpoint: { status: 'INDIFFERENT', target: { playlistId: 'OLAK5uy_x' } } },
      },
    },
    contents: [
      row([
        toggle(false, { feedbackEndpoint: { feedbackToken: 'AB9zsave1' } }),
        {
          menuServiceItemRenderer: {
            serviceEndpoint: {
              playlistEditEndpoint: { playlistId: 'PLown', actions: [{ action: 'ACTION_REMOVE_VIDEO', setVideoId: '61AC30', removedVideoId: 'iNjGNNoUjkk' }] },
            },
          },
        },
        { menuServiceItemRenderer: { icon: { iconType: 'NOT_INTERESTED' }, serviceEndpoint: { feedbackEndpoint: { feedbackToken: 'AB9znotint' } } } },
      ]),
      // Signed out, saving is a sign-in prompt.
      row([toggle(false, { modalEndpoint: {} })]),
    ],
  });
  assert.deepEqual(page.own, { privacy: 'UNLISTED' });
  assert.deepEqual(page.subscribe, { channelId: 'UCdaft', subscribed: true });
  assert.deepEqual(page.library, {
    saved: false,
    save: { kind: 'like', like: 'OLAK5uy_x', status: 'LIKE' },
    unsave: { kind: 'like', like: 'OLAK5uy_x', status: 'INDIFFERENT' },
  });
  const [a, b] = page.items;
  assert.deepEqual(a.library.save, { kind: 'feedback', feedback: 'AB9zsave1' });
  assert.deepEqual(a.remove, { playlistId: 'PLown', setVideoId: '61AC30', videoId: 'iNjGNNoUjkk' });
  assert.deepEqual(a.notInterested, { kind: 'feedback', feedback: 'AB9znotint' });
  assert.equal(b.library.save, null);
  assert.equal(b.remove, null);
});

test('builds only well-formed library changes', () => {
  const v = 'iNjGNNoUjkk';
  assert.deepEqual(changeRequest({ kind: 'create', title: ' Mix ', videoIds: [v] }), ['/playlist/create', { title: 'Mix', privacyStatus: 'PRIVATE', videoIds: [v] }]);
  assert.deepEqual(changeRequest({ kind: 'add', playlistId: 'PLx', videoIds: [v] }), [
    '/browse/edit_playlist',
    { playlistId: 'PLx', actions: [{ action: 'ACTION_ADD_VIDEO', addedVideoId: v }] },
  ]);
  assert.deepEqual(changeRequest({ kind: 'remove', playlistId: 'PLx', rows: [{ videoId: v, setVideoId: '61AC' }] })[1].actions, [
    { action: 'ACTION_REMOVE_VIDEO', removedVideoId: v, setVideoId: '61AC' },
  ]);
  assert.deepEqual(changeRequest({ kind: 'like', like: 'OLAK5uy_x', status: 'INDIFFERENT' }), ['/like/removelike', { target: { playlistId: 'OLAK5uy_x' } }]);
  assert.deepEqual(changeRequest({ kind: 'subscribe', channelId: 'UCdaft', on: true }), ['/subscription/subscribe', { channelIds: ['UCdaft'] }]);
  assert.deepEqual(changeRequest({ kind: 'delete', playlistId: 'PLx' }), ['/playlist/delete', { playlistId: 'PLx' }]);
  assert.equal(changeRequest({ kind: 'create', title: '  ', videoIds: [v] }), null);
  assert.deepEqual(changeRequest({ kind: 'create', title: 'Empty', videoIds: [] }), ['/playlist/create', { title: 'Empty', privacyStatus: 'PRIVATE' }]);
  assert.equal(changeRequest({ kind: 'create', title: 'Empty' }), null);
  assert.equal(changeRequest({ kind: 'add', playlistId: 'PLx', videoIds: ['bad'] }), null);
  assert.equal(changeRequest({ kind: 'privacy', playlistId: 'PLx', privacy: 'SECRET' }), null);
  assert.equal(changeRequest({ kind: 'remove', playlistId: 'PLx', rows: [{ videoId: v }] }), null);
  assert.equal(changeRequest({ kind: 'eval' }), null);
  assert.equal(changeDone({ status: 'STATUS_SUCCEEDED' }), true);
  assert.equal(changeDone({ error: { code: 401 } }), false);
  assert.equal(changeDone(null), false);
  assert.equal(changeDone({ feedbackResponses: [{ isProcessed: false }] }), false);
  assert.equal(changeRequest({ kind: 'like', like: 'OLAK5uy_x', status: 'DISLIKE' }), null);
});

test('only rebuilds endpoints and queue targets from well-formed ids', () => {
  assert.deepEqual(sanitizeEndpoint({ watchEndpoint: { videoId: 'iNjGNNoUjkk', params: 'x', index: 5 } }), {
    watchEndpoint: { videoId: 'iNjGNNoUjkk' },
  });
  assert.equal(sanitizeEndpoint({ watchEndpoint: { videoId: "x'); alert(1); //" } }), null);
  assert.equal(sanitizeEndpoint({ browseEndpoint: { browseId: 'UCx' } }), null);
  assert.deepEqual(sanitizeQueueTarget({ playlistId: 'PLabc', videoId: 'bad' }), { playlistId: 'PLabc' });
  assert.equal(sanitizeQueueTarget({}), null);
  assert.deepEqual(sanitizeQueueTarget({ videoIds: ['iNjGNNoUjkk', 'ryr75N0nki0'] }), { videoIds: ['iNjGNNoUjkk', 'ryr75N0nki0'] });
  assert.equal(sanitizeQueueTarget({ videoIds: ['bad'] }), null);
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
  assert.deepEqual(parseSuggestions({ c: [sugg('daft punk'), sugg('daft punk'), sugg(' around ')] }), { texts: ['daft punk', 'around'], items: [] });
  assert.deepEqual(
    parsePlaylistOptions({
      p: [
        { playlistAddToOptionRenderer: { playlistId: 'PLmine', title: { runs: [{ text: 'Mine' }] } } },
        { playlistAddToOptionRenderer: { playlistId: 'bad id!', title: { runs: [{ text: 'x' }] } } },
      ],
    }),
    [{ playlistId: 'PLmine', title: 'Mine' }]
  );
  const library = { items: [{ browseId: 'VLPLmine', thumb: 'https://x/1.jpg', subtitle: 'Playlist • 12 songs' }] };
  assert.deepEqual(withCovers([{ playlistId: 'PLmine', title: 'Mine' }, { playlistId: 'PLnew', title: 'New' }], library), [
    { playlistId: 'PLmine', title: 'Mine', thumb: 'https://x/1.jpg', subtitle: 'Playlist • 12 songs' },
    { playlistId: 'PLnew', title: 'New', thumb: '', subtitle: '' },
  ]);
  assert.deepEqual(withCovers([], null), []);
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
    { videoId: 'iNjGNNoUjkk', title: 'Within', artist: 'Daft Punk', length: '3:48', thumb: '', selected: true, top: -1, itemId: null },
  ]);
  const [row] = sanitizeQueue([{ videoId: 'iNjGNNoUjkk', top: 3, itemId: 7 }]);
  assert.deepEqual([row.top, row.itemId], [3, 7]);
  assert.deepEqual(sanitizeQueue([{ videoId: 'iNjGNNoUjkk', top: '3); x(', itemId: -2 }]).map((r) => [r.top, r.itemId]), [[-1, null]]);
  assert.deepEqual(sanitizeQueue('not a list'), []);
});

test('scrobbles after half the track or four minutes, never short tracks', () => {
  assert.equal(scrobbleDue(100, 200), true);
  assert.equal(scrobbleDue(99, 200), false);
  assert.equal(scrobbleDue(240, 1200), true);
  assert.equal(scrobbleDue(25, 28), false);
});

test('takes the first artist of a joined line', () => {
  assert.equal(primaryArtist('ZXKAI und slxughter'), 'ZXKAI');
  assert.equal(primaryArtist('Travis Scott & Grand Theft Auto VI'), 'Travis Scott');
  assert.equal(primaryArtist('HUNTR/X, EJAE, AUDREY NUNA'), 'HUNTR/X');
  assert.equal(primaryArtist('Daft Punk feat. Pharrell Williams'), 'Daft Punk');
  assert.equal(primaryArtist('Nysa'), 'Nysa');
  assert.equal(primaryArtist('Lil Nas X feat. Jack Harlow'), 'Lil Nas X');
});

test('keeps a window spot only while a display is still there', () => {
  const areas = [{ x: 0, y: 0, width: 1920, height: 1080 }, { x: 1920, y: 0, width: 2560, height: 1440 }];
  assert.ok(onDisplays({ x: 100, y: 100 }, areas));
  assert.ok(onDisplays({ x: 3000, y: 900 }, areas));
  assert.ok(onDisplays({ x: -40, y: 10 }, areas));
  assert.ok(!onDisplays({ x: 5000, y: 100 }, areas));
  assert.ok(!onDisplays({ x: 100, y: 1200 }, [areas[0]]));
});

test('signs Last.fm calls over the sorted parameters', () => {
  const crypto = require('crypto');
  const md5 = (s) => crypto.createHash('md5').update(s, 'utf8').digest('hex');
  const params = { method: 'auth.getSession', token: 'T', api_key: 'K', format: 'json' };
  // format stays out, the rest sorted by name: api_key, method, token.
  assert.equal(lastfmSignature(params, 'S'), md5('api_keyKmethodauth.getSessiontokenTS'));
});

test('tells YouTube Music from consent, sign-in and broken urls', () => {
  assert.ok(onSite('https://music.youtube.com/watch?v=x'));
  assert.ok(!onSite('https://consent.youtube.com/m'));
  assert.ok(!onSite('https://accounts.google.com/'));
  assert.ok(!onSite(''));
});

test('only web and mail links leave the app', () => {
  assert.ok(isWebLink('https://example.com/'));
  assert.ok(isWebLink('http://example.com/'));
  assert.ok(isWebLink('mailto:a@example.com'));
  assert.ok(!isWebLink('file:///etc/passwd'));
  assert.ok(!isWebLink('steam://run/1'));
  assert.ok(!isWebLink('javascript:alert(1)'));
  assert.ok(!isWebLink('not a url'));
});

test('counts a repeat-one restart as a new play, a seek before the scrobble not', () => {
  assert.ok(replayed(true, 180, 1));
  assert.ok(!replayed(false, 180, 1));
  assert.ok(!replayed(true, 20, 1));
  assert.ok(!replayed(true, 180, 60));
});

test('retries Last.fm only for errors that pass', () => {
  assert.ok(lastfmRetryable(503, undefined));
  assert.ok(lastfmRetryable(200, 11));
  assert.ok(lastfmRetryable(200, 29));
  assert.ok(!lastfmRetryable(200, 9));
  assert.ok(!lastfmRetryable(400, 6));
});

test('batches pending scrobbles and drops those Last.fm no longer takes', () => {
  const now = Date.parse('2026-10-25T12:00:00Z');
  const fresh = { artist: 'A', track: 'T', timestamp: now / 1000 - 3600 };
  const old = { artist: 'B', track: 'U', timestamp: now / 1000 - 15 * 24 * 3600 };
  const { batch, stale } = pendingBatch([old, fresh, null], now);
  assert.deepStrictEqual(batch, [fresh]);
  assert.strictEqual(stale.length, 2);
  assert.strictEqual(pendingBatch(Array(60).fill(fresh), now).batch.length, 50);
  assert.deepStrictEqual(pendingBatch(undefined, now), { batch: [], stale: [] });
});

test('numbers batch scrobble parameters per entry', () => {
  assert.deepStrictEqual(
    scrobbleBatchParams([
      { artist: 'A', track: 'T' },
      { artist: 'B', track: 'U' },
    ]),
    { 'artist[0]': 'A', 'track[0]': 'T', 'artist[1]': 'B', 'track[1]': 'U' }
  );
});

test('rateLimit allows max calls per window, then recovers', () => {
  const ok = rateLimit(3, 60000);
  assert.deepEqual([ok(0), ok(1), ok(2), ok(3)], [true, true, true, false]);
  assert.equal(ok(60004), true);
});

test('validSetting takes only the values the settings page offers', () => {
  const q = ['auto', '1080p'];
  assert.ok(validSetting('language', 'de', q));
  assert.ok(!validSetting('language', 'fr', q));
  assert.ok(validSetting('videoQuality', '1080p', q));
  assert.ok(!validSetting('videoQuality', '8k', q));
  assert.ok(validSetting('notify', false, q));
  assert.ok(!validSetting('richPresence', 'true', q));
  assert.ok(validSetting('miniLyrics', true, q));
  assert.ok(!validSetting('miniLyrics', 'yes', q));
  assert.ok(validSetting('sleep', 30, q));
  assert.ok(!validSetting('sleep', '30', q));
  assert.ok(!validSetting('lastfm', {}, q));
  assert.ok(!validSetting('__proto__', true, q));
});

test('watchUrl encodes the id and the list', () => {
  assert.equal(watchUrl('abc'), 'https://music.youtube.com/watch?v=abc');
  assert.equal(watchUrl('a&b', 'PL1'), 'https://music.youtube.com/watch?v=a%26b&list=PL1');
});

test('reads page heads, chips, see-all links and table columns', () => {
  const runs = (...t) => ({ runs: t.map((x) => (typeof x === 'string' ? { text: x } : x)) });
  const pic = { musicThumbnailRenderer: { thumbnail: { thumbnails: [{ url: 'https://x/60.jpg', width: 60 }, { url: 'https://x/544.jpg', width: 544 }] } } };
  const col = (t) => ({ musicResponsiveListItemFlexColumnRenderer: { text: t } });
  const browse = (browseId, pageType) => ({ browseEndpoint: { browseId, browseEndpointContextSupportedConfigs: { browseEndpointContextMusicConfig: { pageType } } } });
  const page = parseItems({
    head: {
      musicResponsiveHeaderRenderer: {
        title: runs('Discovery'),
        subtitle: runs('Album • 2001'),
        secondSubtitle: runs('14 songs • 61 minutes'),
        straplineTextOne: runs({ text: 'Daft Punk', navigationEndpoint: browse('UCdaft') }),
        thumbnail: pic,
        description: { musicDescriptionShelfRenderer: { description: runs('Second album.') } },
      },
    },
    chips: {
      chipCloudRenderer: {
        chips: [
          { chipCloudChipRenderer: { text: runs('Workout'), navigationEndpoint: { browseEndpoint: { browseId: 'FEmusic_home', params: 'ggMx' } } } },
          { chipCloudChipRenderer: { text: runs('Songs'), navigationEndpoint: { searchEndpoint: { query: 'daft', params: 'EgWK' } } } },
          { chipCloudChipRenderer: { text: runs('Bad'), navigationEndpoint: { browseEndpoint: { browseId: 'bad id!' } } } },
        ],
      },
    },
    shelf: {
      musicShelfRenderer: {
        title: runs('Top songs'),
        bottomEndpoint: { browseEndpoint: { browseId: 'VLOLAK5uy_x', params: 'ggMP' } },
        contents: [
          {
            musicResponsiveListItemRenderer: {
              index: runs('3'),
              flexColumns: [
                col(runs({ text: 'Aerodynamic', navigationEndpoint: { watchEndpoint: { videoId: 'iNjGNNoUjkk' } } })),
                col(runs({ text: 'Daft Punk', navigationEndpoint: browse('UCdaft') })),
                col(runs('91 M plays')),
                col(runs({ text: 'Discovery', navigationEndpoint: browse('MPREb_disc') })),
              ],
              fixedColumns: [{ musicResponsiveListItemFixedColumnRenderer: { text: runs('3:27') } }],
              badges: [{ musicInlineBadgeRenderer: { icon: { iconType: 'MUSIC_EXPLICIT_BADGE' } } }],
              menu: { menuRenderer: { topLevelButtons: [{ likeButtonRenderer: { likeStatus: 'LIKE', target: { videoId: 'iNjGNNoUjkk' } } }] } },
            },
          },
        ],
      },
    },
    card: { musicTwoRowItemRenderer: { title: runs('Thomas'), thumbnailRenderer: pic, navigationEndpoint: browse('UCthomas', 'MUSIC_PAGE_TYPE_ARTIST') } },
  });
  assert.deepEqual(page.header, {
    kind: 'list',
    title: 'Discovery',
    base: 'Discovery',
    edition: '',
    subtitle: 'Album • 2001',
    second: '14 songs • 61 minutes',
    strap: [{ text: 'Daft Punk', browseId: 'UCdaft' }],
    thumb: 'https://x/544.jpg',
    description: 'Second album.',
    play: null,
    shuffle: null,
    radio: null,
    queue: null,
    owner: '',
    ownerThumb: '',
  });
  assert.deepEqual(page.chips, [
    { text: 'Workout', selected: false, browseId: 'FEmusic_home', params: 'ggMx' },
    { text: 'Songs', selected: false, query: 'daft', params: 'EgWK' },
  ]);
  assert.deepEqual(page.sections[0].more, { browseId: 'VLOLAK5uy_x', params: 'ggMP' });
  const [t, artist] = page.items;
  assert.deepEqual(t.album, { text: 'Discovery', browseId: 'MPREb_disc' });
  assert.equal(t.extra, '91 M plays');
  assert.equal(t.duration, '3:27');
  assert.equal(t.index, '3');
  assert.equal(t.explicit, true);
  assert.equal(t.like, 'LIKE');
  assert.deepEqual(t.byline, [{ text: 'Daft Punk', browseId: 'UCdaft' }]);
  assert.equal(artist.round, true);
  assert.equal(t.round, false);
  assert.equal(artist.kind, 'artist');
  assert.equal(t.kind, 'song');

  const artistPage = parseItems({ musicImmersiveHeaderRenderer: { title: runs('Daft Punk'), monthlyListenerCount: runs('9 M monthly'), thumbnail: pic } });
  assert.equal(artistPage.header.kind, 'artist');
  assert.equal(artistPage.header.subtitle, '9 M monthly');

  const search = parseItems({
    top: {
      musicCardShelfRenderer: {
        title: runs({ text: 'Daft Punk', navigationEndpoint: browse('UCdaft', 'MUSIC_PAGE_TYPE_ARTIST') }),
        contents: [{ musicResponsiveListItemRenderer: { flexColumns: [col(runs({ text: 'One', navigationEndpoint: { watchEndpoint: { videoId: 'iNjGNNoUjkk' } } }))] } }],
      },
    },
    rest: { musicResponsiveListItemRenderer: { flexColumns: [col(runs({ text: 'Two', navigationEndpoint: { watchEndpoint: { videoId: 'aaaaaaaaaaa' } } }))] } },
  });
  assert.deepEqual(search.sections.map((s) => s.items.map((i) => [i.title, i.top, i.underTop])), [
    [
      ['Daft Punk', true, false],
      ['One', false, true],
    ],
    [['Two', false, false]],
  ]);
});

test('rates single tracks and reads the account head', () => {
  const v = 'iNjGNNoUjkk';
  assert.deepEqual(changeRequest({ kind: 'rate', videoId: v, status: 'LIKE' }), ['/like/like', { target: { videoId: v } }]);
  assert.deepEqual(changeRequest({ kind: 'rate', videoId: v, status: 'INDIFFERENT' }), ['/like/removelike', { target: { videoId: v } }]);
  assert.equal(changeRequest({ kind: 'rate', videoId: 'bad', status: 'LIKE' }), null);
  assert.equal(changeRequest({ kind: 'rate', videoId: v, status: 'LOVE' }), null);
  const head = {
    activeAccountHeaderRenderer: {
      accountName: { runs: [{ text: 'Sam' }] },
      channelHandle: { runs: [{ text: '@sam' }] },
      accountPhoto: { thumbnails: [{ url: 'https://x/48.jpg', width: 48 }, { url: 'https://x/88.jpg', width: 88 }, { url: 'http://x/176.jpg', width: 176 }] },
    },
  };
  assert.deepEqual(parseAccount({ a: head }), { name: 'Sam', handle: '@sam', photo: 'https://x/88.jpg' });
  assert.equal(parseAccount({}), null);
});

test('drops chips whose params fail the check, falls back for a selected chip', () => {
  const chip = (c) => ({ chipCloudChipRenderer: { text: { runs: [{ text: c.t }] }, ...c.x } });
  const page = parseItems({
    chipCloudRenderer: {
      chips: [
        chip({ t: 'Long', x: { navigationEndpoint: { searchEndpoint: { query: 'q', params: 'A'.repeat(500) } } } }),
        chip({ t: 'Odd', x: { navigationEndpoint: { browseEndpoint: { browseId: 'FEmusic_home', params: 'a b' } } } }),
        chip({ t: 'On', x: { isSelected: true, onDeselectedCommand: {}, navigationEndpoint: { browseEndpoint: { browseId: 'FEmusic_home', params: 'ggMx' } } } }),
      ],
    },
  });
  assert.deepEqual(page.chips, [{ text: 'On', selected: true, browseId: 'FEmusic_home', params: 'ggMx' }]);
});

test('reads the play button, menu and owner of a playlist head', () => {
  const v = 'iNjGNNoUjkk';
  const page = parseItems({
    musicResponsiveHeaderRenderer: {
      title: { runs: [{ text: 'Road trip' }] },
      buttons: [
        { musicPlayButtonRenderer: { playNavigationEndpoint: { watchEndpoint: { videoId: v, playlistId: 'PLroad', params: 'x' } } } },
        {
          menuRenderer: {
            items: [
              { menuNavigationItemRenderer: { icon: { iconType: 'MUSIC_SHUFFLE' }, navigationEndpoint: { watchPlaylistEndpoint: { playlistId: 'PLroad', params: 'wAEB8gECGAE%3D' } } } },
              { menuNavigationItemRenderer: { icon: { iconType: 'MIX' }, navigationEndpoint: { watchPlaylistEndpoint: { playlistId: 'RDAMPLPLroad', params: 'wAEB' } } } },
              { menuServiceItemRenderer: { icon: { iconType: 'QUEUE_PLAY_NEXT' }, serviceEndpoint: { queueAddEndpoint: { queueTarget: { playlistId: 'PLroad' } } } } },
            ],
          },
        },
      ],
      facepile: { avatarStackViewModel: { text: { content: ' Sam ' }, avatars: [{ avatarViewModel: { image: { sources: [{ url: 'https://x/88.jpg', width: 88 }, { url: 'javascript:1', width: 200 }] } } }] } },
    },
  });
  const h = page.header;
  assert.deepEqual(h.play, { watchEndpoint: { videoId: v, playlistId: 'PLroad' } });
  assert.deepEqual(h.shuffle, { watchPlaylistEndpoint: { playlistId: 'PLroad', params: 'wAEB8gECGAE%3D' } });
  assert.deepEqual(h.radio, { watchPlaylistEndpoint: { playlistId: 'RDAMPLPLroad', params: 'wAEB' } });
  assert.deepEqual(h.queue, { playlistId: 'PLroad' });
  assert.equal(h.owner, 'Sam');
  assert.equal(h.ownerThumb, 'https://x/88.jpg');
});

test('reads timed lyrics and picks the recording that fits the track', () => {
  const lrc = '[ar:Someone]\n[00:01.50] First\n[00:10.00][01:10.25]Chorus\nno stamp\n[00:05.00] Second';
  assert.deepEqual(parseLrc(lrc), [
    { time: 1.5, text: 'First' },
    { time: 5, text: 'Second' },
    { time: 10, text: 'Chorus' },
    { time: 70.25, text: 'Chorus' },
  ]);
  assert.deepEqual(parseLrc(null), []);
  const rs = [
    { duration: 240, syncedLyrics: '[00:01.00] a' },
    { duration: 201, syncedLyrics: '[00:01.00] b' },
    { duration: 199, syncedLyrics: null, plainLyrics: 'c' },
  ];
  assert.equal(pickSynced(rs, 200).syncedLyrics, '[00:01.00] b');
  assert.equal(pickSynced(rs, 300), null);
  assert.equal(pickSynced(rs, 0).duration, 240);
  assert.equal(pickSynced({ duration: 200, syncedLyrics: '[00:01.00] x' }, 200).duration, 200);
  assert.equal(lyricsTitle('Play Hard (mit Ne-Yo & Akon)'), 'Play Hard');
  assert.equal(lyricsTitle('Faded (Official Video)'), 'Faded');
  assert.equal(lyricsTitle('Out Of Touch (71 Digits Edit)'), 'Out Of Touch (71 Digits Edit)');
});

test('splitEdition takes release forms off the title, nothing else', () => {
  const { splitEdition } = require('../src/pure');
  assert.deepEqual(splitEdition('Random Access Memories (Drumless Edition)'), { base: 'Random Access Memories', edition: 'Drumless Edition' });
  assert.deepEqual(splitEdition('Abbey Road (Remastered 2019) [Super Deluxe]'), { base: 'Abbey Road (Remastered 2019)', edition: 'Super Deluxe' });
  assert.deepEqual(splitEdition('Yesterday - Remastered 2009'), { base: 'Yesterday', edition: 'Remastered 2009' });
  assert.deepEqual(splitEdition('Frozen 2 (Originalsoundtrack)'), { base: 'Frozen 2', edition: 'Originalsoundtrack' });
  assert.deepEqual(splitEdition('One More Time (Radio Edit)'), { base: 'One More Time', edition: 'Radio Edit' });
  assert.deepEqual(splitEdition('Instant Crush (feat. Julian Casablancas)'), { base: 'Instant Crush (feat. Julian Casablancas)', edition: '' });
  assert.deepEqual(splitEdition('Harder, Better, Faster, Stronger'), { base: 'Harder, Better, Faster, Stronger', edition: '' });
  assert.deepEqual(splitEdition('Mix (Live)'), { base: 'Mix', edition: 'Live' });
  assert.deepEqual(splitEdition('Remix'), { base: 'Remix', edition: '' });
  assert.deepEqual(splitEdition('Love - Hate'), { base: 'Love - Hate', edition: '' });
  assert.deepEqual(splitEdition(null), { base: '', edition: '' });
});

test('parseItems tells songs, videos and pages apart', () => {
  const runs = (...t) => ({ runs: t.map((x) => (typeof x === 'string' ? { text: x } : x)) });
  const col = (t) => ({ musicResponsiveListItemFlexColumnRenderer: { text: t } });
  const watch = (videoId, type) => ({ watchEndpoint: { videoId, watchEndpointMusicSupportedConfigs: { watchEndpointMusicConfig: { musicVideoType: type } } } });
  const row = (title, nav) => ({ musicResponsiveListItemRenderer: { flexColumns: [col(runs({ text: title, navigationEndpoint: nav }))], navigationEndpoint: nav.browseEndpoint ? nav : undefined } });
  const browse = (browseId, pageType) => ({ browseEndpoint: { browseId, browseEndpointContextSupportedConfigs: { browseEndpointContextMusicConfig: { pageType } } } });
  const page = parseItems([
    row('Song', watch('aaaaaaaaaaa', 'MUSIC_VIDEO_TYPE_ATV')),
    row('Clip', watch('bbbbbbbbbbb', 'MUSIC_VIDEO_TYPE_OMV')),
    row('Upload', watch('ccccccccccc', 'MUSIC_VIDEO_TYPE_SHOULDER')),
    row('Plain', { watchEndpoint: { videoId: 'ddddddddddd' } }),
    row('Album (Deluxe Edition)', browse('MPREb_x', 'MUSIC_PAGE_TYPE_ALBUM')),
    row('Mix', browse('VLPL_x', 'MUSIC_PAGE_TYPE_PLAYLIST')),
    row('Someone', browse('UCsome', 'MUSIC_PAGE_TYPE_USER_CHANNEL')),
  ]);
  assert.deepEqual(page.items.map((i) => i.kind), ['song', 'video', 'video', 'song', 'album', 'playlist', 'profile']);
  assert.equal(page.items[4].title, 'Album (Deluxe Edition)');
  assert.equal(page.items[4].base, 'Album');
  assert.equal(page.items[4].edition, 'Deluxe Edition');
});

test('the autostart entry reads back as the mode it was written for', () => {
  const { autostartEntry, autostartMode, validSetting } = require('../src/pure');
  for (const mode of ['on', 'tray']) assert.equal(autostartMode(autostartEntry('/opt/App/app', mode)), mode);
  assert.match(autostartEntry('/opt/App/app', 'tray'), /^Exec=\/opt\/App\/app --hidden$/m);
  // Switched off by the desktop's own autostart tool.
  assert.equal(autostartMode(autostartEntry('/opt/App/app', 'on') + 'Hidden=true\n'), 'off');
  assert.ok(validSetting('autostart', 'tray', []));
  assert.ok(!validSetting('autostart', 'yes', []));
  assert.ok(validSetting('closeQuits', true, []));
});
