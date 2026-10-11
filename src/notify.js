'use strict';

// A desktop notification when a new track starts while the app is in the background.

const { Notification, net, nativeImage } = require('electron');
const store = require('./store');

let inView = () => false;
let last = null;
let shown = null;

async function icon(url) {
  if (!url) return undefined;
  try {
    const res = await net.fetch(url);
    return nativeImage.createFromBuffer(Buffer.from(await res.arrayBuffer())).resize({ width: 128 });
  } catch {
    return undefined;
  }
}

async function onTrack(t) {
  if (!t || t.ad || !t.playing) return;
  const key = t.videoId || t.title;
  if (key === last) return;
  // Remembered even when nothing is shown, so a later focus change does not announce an old track.
  last = key;
  if (!store.settings.notify || inView() || !Notification.isSupported()) return;
  const n = new Notification({ title: t.title, body: t.artist, icon: await icon(t.art), silent: true });
  // One at a time; a stack of old tracks says nothing.
  if (shown) shown.close();
  shown = n;
  n.show();
}

module.exports = {
  init: (isInView) => {
    inView = isInView;
  },
  onTrack,
  enabled: () => store.settings.notify === true,
};
