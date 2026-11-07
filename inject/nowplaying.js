(() => {
  if (window.__ytmNowPlaying) return 'already mounted';
  window.__ytmNowPlaying = true;

  // Metadata comes from mediaSession, not from the DOM, so it survives layout changes.
  // An ad or a preview can add a second <video>: prefer the playing one, then any with a duration.
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

  // Lets the hybrid UI mark the playing row in its lists.
  function videoId() {
    const p = document.getElementById('movie_player');
    try {
      const id = p && typeof p.getVideoData === 'function' && p.getVideoData().video_id;
      return typeof id === 'string' ? id : '';
    } catch {
      return '';
    }
  }

  // The classic player bar, or the redesigned one (ytmusic-miniplayer, seen from 2026-10).
  function likeStatus() {
    const el = document.querySelector('ytmusic-player-bar #like-button-renderer');
    if (el) return el.getAttribute('like-status');
    const bar = document.querySelector('ytmusic-app-layout > ytmusic-miniplayer');
    const pressed = (sel) => {
      const b = bar && bar.querySelector(sel);
      return b ? b.getAttribute('aria-pressed') === 'true' : null;
    };
    const like = pressed('like-button-view-model button');
    if (like === null) return null;
    return like ? 'LIKE' : pressed('dislike-button-view-model button') ? 'DISLIKE' : 'INDIFFERENT';
  }

  // Shuffle and repeat from the store all bar layouts share; the classic slider curves its volume, the redesigned one does not.
  function controls() {
    const q = document.querySelector('ytmusic-player-queue');
    const st = q && q.queue && q.queue.store ? q.queue.store.getState().queue : null;
    const bar = document.querySelector('ytmusic-player-bar');
    const p = document.getElementById('movie_player');
    const api = p && typeof p.getVolume === 'function';
    const av = document.querySelector('ytmusic-av-toggle');
    const skip = document.querySelector('.ytp-skip-ad-button, .ytp-ad-skip-button-modern, .ytp-ad-skip-button');
    return {
      shuffle: !!(st && st.shuffleEnabled),
      repeat: st ? st.repeatMode : null,
      volume: bar ? bar.volume : api ? p.getVolume() : null,
      muted: bar ? !!bar.isMuted : !!(api && p.isMuted()),
      // Song or music video, for tracks that come in both versions.
      avMode: av ? av.getAttribute('playback-mode') : null,
      avAvailable: !!av && !av.hasAttribute('toggle-disabled'),
      // YouTube's own skip button, only there once an ad allows skipping.
      adSkip: !!(skip && skip.offsetParent !== null),
    };
  }

  // Songs, podcasts and uploads play audio only, and so does any track in the page's audio-only mode.
  const AUDIO_TYPES = ['MUSIC_VIDEO_TYPE_ATV', 'MUSIC_VIDEO_TYPE_PODCAST_EPISODE', 'MUSIC_VIDEO_TYPE_PRIVATELY_OWNED_TRACK'];
  function hasVideo(v) {
    // Loaded but without a picture: a video that only plays as sound here.
    if (v.readyState >= 2 && v.videoWidth === 0) return false;
    const p = document.getElementById('movie_player');
    const type = p && typeof p.getPlayerResponse === 'function' ? p.getPlayerResponse()?.videoDetails?.musicVideoType : null;
    if (!type) return v.videoWidth > 0;
    const q = document.querySelector('ytmusic-player-queue');
    const audioOnly = !!(q && q.queue && q.queue.store && q.queue.store.getState().player?.audioOnly);
    return !AUDIO_TYPES.includes(type) && !audioOnly;
  }

  // src/page.js reads it back after a click.
  window.__ytmControls = () => ({ ...controls(), like: likeStatus() });

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
      // The metadata is the ad's then, which the hybrid UI labels instead of passing off as the track.
      ad: adShowing(document.getElementById('movie_player')),
      // Polled with the rest because the bar sets it a moment after the track changes.
      like: likeStatus(),
      videoId: videoId(),
      video: hasVideo(v),
      ...controls(),
      position: t.position,
      duration: t.duration,
      // When position was read, so the asynchronous consumers can project it forward.
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
      a.ad !== b.ad ||
      a.like !== b.like ||
      a.videoId !== b.videoId ||
      a.video !== b.video ||
      a.shuffle !== b.shuffle ||
      a.repeat !== b.repeat ||
      a.volume !== b.volume ||
      a.muted !== b.muted ||
      a.avMode !== b.avMode ||
      a.avAvailable !== b.avAvailable ||
      a.adSkip !== b.adSkip ||
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

  // Only runs while something consumes the result. `ms` is the poll interval
  // main asks for: fast while a window shows the track, slow for background
  // consumers, 0 for none.
  let timer = null;
  let every = 0;
  window.nowPlaying.onActive((ms) => {
    ms = Number.isFinite(ms) && ms > 0 ? ms : 0;
    if (ms === every) return;
    every = ms;
    clearInterval(timer);
    timer = null;
    if (ms) {
      bind();
      // Catches a swapped <video> element and metadata changes, which fire no
      // events of their own.
      timer = setInterval(() => {
        bind();
        tick();
      }, ms);
      send();
    } else {
      if (bound) for (const e of EVENTS) bound.removeEventListener(e, send);
      bound = null;
      last = null;
    }
  });

  // Resume snapshot. The main process pulls this on a slow timer to
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
      position: base.position,
      duration: base.duration,
      playing: base.playing,
      at: base.at,
    };
    return lastSnap;
  };

  // Playback control. play/pause goes through the video element because that
  // always exists; skipping needs the app's own buttons, there is no API for it.
  window.nowPlaying.onCommand((cmd, arg) => {
    const v = video();
    if (cmd === 'seek') {
      const p = document.getElementById('movie_player');
      if (p && typeof p.seekTo === 'function') p.seekTo(arg, true);
      return;
    }
    if (cmd === 'playpause' && v) {
      if (v.paused) v.play();
      else v.pause();
      return;
    }
    // Separate from playpause for MPRIS, whose Play and Pause must not toggle.
    if (cmd === 'play' && v) {
      if (v.paused) v.play();
      return;
    }
    if (cmd === 'pause' && v) {
      if (!v.paused) v.pause();
      return;
    }
    // Classic bar, redesigned bar, or the player page's own controls on a narrow page.
    const sel =
      cmd === 'next'
        ? 'ytmusic-player-bar .next-button, ytmusic-app-layout > ytmusic-miniplayer .ytmusicPlayerControlsNextButton button, ytmusic-player-controls .next-button'
        : cmd === 'previous'
          ? 'ytmusic-player-bar .previous-button, ytmusic-app-layout > ytmusic-miniplayer .ytmusicPlayerControlsPreviousButton button, ytmusic-player-controls .previous-button'
          : null;
    const btn = sel && document.querySelector(sel);
    if (btn) btn.click();
  });

  return 'ok';
})();
