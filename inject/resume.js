// Injected once at launch when a resume record exists. main loads the track
// muted, splices the record into the placeholder and unmutes once this settles.
// Leaves the track paused; up to the deadline every failure stays silent.
(() => {
  const saved = __RESUME_DATA__;
  // Generous: on a slow network the player can take well over 20 s to start, and giving up
  // unmutes a track that then plays from the top.
  const DEADLINE = 60000;
  const PLAYING = 1; // getPlayerState()
  const start = Date.now();
  let sawTarget = false;
  let mismatchSince = 0;
  return new Promise((resolve) => {
    const fin = (why) => {
      clearInterval(t);
      resolve(why);
    };
    const t = setInterval(() => {
      if (Date.now() - start > DEADLINE) return fin('deadline');
      const p = document.getElementById('movie_player');
      if (!p || typeof p.seekTo !== 'function' || typeof p.getVideoData !== 'function') return;
      // During an ad the position and the playing element are the ad's.
      if (p.classList.contains('ad-showing') || p.classList.contains('ad-interrupting')) return;
      let vd = null;
      let state = null;
      let g = null;
      try {
        vd = p.getVideoData();
        state = p.getPlayerState();
        g = p.getProgressState();
      } catch {
        return;
      }
      const id = vd && vd.video_id;
      if (!id) return;
      if (id !== saved.videoId) {
        // After the target: it moved on (autoplay, or the user picked something), leave it.
        // Before it: most likely a pre-roll ad without the class marker.
        if (sawTarget) return fin('left');
        return;
      }
      sawTarget = true;
      // Seeking or pausing before playback has started leaves the player stuck buffering.
      // Muted, so the wait is silent.
      if (state !== PLAYING) return;
      // seekableEnd, not the video element: that one spans everything appended to the MediaSource.
      const len = g && g.seekableEnd > 0 ? g.seekableEnd : 0;
      if (!len) return;
      if (saved.duration > 0 && Math.abs(len - saved.duration) > 3) {
        // A length that stays off is not settling: paused and unmuted rather than playing muted until the deadline.
        mismatchSince ||= Date.now();
        if (Date.now() - mismatchSince < 5000) return;
        try {
          p.pauseVideo();
        } catch {}
        return fin('mismatch');
      }
      try {
        p.seekTo(Math.min(Math.max(saved.position, 0), Math.max(0, len - 5)), true);
        p.pauseVideo();
      } catch {
        return fin('seek-error');
      }
      fin('ok');
    }, 350);
  });
})();
