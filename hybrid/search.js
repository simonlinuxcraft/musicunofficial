'use strict';

// Search with suggestions from YouTube Music.

const input = document.querySelector('#search input');
const ICON_SEARCH = document.querySelector('#search > svg path').getAttribute('d');
let suggestTimer = null;
let suggestSeq = 0;
let active = -1;

const options = () => [...$('suggest').children];

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
  if (q) go({ title: q, kind: 'search', load: () => api.search(q) });
}

function setActive(i) {
  const list = options();
  active = list.length ? (i + list.length) % list.length : -1;
  list.forEach((o, n) => o.setAttribute('aria-selected', String(n === active)));
  if (active >= 0) input.setAttribute('aria-activedescendant', list[active].id);
}

// What was typed stays plain, the completion is bold, as on YouTube Music.
function showSuggestions(q, list) {
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
  active = -1;
  const open = list.length > 0 && document.activeElement === input;
  $('suggest').hidden = !open;
  input.setAttribute('aria-expanded', String(open));
}

$('search').addEventListener('submit', (e) => {
  e.preventDefault();
  const pick = active >= 0 ? options()[active] : null;
  if (pick) input.value = pick.textContent;
  search(input.value.trim());
});
input.addEventListener('input', () => {
  $('search-clear').hidden = !input.value;
  clearTimeout(suggestTimer);
  const q = input.value.trim();
  if (!q) return closeSuggest();
  suggestTimer = setTimeout(async () => {
    const seq = ++suggestSeq;
    const list = await api.suggest(q).catch(() => []);
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
  if (options().length && input.value.trim()) {
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
  $('suggest').replaceChildren();
  closeSuggest();
  input.focus();
});
