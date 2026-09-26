// Injected once at launch when a resume record exists. main.js loads the track
// muted, splices the saved record into the placeholder below, and awaits the
// promise this returns to unmute. Resumes PAUSED: one click on play starts
// sound, which sidesteps autoplay policy and keeps every failure silent.
(() => {
  const D = __RESUME_DATA__;
  const DEADLINE = 20000;
  const start = Date.now();
  let sawTarget = false;
  return new Promise((resolve) => {
    const fin = (why) => {
      clearInterval(t);
      resolve(why);
    };
    const t = setInterval(() => {
      if (Date.now() - start > DEADLINE) return fin('deadline');
      const p = document.getElementById('movie_player');
      if (!p || typeof p.seekTo !== 'function' || typeof p.getVideoData !== 'function') return;
      // Never seek during an ad: the playing element and the position are the
      // ad's, not the track's.
      if (p.classList.contains('ad-showing') || p.classList.contains('ad-interrupting')) return;
      let vd = null;
      try {
        vd = p.getVideoData();
      } catch {
        return;
      }
      const id = vd && vd.video_id;
      if (!id) return;
      if (id === D.videoId) sawTarget = true;
      // Target played and then moved on (autoplay advanced, or the user picked
      // something): do not yank it back to an old position.
      else if (sawTarget) return fin('left');
      // Foreign id before the target ever showed is most likely a pre-roll ad
      // without the class marker; keep waiting for the real track to load.
      else return;
      // Length from the player API, like nowplaying.js: the video element's own
      // duration covers everything the session has appended to the MediaSource,
      // so after a pre-roll ad it is the ad plus the track and never matches.
      let g = null;
      try {
        g = typeof p.getProgressState === 'function' ? p.getProgressState() : null;
      } catch {
        return;
      }
      const len = g && g.seekableEnd > 0 ? g.seekableEnd : 0;
      if (!len) return;
      // Guard against seeking a stream that is not the saved track (or not
      // loaded yet). Skipped when no duration was captured.
      if (D.duration > 0 && Math.abs(len - D.duration) > 3) return;
      const target = Math.min(Math.max(D.position, 0), Math.max(0, len - 5));
      try {
        p.seekTo(target, true);
        p.pauseVideo();
      } catch {
        return fin('seek-error');
      }
      fin('ok');
    }, 350);
  });
})();
