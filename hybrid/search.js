'use strict';

// Search with suggestions from YouTube Music.

const input = document.querySelector('#search input');
const ICON_SEARCH = document.querySelector('#search > svg path').getAttribute('d');
let suggestTimer = null;
let suggestSeq = 0;
let active = -1;

const options = () => [...$('suggest').querySelectorAll('[role="option"]')];

function closeSuggest() {
  suggestSeq++;
  clearTimeout(suggestTimer);
  $('suggest').hidden = true;
  input.setAttribute('aria-expanded', 'false');
  input.removeAttribute('aria-activedescendant');
  active = -1;
}

function search(q) {
  closeSuggest();
  if (!q) return;
  rememberQuery(q);
  go({ title: q, kind: 'search', query: q, load: () => api.search(q) });
}

// Recent searches and the hits opened from them, kept on this device only.
const RECENT = 'recentSearch';
function loadRecent() {
  try {
    const r = JSON.parse(localStorage.getItem(RECENT)) || {};
    return {
      queries: (Array.isArray(r.queries) ? r.queries : []).filter((q) => typeof q === 'string').slice(0, 8),
      hits: (Array.isArray(r.hits) ? r.hits : []).filter((h) => h && typeof h.title === 'string' && (h.browseId || h.watch)).slice(0, 6),
    };
  } catch {
    return { queries: [], hits: [] };
  }
}
function saveRecent(r) {
  try {
    localStorage.setItem(RECENT, JSON.stringify(r));
  } catch {}
}
const hitKey = (h) => (h.watch ? h.watch.videoId : h.browseId);

function rememberQuery(q) {
  const r = loadRecent();
  r.queries = [q, ...r.queries.filter((x) => x.toLowerCase() !== q.toLowerCase())].slice(0, 8);
  saveRecent(r);
}

function rememberHit(item) {
  if (!item.watch && !item.browseId) return;
  const r = loadRecent();
  const hit = {
    title: item.title,
    subtitle: item.subtitle || '',
    thumb: item.thumb || '',
    round: !!item.round,
    browseId: item.watch ? null : item.browseId,
    watch: item.watch ? { videoId: item.watch.videoId } : null,
  };
  r.hits = [hit, ...r.hits.filter((h) => hitKey(h) !== hitKey(hit))].slice(0, 6);
  saveRecent(r);
}

// A cross that takes one entry off the list, without picking it.
function dropButton(run) {
  const b = iconButton('drop-x', ICONS.close, T.remove, () => {});
  b.tabIndex = -1;
  b.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    run();
    showRecent();
  });
  return b;
}

// The empty, focused field offers what was searched and opened before.
function showRecent() {
  const r = loadRecent();
  if (!r.queries.length && !r.hits.length) return closeSuggest();
  const head = div('recent-head', T.recentSearch);
  const clear = document.createElement('button');
  clear.type = 'button';
  clear.tabIndex = -1;
  clear.textContent = T.clearHistory;
  clear.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    saveRecent({ queries: [], hits: [] });
    closeSuggest();
  });
  head.append(clear);
  const queries = r.queries.map((q, n) => {
    const o = document.createElement('div');
    o.id = 'suggest-r' + n;
    o.setAttribute('role', 'option');
    const label = document.createElement('span');
    label.textContent = q;
    o.append(svg(ICONS.history), label, dropButton(() => saveRecent({ ...r, queries: r.queries.filter((x) => x !== q) })));
    o.pick = () => {
      input.value = q;
      $('search-clear').hidden = false;
      $('search').classList.add('filled');
      search(q);
    };
    o.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      o.pick();
    });
    return o;
  });
  const hits = r.hits.map((h, n) => {
    const o = entityOption(h, 'h' + n);
    o.append(dropButton(() => saveRecent({ ...r, hits: r.hits.filter((x) => hitKey(x) !== hitKey(h)) })));
    return o;
  });
  $('suggest').replaceChildren(head, ...queries, ...(queries.length && hits.length ? [document.createElement('hr')] : []), ...hits);
  active = -1;
  const open = document.activeElement === input;
  $('suggest').hidden = !open;
  input.setAttribute('aria-expanded', String(open));
}

