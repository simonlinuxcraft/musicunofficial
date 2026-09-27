// Injected once at launch when a resume record exists. main loads the track
// muted, splices the record into the placeholder and unmutes once this settles.
// Leaves the track paused; up to the deadline every failure stays silent.
(() => {
  const D = __RESUME_DATA__;
  // Generous: on a slow network the player can take well over 20 s to start, and giving up
  // unmutes a track that then plays from the top.
  const DEADLINE = 60000;
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
      if (id === D.videoId) sawTarget = true;
      // The target played and moved on (autoplay, or the user picked something): leave it.
      else if (sawTarget) return fin('left');
      // A foreign id first is most likely a pre-roll ad without the class marker.
      else return;
      // Seeking or pausing before playback has started leaves the player stuck on
      // its buffering spinner, which burned 36 % CPU for good. Muted, so the wait is silent.
      if (state !== 1) return;
      // seekableEnd, not the video element: that one spans everything appended to the MediaSource.
      const len = g && g.seekableEnd > 0 ? g.seekableEnd : 0;
      if (!len) return;
      if (D.duration > 0 && Math.abs(len - D.duration) > 3) return;
      try {
        p.seekTo(Math.min(Math.max(D.position, 0), Math.max(0, len - 5)), true);
        p.pauseVideo();
      } catch {
        return fin('seek-error');
      }
      fin('ok');
    }, 350);
  });
})();
