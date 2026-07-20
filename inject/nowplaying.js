(() => {
  if (window.__ytmNowPlaying) return 'already mounted';
  window.__ytmNowPlaying = true;

  // Metadata comes from mediaSession, not from the DOM. YouTube Music fills it
  // in itself (it is why the media keys and the GNOME widget already work), so
  // it survives the layout changes that break every selector sooner or later.
  // Not just the first <video> in the document: an ad or a preview can add a
  // second one, and reading position and play state off that while the
  // metadata still describes the real track shows a mismatched player. Prefer
  // one that is actually playing, then any that has a duration.
  function video() {
    const all = [...document.querySelectorAll('video')];
    return (
      all.find((v) => !v.paused && !v.ended && v.duration > 0) ||
      all.find((v) => v.duration > 0) ||
      all[0] ||
      null
    );
  }

  function read() {
    const v = video();
    const m = navigator.mediaSession && navigator.mediaSession.metadata;
    if (!v || !m || !m.title) return null;

    let art = '';
    if (m.artwork && m.artwork.length) {
      // Pick the largest square: the sizes list is not sorted and the small
      // ones look blurry blown up in the mini player.
      let best = 0;
      for (const a of m.artwork) {
        const w = parseInt(String(a.sizes || '0').split('x')[0], 10) || 0;
        if (w >= best) {
          best = w;
          art = a.src || '';
        }
      }
    }

    return {
      title: m.title || '',
      artist: m.artist || '',
      album: m.album || '',
      art,
      // video.paused is the truth. playbackState lags behind it on seek.
      playing: !v.paused && !v.ended,
      position: Number.isFinite(v.currentTime) ? v.currentTime : 0,
      duration: Number.isFinite(v.duration) ? v.duration : 0,
    };
  }

  // Everything except position, which moves on its own and would make every
  // single tick look like a change. The mini player runs the position forward
  // locally, so it does not need one message per tick to stay smooth.
  function differs(a, b) {
    if (!a || !b) return a !== b;
    return (
      a.title !== b.title ||
      a.artist !== b.artist ||
      a.album !== b.album ||
      a.art !== b.art ||
      a.playing !== b.playing ||
      Math.round(a.duration) !== Math.round(b.duration)
    );
  }

  let last = null;
  let sentAt = 0;

  function tick() {
    const now = read();
    // The heartbeat exists so a seek in the main window resyncs the mini
    // player's bar; the interpolation covers the gap in between.
    if (differs(now, last) || Date.now() - sentAt > 2000) {
      last = now;
      sentAt = Date.now();
      window.nowPlaying.report(now);
    }
  }

  // Polling only happens while something consumes the result. Measured: running
  // it unconditionally cost about 14 CPU points during playback, roughly two
  // thirds of the app's total, for data nobody was looking at.
  let timer = null;
  window.nowPlaying.onActive((on) => {
    if (on && !timer) {
      timer = setInterval(tick, 500);
      window.__ytmPollId = timer;
      tick();
    } else if (!on && timer) {
      clearInterval(timer);
      timer = null;
      window.__ytmPollId = 0;
      last = null;
    }
  });

  // Playback control. play/pause goes through the video element because that
  // always exists; skipping needs the app's own buttons, there is no API for it.
  window.nowPlaying.onCommand((cmd) => {
    const v = video();
    if (cmd === 'playpause' && v) {
      if (v.paused) v.play();
      else v.pause();
      return;
    }
    const sel =
      cmd === 'next'
        ? 'ytmusic-player-bar .next-button'
        : cmd === 'previous'
          ? 'ytmusic-player-bar .previous-button'
          : null;
    const btn = sel && document.querySelector(sel);
    if (btn) btn.click();
  });

  return 'ok';
})();
