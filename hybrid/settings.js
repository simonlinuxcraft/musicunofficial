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

const onSettings = () => view?.root === 'settings';
// Drawn only while the user is still on the settings page.
const redraw = (s) => s && onSettings() && renderSettings(s);

// Every change comes back as the full new state and the page is drawn from it.
const set = (key, value) =>
  api
    .setting(key, value)
    .then(redraw)
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
  if (!s || !onSettings() || s.sleep.mode !== 'time') return;
  if (Date.now() >= s.sleep.endsAt) {
    api.settings().then(redraw);
    return;
  }
  const note = $('set-sleep')?.closest('.set-row').querySelector('.note');
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
    intro.append(link(T.lastfmCreate, api.openLastfmAccount));
    const key = textInput('lastfm-key', 'text', T.lastfmKey);
    const secret = textInput('lastfm-secret', 'password', T.lastfmSecret);
    const row = div('actions');
    row.append(button(T.lastfmConnect, () => lastfmStep(api.lastfmConnect, key.value, secret.value), true));
    box.append(intro, field(T.lastfmKey, key), field(T.lastfmSecret, secret), row);
  }
  box.append(heading(T.setUpdates), div('note', T.updateVersion + s.update.version + (s.update.on ? '' : '. ' + T.updateManual)));
  if (s.update.on) {
    const row = div('actions');
    row.append(button(T.updateCheck, checkUpdate));
    if (s.update.available) row.append(button(T.updateInstall, () => api.settings().then((now) => offerUpdate(now.update)), true));
    box.append(row);
  }
  box.append(heading(T.setKeys), keyList());
  $('list').replaceChildren(box);
}

$('open-settings').addEventListener('click', openSettings);

// Update dialog: offer, then download with a bar, then the password prompt and the restart.

function checkUpdate() {
  api.checkUpdate().then((result) => {
    if (result === 'available') api.settings().then((s) => (redraw(s), offerUpdate(s.update)));
    else toast(result === 'current' ? T.updateCurrent : T.updateCheckFailed);
  });
}

function downloading(text) {
  $('up-actions').hidden = true;
  $('up-bar').hidden = false;
  $('up-text').textContent = text;
}

// Opens or refreshes the dialog from the main-process state, so a reopened
// dialog shows a download that is still running.
function offerUpdate(u) {
  const d = $('up-dialog');
  $('up-version').textContent = T.updateVersion + u.available;
  if (u.busy) {
    downloading(T.updateDownloading + (u.progress === null ? '' : Math.round(u.progress * 100) + ' %'));
    if (u.progress === null) $('up-bar').removeAttribute('value');
    else $('up-bar').value = u.progress;
  } else if ($('up-actions').hidden || !d.open) {
    $('up-text').textContent = T.updateBody;
    $('up-bar').hidden = true;
    $('up-actions').hidden = false;
  }
  if (!d.open) d.showModal();
}

$('up-later').addEventListener('click', () => $('up-dialog').close());
// Escape stays out while the download runs; the dialog is the only sign of it.
$('up-dialog').addEventListener('cancel', (e) => $('up-actions').hidden && e.preventDefault());
$('up-install').addEventListener('click', async () => {
  downloading(T.updateDownloading);
  $('up-bar').removeAttribute('value');
  const ok = await api.installUpdate().catch(() => false);
  $('up-dialog').close();
  if (!ok) toast(T.updateFailed);
});

api.onUpdate((event, data) => {
  if (event === 'available') return api.settings().then((s) => (redraw(s), offerUpdate(s.update)));
  if (event === 'installing') return downloading(T.updateInstalling);
  if (event !== 'progress') return;
  const bar = $('up-bar');
  if (data === null) bar.removeAttribute('value');
  else bar.value = data;
  $('up-text').textContent = T.updateDownloading + (data === null ? '' : Math.round(data * 100) + ' %');
});
