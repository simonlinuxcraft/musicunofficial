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

  // Not video.currentTime/duration. When a track ends and the next one starts
  // by itself, YouTube Music appends it to the same MediaSource, so the
  // element's timeline keeps counting across the whole session: measured at
  // 280 s of 379 s while the player bar read 1:11 of 3:29. The player API stays
  // track relative. getDuration() is not the length either, it reports how much
  // has buffered and grows while the track plays; seekableEnd is the length.
  function times(v) {
    const p = document.getElementById('movie_player');
    if (p && typeof p.getProgressState === 'function') {
      try {
        const g = p.getProgressState();
        if (g && Number.isFinite(g.current) && g.seekableEnd > 0) {
          return { position: g.current, duration: g.seekableEnd };
        }
      } catch {}
    }
    // Only correct until the first automatic track change, but it is all there
    // is if the API ever goes away.
    return {
      position: Number.isFinite(v.currentTime) ? v.currentTime : 0,
      duration: Number.isFinite(v.duration) ? v.duration : 0,
    };
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

    const t = times(v);

    return {
      title: m.title || '',
      artist: m.artist || '',
      album: m.album || '',
      art,
      // video.paused is the truth. playbackState lags behind it on seek.
      playing: !v.paused && !v.ended,
      position: t.position,
      duration: t.duration,
      // When position was read. Everything downstream is asynchronous: the IPC
      // hop, the mini player's own redraw, Discord's rate limit. Without this
      // each consumer treats a stale position as current and ends up behind by
      // however long the trip took.
      at: Date.now(),
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

  function send() {
    const now = read();
    last = now;
    sentAt = Date.now();
    window.nowPlaying.report(now);
  }

  function tick() {
    // Only worth a message when something other than the position moved; the
    // consumers project the position forward themselves from `at`. The slow
    // heartbeat is a safety net for metadata, which has no event to listen to.
    if (differs(read(), last) || Date.now() - sentAt > 5000) send();
  }

  // Events, not polling, for anything that moves the playhead. A seek is a
  // discontinuity no interval can catch in time: with a 500 ms poll the
  // consumers stayed on the old position until the next tick.
  const EVENTS = ['seeked', 'play', 'pause', 'ratechange', 'durationchange', 'loadedmetadata', 'ended'];
  let bound = null;

  function bind() {
    const v = video();
    if (v === bound) return;
    if (bound) for (const e of EVENTS) bound.removeEventListener(e, send);
    bound = v;
    if (bound) for (const e of EVENTS) bound.addEventListener(e, send);
  }

  // Only runs while something consumes the result, so a plain window with no
  // mini player and no Rich Presence does no work at all.
  let timer = null;
  window.nowPlaying.onActive((on) => {
    if (on && !timer) {
      bind();
      // Catches a swapped <video> element and metadata changes, which fire no
      // events of their own.
      timer = setInterval(() => {
        bind();
        tick();
      }, 1000);
      window.__ytmPollId = timer;
      send();
    } else if (!on && timer) {
      clearInterval(timer);
      timer = null;
      window.__ytmPollId = 0;
      if (bound) for (const e of EVENTS) bound.removeEventListener(e, send);
      bound = null;
      last = null;
    }
  });

  // Resume snapshot. The main process pulls this on a slow timer and at quit to
  // remember which track to reopen. It needs a durable id, which mediaSession
  // does not carry; #movie_player.getVideoData() does, and has since long before
  // this Polymer layout. Everything is feature-detected so a renamed API just
  // stops resume working, never breaks the read path above.
  let lastSnap = null;
  function adShowing(p) {
    // ponytail: the only ad signal we have. Verified present as a class on
    // #movie_player, but not verified to flip true during a Free-tier ad. If it
    // never flips, capture during an ad falls back to lastSnap on the duration
    // mismatch alone, which the restore side also guards.
    return !!p && (p.classList.contains('ad-showing') || p.classList.contains('ad-interrupting'));
  }
  window.__ytmSnapshot = () => {
    const p = document.getElementById('movie_player');
    const base = read();
    if (!p || typeof p.getVideoData !== 'function' || adShowing(p) || !base) return lastSnap;
    let vd = null;
    try {
      vd = p.getVideoData();
    } catch {
      return lastSnap;
    }
    const videoId = vd && typeof vd.video_id === 'string' ? vd.video_id : '';
    if (!videoId) return lastSnap;
    lastSnap = {
      videoId,
      list: (vd && typeof vd.list === 'string' && vd.list) || null,
      title: base.title,
      position: base.position,
      duration: base.duration,
      playing: base.playing,
      at: base.at,
    };
    return lastSnap;
  };

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