function setActive(i) {
  const list = options();
  active = list.length ? (i + list.length) % list.length : -1;
  list.forEach((o, n) => o.setAttribute('aria-selected', String(n === active)));
  if (active >= 0) input.setAttribute('aria-activedescendant', list[active].id);
}

// A direct hit: artist, album or song with its picture, played or opened at once.
function entityOption(item, n) {
  const o = document.createElement('div');
  o.id = 'suggest-e' + n;
  o.className = 'entity';
  o.setAttribute('role', 'option');
  const img = thumb(item.thumb);
  if (item.round) img.classList.add('round');
  const text = div('text');
  text.append(div('title', item.title), div('sub', item.subtitle));
  o.append(img, text);
  o.pick = () => {
    closeSuggest();
    input.blur();
    rememberHit(item);
    activate(item);
    // Played straight from the list, not from the page that happens to be open.
    if (item.watch) playOrigin = null;
  };
  o.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    o.pick();
  });
  return o;
}

// What was typed stays plain, the completion is bold, as on YouTube Music.
function showSuggestions(q, { texts: list, items }) {
  $('suggest').replaceChildren(
    ...list.map((s, n) => {
      const o = document.createElement('div');
      o.id = 'suggest-' + n;
      o.setAttribute('role', 'option');
      const label = document.createElement('span');
      const typed = s.toLowerCase().startsWith(q.toLowerCase()) ? q.length : 0;
      const bold = document.createElement('b');
      bold.textContent = s.slice(typed);
      label.append(s.slice(0, typed), bold);
      o.append(svg(ICON_SEARCH), label);
      // pointerdown, not click: keeps focus in the field, so blur does not close the list first.
      o.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        input.value = s;
        search(s);
      });
      return o;
    })
  );
  if (items.length) {
    if (list.length) $('suggest').append(document.createElement('hr'));
    $('suggest').append(...items.map(entityOption));
  }
  active = -1;
  const open = list.length + items.length > 0 && document.activeElement === input;
  $('suggest').hidden = !open;
  input.setAttribute('aria-expanded', String(open));
}

$('search').addEventListener('submit', (e) => {
  e.preventDefault();
  const pick = active >= 0 ? options()[active] : null;
  if (pick && pick.pick) return pick.pick();
  if (pick) input.value = pick.textContent;
  search(input.value.trim());
});
input.addEventListener('input', () => {
  $('search-clear').hidden = !input.value;
  $('search').classList.toggle('filled', !!input.value);
  clearTimeout(suggestTimer);
  const q = input.value.trim();
  if (!q) {
    closeSuggest();
    return showRecent();
  }
  suggestTimer = setTimeout(async () => {
    const seq = ++suggestSeq;
    const list = await api.suggest(q).catch(() => ({ texts: [], items: [] }));
    if (seq === suggestSeq) showSuggestions(q, list);
  }, 150);
});
input.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    if ($('suggest').hidden) return;
    e.preventDefault();
    setActive(active + (e.key === 'ArrowDown' ? 1 : -1));
  } else if (e.key === 'Escape' && !$('suggest').hidden) {
    e.preventDefault();
    closeSuggest();
  }
});
input.addEventListener('focus', () => {
  // The list drops into the slot, under the player view.
  setSlot(null);
  if (!input.value.trim()) showRecent();
  else if (options().length) {
    $('suggest').hidden = false;
    input.setAttribute('aria-expanded', 'true');
  }
});
input.addEventListener('blur', () => {
  $('suggest').hidden = true;
  input.setAttribute('aria-expanded', 'false');
});
$('search-clear').addEventListener('click', () => {
  input.value = '';
  $('search-clear').hidden = true;
  $('search').classList.remove('filled');
  $('suggest').replaceChildren();
  closeSuggest();
  input.focus();
});
