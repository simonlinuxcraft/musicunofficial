'use strict';

// Settings, as a page of its own in the list area.

function openSettings() {
  stack.length = 0;
  show({ root: 'settings', title: T.settings, load: () => api.settings(), render: renderSettings });
}

function heading(text) {
  const h = document.createElement('h2');
  h.textContent = text;
  return h;
}

function field(label, control, note) {
  const row = div('set-row');
  const text = document.createElement('label');
  text.textContent = label;
  text.htmlFor = control.id;
  if (note) text.append(div('note', note));
  row.append(text, control);
  return row;
}

function select(id, options, value, onChange) {
  const s = document.createElement('select');
  s.id = id;
  for (const [v, label] of options) {
    const o = document.createElement('option');
    o.value = String(v);
    o.textContent = label;
    s.append(o);
  }
  s.value = String(value);
  s.addEventListener('change', () => onChange(s.value));
  return s;
}

function checkbox(id, checked, onChange) {
  const c = document.createElement('input');
  c.type = 'checkbox';
  c.id = id;
  c.checked = checked;
  c.addEventListener('change', () => onChange(c.checked));
  return c;
}

function textInput(id, type, placeholder) {
  const i = document.createElement('input');
  i.type = type;
  i.id = id;
  i.placeholder = placeholder;
  i.spellcheck = false;
  i.autocomplete = 'off';
  return i;
}

function button(label, onClick, primary) {
  const b = document.createElement('button');
  b.className = 'btn' + (primary ? ' primary' : '');
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}

// Every change comes back as the full new state and the page is drawn from it.
const set = (key, value) =>
  api
    .setting(key, value)
    .then((s) => s && view && view.root === 'settings' && renderSettings(s))
    .catch((e) => toast(errorText(e)));

function lastfmStep(step, ...args) {
  return step(...args)
    .then((s) => s && renderSettings(s))
    .catch((e) => toast(T.lastfmFailed + errorText(e)));
}

function sleepNote(s) {
  if (s.sleep.mode === 'track') return T.sleepAfter;
  if (s.sleep.mode === 'time') return T.sleepLeft.replace('{m}', Math.max(1, Math.round((s.sleep.endsAt - Date.now()) / 60000)));
  return '';
}

// Minutes left count down while the page is open; a timer that ran out shows as off.
let shownSettings = null;
setInterval(() => {
  const s = shownSettings;
  if (!s || !view || view.root !== 'settings' || s.sleep.mode !== 'time') return;
  if (Date.now() >= s.sleep.endsAt) {
    api.settings().then((n) => n && view.root === 'settings' && renderSettings(n));
    return;
  }
  const note = $('set-sleep') && $('set-sleep').closest('.set-row').querySelector('.note');
  if (note) note.textContent = sleepNote(s);
}, 15000);

function keyList() {
  const box = div('keys');
  for (const [keys, label] of T.keys) {
    const row = div('set-row');
    row.append(div('', label), div('kbd', keys));
    box.append(row);
  }
  return box;
}

const QUALITY_LABELS = [
  ['hd2160', '2160p'],
  ['hd1440', '1440p'],
  ['hd1080', '1080p'],
  ['hd720', '720p'],
  ['large', '480p'],
  ['medium', '360p'],
  ['tiny', '144p'],
];

function renderSettings(s) {
  shownSettings = s;
  const box = div('settings');
  const sleepChoices = [['off', T.sleepOff], ['track', T.sleepTrack], ...[15, 30, 45, 60, 90].map((m) => [m, m + T.sleepMinutes])];
  box.append(
    heading(T.setGeneral),
    field(
      T.setLanguage,
      select('set-language', [['system', T.langSystem], ['de', 'Deutsch'], ['en', 'English']], s.language, (v) => {
        // The window reloads in the new language and comes back to this page.
        sessionStorage.setItem('reopen', 'settings');
        set('language', v);
      })
    ),
    field(T.setNotify, checkbox('set-notify', s.notify, (v) => set('notify', v)), T.setNotifyHint),
    field(T.setDiscord, checkbox('set-discord', s.richPresence, (v) => set('richPresence', v))),
    field(
      T.setQuality,
      select('set-quality', [['auto', T.qualityAuto], ...QUALITY_LABELS], s.videoQuality, (v) => set('videoQuality', v)),
      T.setQualityHint
    ),
    heading(T.setSleep),
    field(
      T.sleepLabel,
      select('set-sleep', sleepChoices, s.sleep.mode === 'time' ? s.sleep.minutes : s.sleep.mode, (v) =>
        set('sleep', /^\d+$/.test(v) ? Number(v) : v)
      ),
      sleepNote(s)
    ),
    heading('Last.fm')
  );
  if (s.lastfm.connected) {
    const row = div('actions');
    row.append(div('', T.lastfmConnected + s.lastfm.name), button(T.lastfmDisconnect, () => lastfmStep(api.lastfmDisconnect)));
    box.append(row);
    if (s.lastfm.locked) box.append(div('note', T.lastfmLocked));
  } else if (s.lastfm.waiting) {
    const row = div('actions');
    row.append(button(T.lastfmFinish, () => lastfmStep(api.lastfmFinish), true));
    box.append(div('note', T.lastfmWaiting), row);
  } else {
    const intro = div('note', T.lastfmIntro + ' ');
    const create = document.createElement('span');
    create.className = 'link';
    create.textContent = T.lastfmCreate;
    create.addEventListener('click', api.openLastfmAccount);
    intro.append(create);
    const key = textInput('lastfm-key', 'text', T.lastfmKey);
    const secret = textInput('lastfm-secret', 'password', T.lastfmSecret);
    const row = div('actions');
    row.append(button(T.lastfmConnect, () => lastfmStep(api.lastfmConnect, key.value, secret.value), true));
    box.append(intro, field(T.lastfmKey, key), field(T.lastfmSecret, secret), row);
  }
  box.append(heading(T.setUpdates), div('note', T.updateVersion + s.update.version + (s.update.on ? '' : '. ' + T.updateManual)));
  if (s.update.ready) {
    const row = div('actions');
    row.append(
      div('', T.updateReady + s.update.ready),
      button(T.updateInstall, () => api.installUpdate().then((ok) => ok || toast(T.updateFailed)), true)
    );
    box.append(row);
  }
  box.append(heading(T.setKeys), keyList());
  $('list').replaceChildren(box);
}

$('open-settings').addEventListener('click', openSettings);

api.onUpdateReady((version) => {
  toast(T.updateReady + version);
  if (view && view.root === 'settings') api.settings().then((s) => s && view.root === 'settings' && renderSettings(s));
});
