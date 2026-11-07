(() => {
  if (window.__ytmNowPlaying) return 'already mounted';
  window.__ytmNowPlaying = true;

  const BAR = 'ytmusic-player-bar';
  const MINI = 'ytmusic-app-layout > ytmusic-miniplayer';
  const moviePlayer = () => document.getElementById('movie_player');
  const queueStore = () => document.querySelector('ytmusic-player-queue')?.queue?.store?.getState();

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

  // The player API, not video.currentTime: YouTube Music appends the next track to the
  // same MediaSource, so the element's timeline runs on across tracks. The length is
  // seekableEnd; getDuration() is only what has buffered.
  function times(v) {
    const p = moviePlayer();
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
    const p = moviePlayer();
    try {
      const id = p && typeof p.getVideoData === 'function' && p.getVideoData().video_id;
      return typeof id === 'string' ? id : '';
    } catch {
      return '';
    }
  }

  function adShowing(p) {
    // ponytail: the only ad signal we have. Verified present as a class on
    // #movie_player, but not verified to flip true during a Free-tier ad. If it
    // never flips, capture during an ad falls back to lastSnap on the duration
    // mismatch alone, which the restore side also guards.
    return !!p && (p.classList.contains('ad-showing') || p.classList.contains('ad-interrupting'));
  }

  // The classic player bar, or the redesigned one (ytmusic-miniplayer, seen from 2026-10).
  function likeStatus() {
    const el = document.querySelector(`${BAR} #like-button-renderer`);
    if (el) return el.getAttribute('like-status');
    const bar = document.querySelector(MINI);
    const pressed = (sel) => {
      const b = bar && bar.querySelector(sel);
      return b ? b.getAttribute('aria-pressed') === 'true' : null;
    };
    const like = pressed('like-button-view-model button');
    if (like === null) return null;
    if (like) return 'LIKE';
    return pressed('dislike-button-view-model button') ? 'DISLIKE' : 'INDIFFERENT';
  }

  // Shuffle and repeat from the store all bar layouts share; the classic slider curves its volume, the redesigned one does not.
  function controls() {
    const st = queueStore()?.queue;
    const bar = document.querySelector(BAR);
    const p = moviePlayer();
    let volume = null;
    let muted = false;
    if (bar) {
      volume = bar.volume;
      muted = !!bar.isMuted;
    } else if (typeof p?.getVolume === 'function') {
      volume = p.getVolume();
      muted = !!p.isMuted();
    }
    const av = document.querySelector('ytmusic-av-toggle');
    const skip = document.querySelector('.ytp-skip-ad-button, .ytp-ad-skip-button-modern, .ytp-ad-skip-button');
    return {
      shuffle: !!st?.shuffleEnabled,
      repeat: st ? st.repeatMode : null,
      volume,
      muted,
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
    const p = moviePlayer();
    const type = typeof p?.getPlayerResponse === 'function' ? p.getPlayerResponse()?.videoDetails?.musicVideoType : null;
    if (!type) return v.videoWidth > 0;
    const audioOnly = !!queueStore()?.player?.audioOnly;
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
      ad: adShowing(moviePlayer()),
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

  // Everything except position, which the consumers project forward from `at` themselves.
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
    // The heartbeat is a safety net for metadata, which has no event of its own.
    if (differs(read(), last) || Date.now() - sentAt > 5000) send();
  }

  // Events for anything that moves the playhead: a seek cannot wait for the next poll.
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

  // Resume snapshot, pulled by main on a slow timer. Needs getVideoData()'s durable id,
  // which mediaSession lacks. Feature-detected, so a renamed API only stops resume.
  let lastSnap = null;
  window.__ytmSnapshot = () => {
    const p = moviePlayer();
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

  // Classic bar, redesigned bar, or the player page's own controls on a narrow page.
  const SKIP = {
    next: `${BAR} .next-button, ${MINI} .ytmusicPlayerControlsNextButton button, ytmusic-player-controls .next-button`,
    previous: `${BAR} .previous-button, ${MINI} .ytmusicPlayerControlsPreviousButton button, ytmusic-player-controls .previous-button`,
  };

  // Playback control. play/pause goes through the video element because that
  // always exists; skipping needs the app's own buttons, there is no API for it.
  window.nowPlaying.onCommand((cmd, arg) => {
    const v = video();
    if (cmd === 'seek') {
      const p = moviePlayer();
      if (typeof p?.seekTo === 'function') p.seekTo(arg, true);
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
    const sel = SKIP[cmd];
    const btn = sel && document.querySelector(sel);
    if (btn) btn.click();
  });

  return 'ok';
})();
