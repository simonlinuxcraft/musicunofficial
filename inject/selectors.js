// Page internals shared by bridge.js and nowplaying.js, set in for __SELECTORS__
// by src/inject.js. They break when YouTube renames them.
({
  BAR: 'ytmusic-player-bar',
  // The redesigned player bar, seen from 2026-10.
  MINI: 'ytmusic-app-layout > ytmusic-miniplayer',
  QUEUE: 'ytmusic-player-queue',
  SKIP_AD: '.ytp-skip-ad-button, .ytp-ad-skip-button-modern, .ytp-ad-skip-button',
})
