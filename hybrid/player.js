'use strict';

// Player bar

let track = null;
let lastArt = null;
let lastTime = null;
let lastId = null;
const quiet = () => {};

const fmt = (s) => {
  s = Math.max(0, Math.floor(s));
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
};

function positionNow() {
  if (!track || !(track.duration > 0)) return 0;
  const elapsed = track.playing ? Math.max(0, Date.now() - (track.at || Date.now())) / 1000 : 0;
  return Math.min(track.duration, track.position + elapsed);
}

// While the seek bar is held it shows where it would land, not where the track is.
let scrubbing = false;

const duration = () => (track && track.duration > 0 ? track.duration : 0);

function moveBar(p) {
  $('fill').style.transform = $('glide').style.transform = 'translateX(' + (Math.min(1, Math.max(0, p)) - 1) * 100 + '%)';
}

// Puts fill and knob at p (0..1) and, while playing, steps both one device pixel at
// a time: a CSS transition would draw a frame on every refresh. Restarted per update.
let barTimer = 0;
function placeBar(p, secondsLeft) {
  clearInterval(barTimer);
  moveBar(p);
  if (!(secondsLeft > 0)) return;
  const px = (1 - p) * $('seekbar').clientWidth * devicePixelRatio;
  // 20 Hz at most: a short ad on a wide bar would otherwise tick at 100 Hz and more.
  barTimer = setInterval(() => {
    const q = positionNow() / duration();
    moveBar(q);
    if (!(q < 1)) clearInterval(barTimer);
  }, Math.max(50, (secondsLeft * 1000) / px));
}

function syncBar() {
  if (scrubbing) return;
  const dur = duration();
  const pos = positionNow();
  placeBar(dur ? pos / dur : 0, dur && track.playing ? dur - pos : 0);
}

// Text and the range's own value only; the bar itself moves in placeBar.
function drawProgress() {
  const seek = $('seek');
  const dur = duration();
  seek.disabled = !dur;
  const max = String(Math.floor(dur) || 1);
  if (seek.max !== max) seek.max = max;
  const pos = scrubbing ? Number(seek.value) : positionNow();
  if (!scrubbing) seek.value = Math.floor(pos);
  const time = dur ? fmt(pos) + ' / ' + fmt(dur) : '';
  if (time !== lastTime) $('time').textContent = lastTime = time;
}

// Average colour of the cover, capped so a white cover cannot wash out the text over it.
// A host without CORS headers taints the canvas; the bar then just stays dark.
function coverColor(url) {
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.src = url;
  return img.decode().then(() => {
    const c = document.createElement('canvas');
    c.width = c.height = 1;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0, 1, 1);
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
    const k = Math.min(1, 190 / Math.max(r, g, b, 1));
    return 'rgb(' + [r, g, b].map((v) => Math.round(v * k)).join(' ') + ')';
  });
}

async function tintBar(art) {
  const bar = document.querySelector('footer');
  if (!art) return bar.style.removeProperty('--cover');
  // A newer track may have arrived while this one decoded.
  try {
    const color = await coverColor(art);
    if (art === lastArt) bar.style.setProperty('--cover', color);
  } catch {
    if (art === lastArt) bar.style.removeProperty('--cover');
  }
}

function applyLike(like) {
  $('like').setAttribute('aria-pressed', String(like === 'LIKE'));
  $('dislike').setAttribute('aria-pressed', String(like === 'DISLIKE'));
}

function applyControls(c) {
  if (!c) return;
  $('shuffle').setAttribute('aria-pressed', String(c.shuffle));
  const repeatOn = c.repeat !== 'NONE';
  $('repeat').setAttribute('aria-pressed', String(repeatOn));
  $('repeat').title = T['repeat' + c.repeat];
  $('repeat').setAttribute('aria-label', T['repeat' + c.repeat]);
  $('repeat').querySelector('path').setAttribute('d', c.repeat === 'ONE' ? ICON_REPEAT_ONE : ICON_REPEAT);
  applyLike(c.like);
  $('mute').classList.toggle('muted', c.muted);
  // Not while the slider is being dragged, or the page's older value yanks it back.
  if (document.activeElement !== $('volume')) $('volume').value = c.muted ? 0 : c.volume;
}

const refreshControls = () => api.controls().then(applyControls, quiet);

// Artist and album names under the title become links once the page's player bar
// shows them. It updates a moment after the track, so links that do not match
// the new artist are from the old one and get another try.
async function loadNowLinks(id, tries = 0) {
  const links = await api.nowLinks().catch(() => []);
  if (id !== lastId || !track || track.ad) return;
  const artists = links.filter((l) => l.browseId.startsWith('UC'));
  const album = links.find((l) => l.browseId.startsWith('MPRE'));
  if (!artists.some((l) => track.artist.includes(l.text))) {
    if (tries < 4) setTimeout(() => loadNowLinks(id, tries + 1), 800);
    return;
  }
  const box = $('artist');
  box.replaceChildren();
  const linkTo = (l) => link(l.text, () => openPage(l.text, l.browseId));
  artists.forEach((l, i) => {
    if (i) box.append(', ');
    box.append(linkTo(l));
  });
  if (album) box.append(' \u2022 ', linkTo(album));
}

