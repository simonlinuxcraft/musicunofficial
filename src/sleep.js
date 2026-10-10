'use strict';

// Sleep timer: pauses after a set time, or once the current track has ended.

let pause = () => {};
let timer = null;
let endsAt = 0;
let minutes = 0;
let afterTrack = false;
let trackId = null;
let current = null;

function clear() {
  clearTimeout(timer);
  timer = null;
  endsAt = 0;
  minutes = 0;
  afterTrack = false;
  trackId = null;
}

function fire() {
  clear();
  pause();
}

function set(choice) {
  clear();
  if (choice === 'track') {
    afterTrack = true;
    trackId = current && !current.ad ? current.videoId || current.title : null;
  } else if (typeof choice === 'number') {
    minutes = choice;
    endsAt = Date.now() + choice * 60000;
    timer = setTimeout(fire, choice * 60000);
  }
}

// The end of a track shows as the next one beginning, so that one plays for a moment.
// Not before it actually plays: a pause sent while it still loads is lost, and
// the page starts it anyway.
// ponytail: a pause a second before the end needs the position, add it if the moment bothers.
function onTrack(t) {
  current = t;
  if (!afterTrack || !t || t.ad) return;
  const id = t.videoId || t.title;
  if (!trackId) trackId = id;
  else if (id !== trackId && t.playing) fire();
}

module.exports = {
  init: (onPause) => {
    pause = onPause;
  },
  set,
  onTrack,
  active: () => !!timer || afterTrack,
  state: () => ({ mode: afterTrack ? 'track' : timer ? 'time' : 'off', endsAt, minutes }),
};