api.onTrack((t) => {
  const has = !!(t && t.title);
  const art = has ? t.art || '' : '';
  track = has ? t : null;
  document.body.classList.toggle('has-track', has);
  document.body.classList.toggle('playing', has && !!t.playing);
  document.body.classList.toggle('ad', has && !!t.ad);
  // The page reports its player bar with the track, so changes made elsewhere
  // (MPRIS, the YouTube Music window) show here too.
  if (has) applyControls({ shuffle: t.shuffle, repeat: t.repeat, like: t.like, volume: t.volume, muted: t.muted });
  $('av').hidden = !(has && t.avAvailable && !t.ad);
  $('av-song').setAttribute('aria-pressed', String(!has || t.avMode !== 'OMV_PREFERRED'));
  $('av-video').setAttribute('aria-pressed', String(has && t.avMode === 'OMV_PREFERRED'));
  $('skip-ad').hidden = !(has && t.ad && t.adSkip);
  setStageVideo(!has || t.video, art);
  document.title = has && !t.ad ? t.title + (t.artist ? ' - ' + t.artist : '') : 'Music';

  if (art !== lastArt) {
    lastArt = art;
    // Quoted and escaped so a stray quote cannot end the value; main only passes https urls anyway.
    $('art').style.backgroundImage = art ? 'url("' + art.replace(/["\\]/g, encodeURIComponent) + '")' : '';
    tintBar(art);
  }

  // Everything that belongs to the track follows a change of it.
  const id = has ? [t.videoId, t.title, t.artist, !!t.ad].join('\n') : null;
  if (id !== lastId) {
    lastId = id;
    $('title').textContent = !has ? T.nothing : t.ad ? T.ad : t.title;
    $('artist').textContent = !has ? '' : t.ad ? T.adHint : t.artist;
    if (!(has && t.ad)) markCurrent(has ? t.videoId : null);
    if (has) refreshControls();
    if (has && !t.ad) loadNowLinks(id);
    if (!$('queue').hidden) {
      if (panelTab === 'lyrics') loadLyrics();
      else loadQueue();
    }
  }
  drawProgress();
  syncBar();
});

setInterval(drawProgress, 250);

for (const id of ['previous', 'playpause', 'next']) {
  $(id).addEventListener('click', () => api.command(id));
}
for (const action of ['shuffle', 'repeat', 'like', 'dislike', 'mute']) {
  $(action).addEventListener('click', async () => {
    const b = $(action);
    // Shuffle waits on the server for a second or so; show it at once and take no clicks meanwhile.
    if (action === 'shuffle') {
      b.disabled = true;
      b.setAttribute('aria-pressed', String(b.getAttribute('aria-pressed') !== 'true'));
    }
    applyControls(await api.control(action).catch(() => null));
    b.disabled = false;
    // Shuffle reorders the queue in place.
    if (action === 'shuffle' && !$('queue').hidden && panelTab === 'queue') loadQueue();
  });
}
// Both versions of a track sit in the queue; the switch picks which one plays.
$('av-song').addEventListener('click', () => api.control('avSong').then(() => !$('queue').hidden && loadQueue(), quiet));
$('av-video').addEventListener('click', () => {
  toggleStage(true);
  api.control('avVideo').then(loadQueue, quiet);
});
$('skip-ad').addEventListener('click', () => api.control('skipAd').catch(quiet));
// Live while dragging. One request at a time; whatever the slider says when it
// returns goes next, so a fast drag never queues up a backlog of stale values.
let volumeBusy = false;
async function sendVolume() {
  if (volumeBusy) return;
  volumeBusy = true;
  let sent;
  let state = null;
  do {
    sent = Number($('volume').value);
    state = await api.control('volume', sent).catch(() => null);
  } while (Number($('volume').value) !== sent);
  volumeBusy = false;
  applyControls(state);
}
$('volume').addEventListener('input', sendVolume);

function volumeBy(step) {
  $('volume').value = Number($('volume').value) + step;
  sendVolume();
}
$('volume').addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    volumeBy(e.deltaY < 0 ? 5 : -5);
  },
  { passive: false }
);

function setScrubbing(on) {
  scrubbing = on;
  $('seekbar').classList.toggle('scrubbing', on);
}

// The time under the pointer, so a spot can be picked to the second before clicking.
function showTip(p) {
  const tip = $('seek-tip');
  const w = $('seekbar').clientWidth;
  tip.textContent = fmt(p * duration());
  tip.style.left = Math.min(w - 24, Math.max(24, p * w)) + 'px';
  tip.hidden = false;
}

$('seekbar').addEventListener('pointermove', (e) => {
  if (!duration() || scrubbing) return;
  const r = e.currentTarget.getBoundingClientRect();
  showTip((e.clientX - r.left) / r.width);
});
$('seekbar').addEventListener('pointerleave', () => {
  if (!scrubbing) $('seek-tip').hidden = true;
});
$('seek').addEventListener('pointerdown', () => setScrubbing(true));
$('seek').addEventListener('input', (e) => {
  setScrubbing(true);
  const p = Number(e.target.value) / Number(e.target.max);
  placeBar(p, 0);
  showTip(p);
  drawProgress();
});
function seekTo(to) {
  if (!track || !duration()) return;
  to = Math.min(duration(), Math.max(0, to));
  api.command('seek', to);
  // Shown at once; the page confirms with its seeked event a moment later.
  track = { ...track, position: to, at: Date.now() };
  drawProgress();
  syncBar();
}

// change fires on release, and once per arrow key press.
$('seek').addEventListener('change', (e) => {
  setScrubbing(false);
  if (!$('seekbar').matches(':hover')) $('seek-tip').hidden = true;
  seekTo(Number(e.target.value));
});
// A press without a move fires no change.
for (const ev of ['pointerup', 'pointercancel']) {
  $('seek').addEventListener(ev, () =>
    setTimeout(() => {
      if (!scrubbing) return;
      setScrubbing(false);
      syncBar();
    })
  );
}
