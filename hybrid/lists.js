'use strict';

// Lists

const main = document.querySelector('main');
// Back and forward, as in a browser: a new page clears what lay ahead.
const stack = [];
const ahead = [];
let view = null;

const openPage = (title, browseId) => go({ title, kind: 'browse', browseId, load: () => api.browse(browseId) });

// Subtitle with its artist, album and playlist names as links.
function subLine(item, parts = item.parts) {
  const box = div('sub');
  if (item.explicit) {
    const e = div('ex', 'E');
    e.title = T.explicit;
    box.append(e);
  }
  for (const p of parts) {
    if (!p.browseId) {
      box.append(p.text);
      continue;
    }
    const open = (e) => {
      e.stopPropagation();
      openPage(p.text, p.browseId);
    };
    box.append(link(p.text, open));
  }
  return box;
}

// The page the music was started from, named in the big view and one click back there.
let playOrigin = null;

function play(endpoint, videoId) {
  if (!endpoint) return;
  if (view && !view.render) playOrigin = view;
  if (slot === 'stage') drawOrigin();
  // Marked right away; YouTube can take a few seconds to start, the next update confirms or corrects it.
  if (videoId) markCurrent(videoId);
  api.navigate(endpoint).catch((e) => {
    markCurrent(track && !track.ad ? track.videoId : null);
    fail(e);
  });
}

// A track plays, everything else opens.
function activate(item) {
  if (view && view.kind === 'search') rememberHit(item);
  if (item.watch) play({ watchEndpoint: item.watch }, item.watch.videoId);
  else openPage(item.title, item.browseId);
}

function coverOf(item, url = item.thumb) {
  const box = div('cover');
  // Album tracks have no cover of their own; YouTube Music numbers them instead.
  box.append(!url && item.index ? div('index', item.index) : thumb(url));
  if (item.round) box.firstChild.classList.add('round');
  if (item.watch) {
    // Does what the row does, so pointer only: no extra tab stop or announcement.
    const b = iconButton('cover-play', ICON_PLAY, T.playAll, () => activate(item));
    b.tabIndex = -1;
    b.setAttribute('aria-hidden', 'true');
    // The playing track shows its bars on the cover, wherever the cover is.
    const now = div('playing');
    now.append(eqBars());
    box.append(now, b);
  } else if (item.play) box.append(iconButton('cover-play', ICON_PLAY, T.playAll, () => play(item.play)));
  if (item.kind === 'video' && item.duration) box.append(div('dur', item.duration));
  return box;
}

// Ctrl+click picks tracks one by one, Shift+click a run of them, as in a file manager.
let anchor = null;

function toggleSelect(el, range) {
  const all = [...el.parentElement.querySelectorAll(':scope > [data-video]:not([hidden])')];
  if (range && all.includes(anchor)) {
    const [a, b] = [all.indexOf(anchor), all.indexOf(el)].sort((x, y) => x - y);
    for (const x of all.slice(a, b + 1)) x.classList.add('selected');
    return;
  }
  el.classList.toggle('selected');
  anchor = el;
}

const selection = () => [...document.querySelectorAll('#list .selected:not([hidden])')].map((el) => el.item);

function clearSelection() {
  for (const el of document.querySelectorAll('#list .selected')) el.classList.remove('selected');
  anchor = null;
}
document.addEventListener('keydown', (e) => e.key === 'Escape' && clearSelection());

function bindItem(el, item) {
  el.item = item;
  el.tabIndex = 0;
  el.setAttribute('role', 'button');
  el.addEventListener('click', (e) => {
    if (item.watch && (e.ctrlKey || e.shiftKey)) return toggleSelect(el, e.shiftKey);
    clearSelection();
    activate(item);
  });
  el.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.target !== el) return;
    e.preventDefault();
    activate(item);
  });
  el.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const many = el.classList.contains('selected') ? selection() : [];
    if (many.length < 2) clearSelection();
    const r = el.getBoundingClientRect();
    // A keyboard-opened menu has no pointer position.
    openMenu(many.length > 1 ? manyEntries(many) : menuEntries(item), e.clientX || r.left + 48, e.clientY || r.bottom);
  });
  if (item.watch) {
    el.dataset.video = item.watch.videoId;
    if (track && track.videoId === item.watch.videoId) el.classList.add('current');
  }
}

const moreButton = (item) =>
  iconButton('more', ICON_MORE, T.more, (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    openMenu(menuEntries(item), r.left, r.bottom);
  });

// Music videos keep their wide frame instead of a square crop.
const wide = (item) => (item.kind === 'video' ? ' wide' : '');

function row(item) {
  const el = div('item' + wide(item));
  const text = div('text');
  text.append(div('title', item.title), subLine(item));
  el.append(coverOf(item), text, div('extra', item.extra || ''), moreButton(item));
  bindItem(el, item);
  return el;
}

const BULLET = { text: ' • ', browseId: null };

// An edition ("Deluxe Edition") moves from the card's title into the line under it,
// so two releases of one album no longer read the same.
function tile(item) {
  const el = div('tile' + (item.round ? ' round' : '') + wide(item));
  const parts = item.edition ? [{ text: item.edition, browseId: null }, ...(item.parts.length ? [BULLET] : []), ...item.parts] : item.parts;
  el.append(coverOf(item, item.big || item.thumb), div('title', item.edition ? item.base : item.title), subLine(item, parts), moreButton(item));
  bindItem(el, item);
  return el;
}

// Wide tiles on top of home: cover, name and a play button.
function quickTile(item) {
  const el = div('qt');
  const cover = div('cover');
  cover.append(thumb(item.thumb));
  const b = iconButton('cover-play', ICON_PLAY, T.playAll, () => (item.play ? play(item.play) : activate(item)));
  el.append(cover, div('title', item.title), b);
  bindItem(el, item);
  return el;
}

// Rated straight from the row; the page's own like follows when it is the playing track.
function rateButton(item) {
  const b = document.createElement('button');
  b.className = 'rate';
  b.append(svg(ICONS.like), svg(ICONS.liked));
  b.firstChild.classList.add('off');
  b.lastChild.classList.add('on');
  const draw = () => {
    b.setAttribute('aria-pressed', String(item.like === 'LIKE'));
    b.title = T.like;
    b.setAttribute('aria-label', T.like);
  };
  draw();
  b.addEventListener('click', async (e) => {
    e.stopPropagation();
    const status = item.like === 'LIKE' ? 'INDIFFERENT' : 'LIKE';
    const before = item.like;
    item.like = status;
    draw();
    b.classList.remove('pop');
    void b.offsetWidth;
    if (status === 'LIKE') b.classList.add('pop');
    const ok = await api.change({ kind: 'rate', videoId: item.watch.videoId, status }).catch(() => false);
    if (!ok) {
      item.like = before;
      draw();
      return toast(T.actionFailed);
    }
    if (track && track.videoId === item.watch.videoId) refreshControls();
  });
  return b;
}

const eqBars = () => {
  const e = div('eq');
  e.append(document.createElement('i'), document.createElement('i'), document.createElement('i'));
  return e;
};

// "55 Mio. Wiedergaben" -> "55 Mio." where the column head already says what is counted.
const withoutUnit = (text, unit) => (unit && text.endsWith(unit) ? text.slice(0, -unit.length).trim() : text);

// One track of a table; `cols` says which columns the table has.
function tableRow(item, i, cols) {
  const el = div('trow' + (item.thumb ? wide(item) : ''));
  const n = div('n');
  const num = document.createElement('em');
  num.textContent = item.index || String(i + 1);
  n.append(num, svg(ICON_PLAY), eqBars());
  const tt = div('tt');
  const cover = div('cover');
  cover.append(item.thumb ? thumb(item.thumb) : div(''));
  const text = div('text');
  const title = div('title', item.title);
  text.append(title);
  if (cols.albumArtist === undefined) text.append(subLine(item, item.byline));
  else {
    // An album's own artist under every track says nothing; a guest or another artist does.
    el.classList.add('solo');
    const by = (item.byline || []).map((p) => p.text).join('').trim();
    // "(feat. X)" in the title already names the guest.
    const named = !!cols.albumArtist && by.startsWith(cols.albumArtist) && /[([](feat|ft|with|mit)\b/i.test(item.title);
    if (by && by !== cols.albumArtist && !named) text.append(subLine(item, item.byline));
    else if (item.explicit) title.prepend(div('ex', 'E'));
  }
  tt.append(cover, text);
  el.append(n, tt);
  if (cols.extra) el.append(div('col col-extra', withoutUnit(item.extra || '', cols.unit)));
  if (cols.album) {
    const c = div('col col-album');
    if (item.album) c.append(link(item.album.text, (e) => (e.stopPropagation(), openPage(item.album.text, item.album.browseId))));
    el.append(c);
  }
  if (cols.rate) el.append(item.like && item.watch ? rateButton(item) : div(''));
  if (cols.duration) el.append(div('col r', item.duration));
  el.append(moreButton(item));
  // Rows on album pages have no cover; the number says enough there.
  if (!item.thumb) cover.hidden = true;
  bindItem(el, item);
  return el;
}

// Columns a list of tracks needs, from what its rows carry.
// A column needs a third of the rows filled; a few stray values leave it mostly empty.
function tableColumns(items) {
  const has = (k) => items.filter((i) => i[k]).length >= Math.max(1, items.length / 3);
  // The word every count ends in ("Wiedergaben", "Aufrufe") goes to the head once.
  const counts = items.map((i) => i.extra).filter(Boolean);
  const words = counts.map((x) => /^(.*\d.*?)\s+(\p{L}+)$/u.exec(x));
  const unit = words.length && words.every((m) => m && m[2] === words[0][2]) ? words[0][2] : '';
  return { extra: has('extra'), unit, album: has('album'), rate: signedIn === true && has('like'), duration: has('duration') };
}

function tableHead(cols) {
  const h = div('thead');
  h.append(div('n', '#'), div('', T.colTitle));
  if (cols.extra) h.append(div('col col-extra', cols.unit ? cols.unit[0].toUpperCase() + cols.unit.slice(1) : T.colPlays));
  if (cols.album) h.append(div('col col-album', T.colAlbum));
  if (cols.rate) h.append(div(''));
  if (cols.duration) {
    const d = div('r');
    d.append(svg(ICONS.clock));
    h.append(d);
  }
  h.append(div(''));
  return h;
}

function gridColumns(cols) {
  const c = ['32px', 'minmax(0, 4fr)'];
  // Fixed, not max-content: every row is a grid of its own and the columns have to line up.
  if (cols.extra) c.push(cols.unit ? '96px' : '160px');
  if (cols.album) c.push('minmax(0, 2.2fr)');
  if (cols.rate) c.push('32px');
  if (cols.duration) c.push('48px');
  c.push('32px');
  return c.join(' ');
}

// The arrows page a shelf by its visible width and hide when everything fits.
const pagerWatch = new ResizeObserver((entries) => entries.forEach((e) => e.target.updatePagers()));

function pagers(list) {
  const page = (dir) => list.scrollBy({ left: dir * list.clientWidth, behavior: 'smooth' });
  const prev = iconButton('pager', ICON_BACK, T.scrollLeft, () => page(-1));
  const next = iconButton('pager', ICON_OPEN, T.scrollRight, () => page(1));
  list.updatePagers = () => {
    const max = list.scrollWidth - list.clientWidth;
    prev.hidden = next.hidden = max < 2;
    // Edges with more behind them fade out (chip rows).
    list.classList.toggle('fade-l', list.scrollLeft > 2);
    list.classList.toggle('fade-r', list.scrollLeft < max - 2);
    // aria-disabled, not disabled: a disabled button would drop the keyboard focus.
    prev.setAttribute('aria-disabled', String(list.scrollLeft < 2));
    next.setAttribute('aria-disabled', String(list.scrollLeft > max - 2));
  };
  list.addEventListener('scroll', list.updatePagers, { passive: true });
  pagerWatch.observe(list);
  return [prev, next];
}

function shelfHead(title, more) {
  const head = div('shelf-head');
  const h = document.createElement('h2');
  h.className = 'shelf';
  h.textContent = title;
  head.append(h);
  if (more) {
    const a = document.createElement('button');
    a.className = 'see-all';
    a.textContent = T.seeAll;
    a.addEventListener('click', () =>
      go(
        more.query
          ? { title, kind: 'search', query: more.query, load: () => api.search(more.query, more.params) }
          : { title, kind: 'browse', browseId: more.browseId, load: () => api.browse(more.browseId, more.params) }
      )
    );
    head.append(a);
  }
  return head;
}

// "Listen again" on home, which becomes the quick-access tiles.
const LISTEN_AGAIN = /nochmal|noch mal|erneut|again/i;

// Track lists on browse pages become tables; search keeps plain rows, which say what each result is.
function isTable(sec, v) {
  const tracks = sec.items.filter((i) => i.watch && !i.card).length;
  return !sec.items.every((i) => i.card) && !sec.items[0].top && v.kind === 'browse' && tracks >= 2 && tracks >= sec.items.length / 2;
}

// What a section looks like follows what it holds and where it sits.
function renderSection(sec, v, page) {
  const el = document.createElement('section');
  if (sec.items[0].top) return renderTop(sec, el, page);
  const cards = sec.tiles || sec.items.every((i) => i.card);
  if (cards && v.root === 'FEmusic_home' && !v.params && page.sections.find((s) => s.items.every((i) => i.card) && LISTEN_AGAIN.test(s.title)) === sec) {
    sec.make = quickTile;
    sec.list = div('quick');
    sec.list.append(...sec.items.slice(0, 8).map(quickTile));
    el.append(sec.list);
    return el;
  }
  if (isTable(sec, v)) {
    const cols = tableColumns(sec.items);
    // An album's tracks (numbered, no covers of their own) name its artist only where it differs.
    const h = page.header;
    if (h && h.kind === 'list' && h.strap.length && sec.items.every((i) => !i.thumb)) cols.albumArtist = h.strap.map((p) => p.text).join('').trim();
    el.className = 'table';
    el.style.setProperty('--cols', gridColumns(cols));
    el.style.setProperty('--cols-narrow', gridColumns({ ...cols, album: false, extra: false }));
    sec.cols = cols;
    sec.make = (item) => tableRow(item, sec.items.indexOf(item), cols);
    sec.list = div('rows');
    sec.list.append(...sec.items.map(sec.make));
    if (sec.title) el.append(shelfHead(sec.title, sec.more));
    el.append(tableHead(cols), sec.list);
    return el;
  }
  const carousel = cards && !!sec.title;
  sec.make = cards ? tile : row;
  sec.list = div(carousel ? 'tiles' : cards ? 'grid' : 'rows');
  sec.list.append(...sec.items.map(sec.make));
  if (sec.title) {
    const head = shelfHead(sec.title, sec.more);
    if (carousel) head.append(...pagers(sec.list));
    el.append(head);
  }
  el.append(sec.list);
  return el;
}

// Search's top result as a card in its picture's colour, with play and subscribe on it,
// and the tracks YouTube lists under it beside it.
function renderTop(sec, el, page) {
  const [top, ...rest] = sec.items;
  const grid = div('topgrid');
  const left = div('');
  const h = document.createElement('h2');
  h.className = 'shelf';
  h.textContent = T.topResult;
  const card = div('topres');
  const cover = div('cover');
  cover.append(thumb(top.thumb));
  if (top.round) cover.firstChild.classList.add('round');
  const acts = div('top-acts');
  const sub = top.kind === 'artist' && page.subscribe && signedIn !== null ? page.subscribe : null;
  if (sub) acts.append(subscribeButton(sub));
  const playIt = top.play || (top.watch ? { watchEndpoint: top.watch } : null) || top.shuffle || top.radio;
  if (playIt) acts.append(iconButton('bigplay', ICON_PLAY, T.playAll, () => play(playIt, top.watch?.videoId)));
  card.append(cover, div('name', top.title), subLine(top), acts);
  if (top.thumb) {
    const v = view;
    coverColor(top.thumb).then((c) => view === v && (card.style.setProperty('--tint', c), card.classList.add('tinted')), () => {});
  }
  bindItem(card, top);
  left.append(h, card);
  grid.append(left);
  if (rest.length) {
    const right = div('');
    const h2 = document.createElement('h2');
    h2.className = 'shelf';
    h2.textContent = T.songs;
    const list = div('rows');
    list.append(...rest.map(row));
    right.append(h2, list);
    grid.append(right);
  }
  sec.make = row;
  sec.list = null;
  el.append(grid);
  return el;
}

function markCurrent(videoId) {
  for (const el of document.querySelectorAll('.current[data-video]')) el.classList.remove('current');
  if (!videoId) return;
  for (const el of document.querySelectorAll('[data-video="' + videoId + '"]')) el.classList.add('current');
}

// Grey shapes of cards and rows while a page loads.
function skeleton() {
  const box = div('skel');
  const cards = div('sk-cards');
  for (let i = 0; i < 6; i++) {
    const c = div('sk-card');
    c.append(div('sk'), div('sk'));
    cards.append(c);
  }
  box.append(cards);
  for (let i = 0; i < 6; i++) {
    const r = div('sk-row');
    const lines = div('');
    const a = div('sk ln');
    const b = div('sk ln');
    a.style.width = 40 + ((i * 17) % 35) + '%';
    b.style.width = 20 + ((i * 11) % 20) + '%';
    lines.append(a, b);
    r.append(div('sk'), lines);
    box.append(r);
  }
  return box;
}

// Nothing to show: a sentence on why and, where there is one, the next step.
function emptyState(v) {
  const box = div('empty');
  box.append(svg(ICONS.note));
  const b = document.createElement('b');
  b.textContent = T.empty;
  const p = document.createElement('p');
  p.textContent = v.kind === 'search' ? T.emptySearch : T.emptyHint;
  box.append(b, p);
  if (v.kind !== 'search' && v.root !== 'FEmusic_explore') {
    const btn = document.createElement('button');
    btn.textContent = T.goExplore;
    btn.addEventListener('click', () => root('FEmusic_explore', T.explore, 'explore'));
    box.append(btn);
  }
  return box;
}

// The head's colour when the cover has none of its own.
const RED_TINT = '#c4001f';
const NEUTRAL_TINT = '#3a3a3a';
// rgb(r g b) with channels close together: black, white or grey.
function isGrey(rgb) {
  const c = (rgb.match(/\d+/g) || []).map(Number);
  return c.length < 3 || Math.max(...c) - Math.min(...c) < 28;
}

// "About" at the end of an artist's page: photo, listeners and the whole text.
function renderAbout(h) {
  const box = $('about');
  box.hidden = !(h && h.kind === 'artist' && h.description);
  if (box.hidden) return;
  box.querySelector('h2').textContent = T.aboutArtist.replace('{name}', h.title);
  const img = box.querySelector('img');
  if (h.thumb) img.src = h.thumb;
  else img.removeAttribute('src');
  box.querySelector('b').textContent = h.subtitle;
  const p = box.querySelector('p');
  const more = box.querySelector('button');
  p.textContent = h.description;
  p.classList.remove('open');
  more.textContent = T.showMore;
  more.onclick = () => (more.textContent = p.classList.toggle('open') ? T.showLess : T.showMore);
  fitAbout();
}

// "Show more" only while the text runs past its five lines, checked again as the width changes.
function fitAbout() {
  const p = $('about').querySelector('p');
  if (!p.classList.contains('open')) $('about').querySelector('button').hidden = p.scrollHeight <= p.clientHeight + 2;
}
new ResizeObserver(fitAbout).observe($('about').querySelector('p'));

// Head of a playlist, album or artist page.
function renderHero(h) {
  const hero = $('hero');
  hero.hidden = !h;
  main.classList.toggle('has-hero', !!h);
  main.style.removeProperty('--tint');
  renderAbout(h);
  if (!h) return;
  // Lists start in red; an artist's head takes its colour from the photo, a quiet grey until that is read.
  main.style.setProperty('--tint', h.kind === 'artist' ? NEUTRAL_TINT : RED_TINT);
  hero.className = h.kind;
  // The edition sits under the title as a label; the title gets smaller as it gets longer
  // instead of ending in an ellipsis.
  const name = h.base || h.title;
  $('hero-title').textContent = name;
  $('hero-title').dataset.size = name.length <= 14 ? 'l' : name.length <= 30 ? 'm' : 's';
  $('hero-edition').textContent = h.edition || '';
  $('hero-edition').hidden = !h.edition;
  $('hero-desc').textContent = h.description;
  // An artist's text goes to the card at the end of the page, where it can be read in full.
  $('hero-desc').hidden = !h.description || h.kind === 'artist';
  // "Album • 2001": the first part names the kind, the rest goes to the details line.
  const [type, ...rest] = h.subtitle.split(' \u2022 ');
  $('hero-type').textContent = h.kind === 'artist' ? '' : type;
  const meta = $('hero-meta');
  meta.replaceChildren();
  const bits = [];
  // Who made it, with their picture: the album's artist or the playlist's owner.
  if (h.ownerThumb || h.owner || h.strap.length) {
    const who = document.createElement('span');
    who.className = 'who';
    if (h.ownerThumb) {
      const img = document.createElement('img');
      img.alt = '';
      img.src = h.ownerThumb;
      who.append(img);
    }
    if (h.strap.length) who.append(...subLine({}, h.strap).childNodes);
    else if (h.owner) who.append(h.owner);
    bits.push(who);
  }
  if (h.kind === 'artist' ? h.subtitle : rest.length) bits.push(h.kind === 'artist' ? h.subtitle : rest.join(' \u2022 '));
  if (h.second) bits.push(h.second);
  bits.forEach((b, i) => {
    if (i) meta.append(' \u2022 ');
    meta.append(b);
  });
  if (h.kind === 'artist') {
    hero.style.backgroundImage = h.thumb ? 'url("' + h.thumb.replace(/["\\]/g, encodeURIComponent) + '")' : '';
    $('hero-art').removeAttribute('src');
  } else {
    hero.style.backgroundImage = '';
    $('hero-art').src = h.thumb || '';
  }
  const v = view;
  if (h.thumb) {
    // A grey cover, or one served without CORS headers (liked songs), keeps YouTube Music's red.
    // A photo's colour is kept even when muted: red under a grey sky clashes with it.
    coverColor(h.thumb).then(
      (c) => view === v && (h.kind === 'artist' || !isGrey(c)) && main.style.setProperty('--tint', c),
      () => {}
    );
  }
}

async function show(next) {
  if (view) view.scroll = main.scrollTop;
  view = next;
  closeMenu();
  closeSuggest();
  setSlot(null);
  updateArrows();
  for (const b of document.querySelectorAll('.nav-btn[data-browse]')) b.setAttribute('aria-current', String(b.dataset.browse === next.root));
  markLibrary(next);
  $('heading').textContent = next.title;
  $('heading').hidden = false;
  $('actions').hidden = true;
  $('chips').hidden = true;
  // The compact bar and the table head's offset belong to the page being left.
  $('sticky').classList.remove('show');
  main.classList.remove('stuck');
  main.style.setProperty('--sticky-h', '0px');
  renderHero(null);
  renderTabs(next);
  pagerWatch.disconnect();
  status('');
  let page = next.page;
  if (!page) {
    $('list').replaceChildren(skeleton());
    main.scrollTop = 0;
    // A newer attempt at the same view, after the player page came back, wins as well.
    const attempt = (next.attempt = (next.attempt || 0) + 1);
    next.loading = true;
    try {
      page = await next.load();
    } catch (e) {
      if (next.attempt !== attempt) return;
      next.loading = false;
      next.failed = true;
      if (view === next) {
        $('list').replaceChildren();
        fail(e);
      }
      return;
    }
    if (next.attempt !== attempt) return;
    next.loading = next.failed = false;
    // A click elsewhere while this one loaded wins.
    if (view !== next) return;
    if (next.kind === 'search' && !next.params && !next.render) groupSearch(page);
    next.page = page;
  }
  $('inner').classList.remove('fade');
  void $('inner').offsetWidth;
  $('inner').classList.add('fade');
  // Settings and other pages that are not lists draw themselves.
  if (next.render) {
    $('list').replaceChildren();
    next.render(page);
    main.scrollTop = next.scroll || 0;
    return;
  }
  renderHero(page.header);
  $('heading').hidden = !!page.header || (next.root === 'FEmusic_home' && !stack.length);
  renderChips(page.chips || [], next);
  renderActions(page, next);
  $('list').replaceChildren(...page.sections.map((s) => renderSection(s, next, page)));
  if (!page.items.length) $('list').append(emptyState(next));
  arrange();
  main.scrollTop = next.scroll || 0;
  checkMore();
}

// YouTube Music's own params for "shuffle this playlist", as its playlist menus send them.
const SHUFFLE_PARAMS = 'wAEB8gECGAE%3D';
const listOf = (ep) => ep?.watchEndpoint?.playlistId || ep?.watchPlaylistEndpoint?.playlistId || null;

// Play, shuffle, save, subscribe and the page's menu, as buttons under the head.
function renderActions(page, v) {
  // Play and shuffle where the page is a list of its own: a playlist, an album, an artist.
  // The head's own buttons first; a playlist without them (liked songs) gets them built from its id.
  const first = page.items.find((i) => i.watch);
  const h = page.header;
  const listId = listOf(h?.play) || (v.browseId?.startsWith('VL') ? v.browseId.slice(2) : null);
  const playEp = h?.play || (first && { watchEndpoint: listId ? { videoId: first.watch.videoId, playlistId: listId } : first.watch });
  const shuffle =
    h?.shuffle || (page.shuffle && { watchPlaylistEndpoint: page.shuffle }) || (listId && first ? { watchPlaylistEndpoint: { playlistId: listId, params: SHUFFLE_PARAMS } } : null);
  const playable = !!first && !!(h || page.shuffle);
  const lib = page.library && (page.library.saved ? page.library.unsave : page.library.save) ? page.library : null;
  // On search the subscribe button belongs to the top result's card.
  const sub = v.kind !== 'search' && page.subscribe && signedIn !== null ? page.subscribe : null;
  const more = pageEntries(page).length > 0;
  // Find and sort where the page is one list of its own: a playlist, an album, an artist's songs.
  const table = !!page.header && page.items.length > 4 && page.sections.some((s) => isTable(s, v));
  $('play-all').hidden = !playable;
  $('shuffle-all').hidden = !playable || !shuffle;
  $('save-lib').hidden = !lib;
  $('subscribe').hidden = !sub;
  $('page-more').hidden = !more;
  $('list-tools').hidden = !table;
  $('actions').hidden = !playable && !lib && !sub && !more && !table;
  const playFirst = () => playEp && play(playEp, playEp.watchEndpoint?.videoId || first.watch.videoId);
  $('play-all').onclick = $('sticky-play').onclick = playFirst;
  $('sticky-title').textContent = page.header ? page.header.title : v.title;
  $('shuffle-all').onclick = () => play(shuffle);
  if (lib) {
    const draw = () => {
      $('save-lib').setAttribute('aria-pressed', String(lib.saved));
      $('save-lib').title = lib.saved ? T.unsaveLib : T.saveLib;
      $('save-lib').setAttribute('aria-label', $('save-lib').title);
    };
    draw();
    $('save-lib').onclick = async () => {
      if (await change(lib.saved ? lib.unsave : lib.save, lib.saved ? T.unsavedLib : T.savedLib)) {
        lib.saved = !lib.saved;
        draw();
        refreshLibrary();
      }
    };
  }
  if (sub) subscribeButton(sub, $('subscribe'));
  $('page-more').onclick = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    openMenu(pageEntries(page), r.left, r.bottom);
  };
  $('list-tools').classList.toggle('open', !!v.filter);
  $('list-filter').value = v.filter || '';
  $('list-sort').firstChild.textContent = SORTS[v.sort || 'custom'];
}

// Subscribe on a page's own row of buttons, or on search's top result.
function subscribeButton(sub, b = document.createElement('button')) {
  b.classList.add('subscribe');
  const draw = () => {
    b.setAttribute('aria-pressed', String(sub.subscribed));
    b.textContent = sub.subscribed ? T.subscribed : T.subscribe;
  };
  draw();
  b.onclick = async (e) => {
    e.stopPropagation();
    if (!signedIn) return toast(T.signInFirst, { action: [T.signIn, api.signIn] });
    const on = !sub.subscribed;
    if (await change({ kind: 'subscribe', channelId: sub.channelId, on }, on ? T.subscribed : T.unsubscribed)) {
      sub.subscribed = on;
      draw();
    }
  };
  return b;
}

// A wheel over a sideways row moves it sideways while there is more to see that way;
// at either end the page scrolls as usual.
function sideWheel(e) {
  const el = e.currentTarget;
  if (e.ctrlKey || Math.abs(e.deltaX) >= Math.abs(e.deltaY)) return;
  const dy = e.deltaMode === WheelEvent.DOM_DELTA_LINE ? e.deltaY * 40 : e.deltaY;
  const max = el.scrollWidth - el.clientWidth;
  if ((dy > 0 && el.scrollLeft >= max - 1) || (dy < 0 && el.scrollLeft <= 0)) return;
  e.preventDefault();
  e.stopPropagation();
  el.scrollBy({ left: dy, behavior: 'smooth' });
}

// Mood and filter chips on one line; a chip swaps this page for its variant instead of
// stacking a new one. The chosen chip comes first, with a cross that takes it off.
function renderChips(chips, v) {
  const box = $('chips');
  box.hidden = !chips.length;
  const list = div('chip-scroll');
  const order = [...chips.filter((c) => c.selected), ...chips.filter((c) => !c.selected)];
  list.append(
    ...order.map((c) => {
      const b = document.createElement('button');
      b.className = 'chip';
      b.textContent = c.text;
      b.setAttribute('aria-pressed', String(c.selected));
      if (c.selected) {
        b.append(svg(ICONS.close));
        b.title = T.clearFilter;
      }
      b.addEventListener('click', () => {
        const load = c.query ? () => api.search(c.query, c.params) : () => api.browse(c.browseId, c.params);
        show({ ...v, params: c.params || null, page: null, scroll: 0, filter: '', sort: 'custom', attempt: 0, loading: false, loadingMore: false, failed: false, load });
      });
      return b;
    })
  );
  list.addEventListener('wheel', sideWheel, { passive: false });
  box.replaceChildren(list, ...(chips.length ? pagers(list) : []));
}

// Search's plain list mixes every kind of result. Below the top result it becomes
// shelves by kind, each with "show all" on the matching filter chip.
const SEARCH_KINDS = [
  ['song', 'moreSongs', /^(songs?|titel)$/i, false],
  ['video', 'kindVideo', /^videos?$/i, true],
  ['album', 'kindAlbum', /^(alben|albums?)$/i, true],
  ['artist', 'kindArtist', /^(künstler|artists?)$/i, true],
  ['playlist', 'kindPlaylist', /playlists?$/i, true],
  ['podcast', 'kindPodcast', /^podcasts?$/i, true],
  ['episode', 'kindEpisode', /^(folgen|episodes?)$/i, false],
  ['profile', 'kindProfile', /^(profile?|profiles)$/i, true],
];

// "Song • Daft Punk • 3:00" under a heading that already says Songs: the first word goes.
// Albums keep theirs, it tells album, single and EP apart.
function withoutType(item) {
  const p = item.parts;
  return item.kind !== 'album' && p.length > 2 && !p[0].browseId && p[1].text.trim() === '•' ? p.slice(2) : p;
}

function groupSearch(page) {
  const top = page.sections.find((s) => s.items[0].top);
  if (top) {
    const [hit, ...songs] = top.items;
    for (const s of songs) {
      s.parts = withoutType(s);
      // Under an artist YouTube leaves the artist out of the songs; it goes back in.
      if (hit.kind === 'artist' && hit.browseId && !s.parts.some((p) => p.browseId)) {
        s.parts = [{ text: hit.title, browseId: hit.browseId }, ...(s.parts.length ? [BULLET] : []), ...s.parts];
      }
    }
  }
  const loose = page.sections.filter((s) => !s.title && !s.items[0].top);
  const rest = loose.flatMap((s) => s.items);
  if (!rest.length) return;
  const shelves = [];
  for (const [kind, key, chip, tiles] of SEARCH_KINDS) {
    const items = rest.filter((i) => i.kind === kind);
    if (!items.length) continue;
    for (const i of items) i.parts = withoutType(i);
    const c = page.chips.find((x) => chip.test(x.text) && x.query);
    const title = kind === 'song' && !(top && top.items.length > 1) ? T.songs : T[key];
    shelves.push({ title, items, tiles, more: c ? { query: c.query, params: c.params } : null });
  }
  const other = rest.filter((i) => !SEARCH_KINDS.some(([k]) => k === i.kind));
  if (other.length) shelves.push({ title: '', items: other });
  page.sections = [...page.sections.filter((s) => !loose.includes(s)), ...shelves];
}

// Find in list and sort, on the tracks loaded so far.
const SORTS = { custom: T.sortCustom, title: T.sortTitle, artist: T.sortArtist, album: T.sortAlbum, duration: T.sortDuration };
const seconds = (d) => (d || '').split(':').reduce((a, n) => a * 60 + Number(n), 0) || Infinity;
const SORT_KEYS = {
  title: (i) => i.title,
  artist: (i) => (i.byline || []).map((p) => p.text).join(''),
  album: (i) => (i.album ? i.album.text : ''),
  duration: (i) => seconds(i.duration),
};

function arrange() {
  if (!view || !view.page) return;
  const q = (view.filter || '').trim().toLowerCase();
  const key = SORT_KEYS[view.sort];
  for (const sec of view.page.sections) {
    if (!sec.cols || !sec.list) continue;
    const rows = [...sec.list.children];
    for (const r of rows) {
      const i = r.item;
      const hay = [i.title, SORT_KEYS.artist(i), SORT_KEYS.album(i)].join(' ').toLowerCase();
      r.hidden = !!q && !hay.includes(q);
    }
    const order = key
      ? [...rows].sort((a, b) => {
          const x = key(a.item);
          const y = key(b.item);
          return typeof x === 'number' ? x - y : String(x).localeCompare(String(y));
        })
      : rows.sort((a, b) => sec.items.indexOf(a.item) - sec.items.indexOf(b.item));
    sec.list.append(...order);
  }
}

$('list-find').addEventListener('click', () => {
  const tools = $('list-tools');
  tools.classList.toggle('open');
  if (tools.classList.contains('open')) $('list-filter').focus();
  else if (view) {
    view.filter = '';
    $('list-filter').value = '';
    arrange();
  }
});
$('list-filter').addEventListener('input', () => {
  if (!view) return;
  view.filter = $('list-filter').value;
  arrange();
});
$('list-sort').addEventListener('click', (e) => {
  const r = e.currentTarget.getBoundingClientRect();
  openMenu(
    Object.entries(SORTS).map(([k, label]) => ({
      label,
      icon: (view && (view.sort || 'custom') === k) ? ICONS.check : null,
      run: () => {
        view.sort = k;
        $('list-sort').firstChild.textContent = label;
        arrange();
      },
    })),
    r.left,
    r.bottom
  );
});

// The compact head shows once the page's buttons have scrolled out of sight.
new IntersectionObserver(
  (entries) => {
    const e = entries[0];
    const show = !$('actions').hidden && !$('hero').hidden && !e.isIntersecting && e.boundingClientRect.top < e.rootBounds.top + 10;
    $('sticky').classList.toggle('show', show);
    // The table head gets a backdrop only once it sits under the bar; before, the page's colour shows through.
    main.classList.toggle('stuck', show);
    main.style.setProperty('--sticky-h', show ? '64px' : '0px');
  },
  { root: main, threshold: 0 }
).observe($('actions'));

function updateArrows() {
  $('back').setAttribute('aria-disabled', String(!stack.length));
  $('forward').setAttribute('aria-disabled', String(!ahead.length));
}

// ponytail: history keeps the last 50 pages, older ones drop out.
const HISTORY = 50;

function go(next) {
  if (view) stack.push(view);
  if (stack.length > HISTORY) stack.shift();
  ahead.length = 0;
  show(next);
}
// ponytail: pages on the back stack are kept as loaded; a root tab or search always loads fresh.

function goBack() {
  if (!stack.length) return;
  ahead.push(view);
  show(stack.pop());
}

function goForward() {
  if (!ahead.length) return;
  stack.push(view);
  show(ahead.pop());
}

// The parts of the library and of explore, each a browse page of its own.
const TABS = {
  library: [
    ['FEmusic_liked_playlists', 'tabPlaylists'],
    ['FEmusic_liked_videos', 'tabSongs'],
    ['FEmusic_liked_albums', 'tabAlbums'],
    ['FEmusic_library_corpus_track_artists', 'tabArtists'],
    ['FEmusic_library_corpus_artists', 'tabSubs'],
    ['FEmusic_history', 'tabHistory'],
  ],
  explore: [
    ['FEmusic_explore', 'explore'],
    ['FEmusic_new_releases', 'tabNew'],
    ['FEmusic_charts', 'tabCharts'],
  ],
};

function renderTabs(v) {
  const tabs = v.tabs ? TABS[v.tabs] : null;
  $('tabs').hidden = !tabs;
  if (!tabs) return;
  $('tabs').replaceChildren(
    ...tabs.map(([id, key]) => {
      const b = document.createElement('button');
      b.className = 'chip';
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', String(id === v.browseId));
      b.textContent = T[key];
      b.addEventListener('click', () => id !== v.browseId && root(v.root, v.title, v.tabs, id));
      return b;
    })
  );
}

// A navigation entry; `tab` picks one part of a page that has several.
function root(id, title, tabs, tab = id) {
  stack.length = ahead.length = 0;
  try {
    localStorage.setItem('root', JSON.stringify([id, tab]));
  } catch {}
  show({ root: id, title, tabs, browseId: tab, kind: 'browse', load: () => api.browse(tab) });
}

for (const b of document.querySelectorAll('.nav-btn[data-browse]')) {
  b.addEventListener('click', () => root(b.dataset.browse, b.textContent.trim(), b.dataset.tabs));
}

// The app opens on the navigation entry and tab it was left on, home otherwise.
function restoreRoot() {
  let id = 'FEmusic_home';
  let tab = id;
  try {
    [id, tab] = JSON.parse(localStorage.getItem('root')) || [id, tab];
  } catch {}
  if (id === 'VLLM') return root('VLLM', T.liked);
  const b = [...document.querySelectorAll('.nav-btn[data-browse]')].find((n) => n.dataset.browse === id);
  if (!b) return root('FEmusic_home', T.home);
  const tabs = b.dataset.tabs;
  const known = tab === id || (tabs && TABS[tabs].some(([t]) => t === tab));
  root(id, b.textContent.trim(), tabs, known ? tab : id);
}
$('back').addEventListener('click', goBack);
$('forward').addEventListener('click', goForward);
for (const action of ['mini', 'minimize', 'maximize', 'close']) {
  $('win-' + action).addEventListener('click', () => api.window(action));
}
api.onMaximized((on) => document.documentElement.classList.toggle('maximized', !!on));
api.onFullscreen((on) => document.documentElement.classList.toggle('fullscreen', !!on));

// Shown only while signed out; it goes once the page is back with an account.
let signedIn = null;

let accountRetry = 0;
let accountSeq = 0;
// `force`: the player page loaded again, perhaps with another account, so the library reloads too.
async function checkAccount(tries = 0, force = false) {
  const seq = ++accountSeq;
  const was = signedIn;
  const now = await api.signedIn().catch(() => null);
  // An older answer arriving after a newer one does not overwrite it.
  if (seq !== accountSeq) return;
  // Unknown keeps what was known, so buttons do not flicker while the page is busy.
  signedIn = now === null ? was : now;
  // The page may still be busy; ask again a few times instead of leaving the library blank.
  clearTimeout(accountRetry);
  if (now === null && tries < 10) accountRetry = setTimeout(() => checkAccount(tries + 1, force), 2000);
  $('sign-in').hidden = signedIn !== false;
  // Subscribing needs the account, so the page's buttons may only now apply.
  if (view && view.page && !view.render) renderActions(view.page, view);
  if (signedIn !== null && (signedIn !== was || (force && now !== null))) refreshLibrary();
  if (now === null) return;
  const acc = signedIn ? await api.account().catch(() => null) : null;
  if (seq !== accountSeq) return;
  $('account').hidden = !acc;
  if (acc) {
    $('account-img').src = acc.photo || '';
    $('account').account = acc;
  }
}
$('sign-in').addEventListener('click', api.signIn);
$('account').addEventListener('click', (e) => {
  const acc = e.currentTarget.account || {};
  const r = e.currentTarget.getBoundingClientRect();
  openMenu(
    [
      { head: { title: acc.name, sub: acc.handle } },
      { label: T.manageAccount, icon: ICONS.person, run: () => setSlot('page') },
      { label: T.settings, icon: ICONS.settings, run: openSettings },
    ],
    r.right - 260,
    r.bottom + 6
  );
});

// Consent and sign-in pages need the user, so the page shows itself for them.
api.onPlayerAway(() => uiReady && setSlot('page', true));
// Back from such a page, what was on screen loads again, now for the account.
// A view that failed or still waits on the old page does so too.
api.onPlayerReady(() => {
  if (!uiReady) return;
  checkAccount(0, true);
  // A page the user opened stays, even when it reloads.
  const back = slot === 'page' && slotAway;
  if (back) setSlot(null);
  if (!view) return;
  const stale = !view.page && (view.failed || view.loading);
  if (!back && !stale) return;
  view.page = null;
  show(view);
});

// Long lists continue as they scroll into view, like on YouTube Music.
const PRELOAD_PX = 800;

async function loadMore() {
  const v = view;
  const page = v && v.page;
  if (!page || !page.next || v.loadingMore) return;
  v.loadingMore = true;
  const more = await api.more(v.kind, page.next).catch(() => null);
  v.loadingMore = false;
  // On failure the token stays, the next scroll tries again.
  if (!more) return;
  page.next = more.next;
  page.items.push(...more.items);
  for (const sec of more.sections) {
    const last = page.sections[page.sections.length - 1];
    // Untitled continuation rows belong to the list they continue.
    if (!sec.title && last && !last.title) {
      last.items.push(...sec.items);
      if (view === v && last.list) last.list.append(...sec.items.map(last.make));
    } else {
      page.sections.push(sec);
      if (view === v) $('list').append(renderSection(sec, v, page));
    }
  }
  if (view === v) {
    arrange();
    checkMore();
  }
}

// The observer only reports changes, so a page that still ends inside the
// viewport after an append is checked once more by hand.
function checkMore() {
  requestAnimationFrame(() => {
    const r = $('more').getBoundingClientRect();
    if (r.top < main.getBoundingClientRect().bottom + PRELOAD_PX) loadMore();
  });
}

new IntersectionObserver((entries) => entries[0].isIntersecting && loadMore(), {
  root: main,
  rootMargin: PRELOAD_PX + 'px',
}).observe($('more'));

// Context menu

function nameOf(item, browseId) {
  const p = (item.parts || []).find((x) => x.browseId === browseId);
  return p ? p.text : item.subtitle || item.title;
}

// Library changes all go through one call; `done` is the toast on success.
async function change(c, done, extra) {
  const ok = await api.change(c).catch(() => false);
  toast(ok ? done : T.actionFailed, ok ? extra : undefined);
  // Pages kept for Back and Forward may show what just changed; they load fresh instead.
  if (ok) for (const s of [...stack, ...ahead]) s.page = null;
  return ok;
}

function copyLink(item) {
  const url = item.watch ? 'https://music.youtube.com/watch?v=' + item.watch.videoId : 'https://music.youtube.com/browse/' + item.browseId;
  navigator.clipboard.writeText(url).then(() => toast(T.linkCopied), fail);
}

// Save to a playlist from a submenu: a new one, then the account's own.
function playlistMenu(videoIds, art) {
  if (signedIn === false) return { label: T.addPlaylist, icon: ICONS.add, run: () => saveToPlaylist(videoIds) };
  return {
    label: T.addPlaylist,
    icon: ICONS.add,
    sub: async () => {
      const lists = await api.playlists(videoIds[0]).catch(() => null);
      const out = [
        {
          label: T.newPlaylist,
          icon: ICONS.plus,
          run: async () => {
            const title = await ask(T.newPlaylist, '');
            if (title && (await change({ kind: 'create', title, videoIds }, T.savedTo + title, { art }))) refreshLibrary();
          },
        },
      ];
      if (!lists) return out;
      out.push('-');
      for (const p of lists) {
        out.push({
          label: p.title,
          image: p.thumb || '',
          run: () =>
            change({ kind: 'add', playlistId: p.playlistId, videoIds }, T.savedTo + p.title, {
              art,
              action: [T.open, () => openPage(p.title, 'VL' + p.playlistId)],
            }),
        });
      }
      return out;
    },
  };
}

// `here`: the track is already playing or queued, so playing it again would rebuild the queue.
function menuEntries(item) {
  const out = [];
  const add = (label, run, icon) => out.push({ label, run, icon });
  if (item.watch && !item.here) add(T.playAll, () => activate(item), ICONS.play);
  else if (!item.watch) {
    add(T.open, () => activate(item), ICONS.open);
    if (item.play) add(T.playAll, () => play(item.play), ICONS.play);
  }
  if (item.shuffle) add(T.shuffle, () => play(item.shuffle), ICONS.shuffle);
  if (item.radio) add(T.radio, () => play(item.radio), ICONS.radio);
  if (item.queue) {
    add(T.playNext, () => queueAdd(item.queue, 'INSERT_AFTER_CURRENT_VIDEO', T.addedNext, item.thumb), ICONS.next);
    add(T.addQueue, () => queueAdd(item.queue, 'INSERT_AT_END', T.addedQueue, item.thumb), ICONS.queue);
  }
  if (out.length) out.push('-');
  if (item.watch) out.push(playlistMenu([item.watch.videoId], item.thumb));
  const lib = item.library;
  if (lib && (lib.saved ? lib.unsave : lib.save)) {
    add(lib.saved ? T.unsaveLib : T.saveLib, async () => {
      if (await change(lib.saved ? lib.unsave : lib.save, lib.saved ? T.unsavedLib : T.savedLib)) {
        lib.saved = !lib.saved;
        refreshLibrary();
      }
    }, lib.saved ? ICONS.saved : ICONS.save);
  }
  if (item.remove) add(T.removeFromPl, () => removeFromPlaylist([item]), ICONS.remove);
  if (item.notInterested && signedIn) add(T.notInterested, () => change(item.notInterested, T.lessOften), ICONS.block);
  if (out[out.length - 1] !== '-') out.push('-');
  if (item.artistId && item.artistId !== item.browseId) add(T.goArtist, () => openPage(nameOf(item, item.artistId), item.artistId), ICONS.artist);
  if (item.albumId && item.albumId !== item.browseId) add(T.goAlbum, () => openPage(nameOf(item, item.albumId), item.albumId), ICONS.album);
  add(T.copyLink, () => copyLink(item), ICONS.link);
  return out;
}

// Several selected tracks.
function manyEntries(items) {
  const videoIds = items.map((i) => i.watch.videoId);
  const out = [
    { label: T.playNext, icon: ICONS.next, run: () => queueAdd({ videoIds }, 'INSERT_AFTER_CURRENT_VIDEO', T.addedNext) },
    { label: T.addQueue, icon: ICONS.queue, run: () => queueAdd({ videoIds }, 'INSERT_AT_END', T.addedQueue) },
    playlistMenu(videoIds, items[0].thumb),
  ];
  if (items.every((i) => i.remove)) out.push({ label: T.removeFromPl, icon: ICONS.remove, run: () => removeFromPlaylist(items) });
  return out;
}

// The page's own menu: editing a playlist of the account's own. Save and subscribe are buttons.
function pageEntries(page) {
  const out = [];
  const h = page.header;
  if (h?.radio) out.push({ label: T.radio, icon: ICONS.radio, run: () => play(h.radio) });
  if (h?.queue) {
    out.push({ label: T.playNext, icon: ICONS.next, run: () => queueAdd(h.queue, 'INSERT_AFTER_CURRENT_VIDEO', T.addedNext, h.thumb) });
    out.push({ label: T.addQueue, icon: ICONS.queue, run: () => queueAdd(h.queue, 'INSERT_AT_END', T.addedQueue, h.thumb) });
  }
  if (h && view?.browseId) out.push({ label: T.copyLink, icon: ICONS.link, run: () => copyLink({ browseId: view.browseId }) });
  const own = page.own;
  if (own) out.push('-');
  if (!own) return out;
  out.push({ label: T.rename, icon: ICONS.edit, run: () => renamePlaylist(own) });
  for (const privacy of ['PRIVATE', 'UNLISTED', 'PUBLIC']) {
    if (privacy === own.privacy) continue;
    out.push({
      label: T['priv' + privacy],
      icon: ICONS.lock,
      run: async () => {
        if (await change({ kind: 'privacy', playlistId: own.playlistId, privacy }, T.changed)) own.privacy = privacy;
      },
    });
  }
  out.push('-', { label: T.deletePl, icon: ICONS.remove, run: () => deletePlaylist(own) });
  return out;
}

// Each waits on YouTube; a page left in the meantime is not touched.
async function removeFromPlaylist(items) {
  const v = view;
  const rows = items.map((i) => i.remove);
  if (!(await change({ kind: 'remove', playlistId: rows[0].playlistId, rows }, T.removedFromPl))) return;
  v.page = null;
  if (view === v) show(v);
}

async function renamePlaylist(own) {
  const v = view;
  const title = await ask(T.rename, v.page?.header?.title || v.title);
  if (!title || !(await change({ kind: 'rename', playlistId: own.playlistId, title }, T.changed))) return;
  v.title = title;
  if (view === v) $('heading').textContent = $('hero-title').textContent = $('sticky-title').textContent = title;
  refreshLibrary();
}

async function deletePlaylist(own) {
  const v = view;
  if (!confirm(T.deleteAsk) || !(await change({ kind: 'delete', playlistId: own.playlistId }, T.deleted)) || view !== v) return;
  refreshLibrary();
  if (stack.length) show(stack.pop());
  else restoreRoot();
}

// A one-line text prompt; resolves to the trimmed text, or null when cancelled.
function ask(title, value) {
  const d = $('ask-dialog');
  if (d.open) return Promise.resolve(null);
  $('ask-title').textContent = title;
  $('ask-input').value = value;
  d.returnValue = '';
  d.showModal();
  return new Promise((ok) => d.addEventListener('close', () => ok(d.returnValue === 'ok' ? $('ask-input').value.trim() : null), { once: true }));
}

// Menus: entries are {label, run, icon, key} or {label, sub} for a submenu, '-' a line, {head} a title block.
let menuFocus = null;

function menuButton(e, menu) {
  const b = document.createElement('button');
  b.setAttribute('role', 'menuitem');
  if (e.image !== undefined) b.append(e.image ? thumb(e.image) : playlistCover(''));
  else b.append(e.icon ? svg(e.icon) : svg(''));
  const label = document.createElement('span');
  label.textContent = e.label;
  b.append(label);
  if (e.key) {
    const k = document.createElement('kbd');
    k.textContent = e.key;
    b.append(k);
  }
  if (e.sub) {
    b.append(svg(ICONS.chevron));
    b.setAttribute('aria-haspopup', 'menu');
    const open = () => openSub(b, e.sub);
    b.addEventListener('click', open);
    b.addEventListener('pointerenter', () => {
      clearTimeout(subTimer);
      subTimer = setTimeout(open, 180);
    });
    b.addEventListener('pointerleave', () => clearTimeout(subTimer));
    b.openSub = () => openSub(b, e.sub, true);
  } else {
    b.addEventListener('click', () => {
      closeMenu();
      e.run();
    });
    // Moving onto a plain entry closes a submenu opened from a sibling.
    if (menu === $('menu')) b.addEventListener('pointerenter', closeSub);
  }
  return b;
}

function fillMenu(m, entries) {
  m.replaceChildren(
    ...entries
      .filter((e, i, all) => !(e === '-' && (i === 0 || i === all.length - 1 || all[i - 1] === '-')))
      .map((e) => {
        if (e === '-') return document.createElement('hr');
        if (e.head) {
          const h = div('head');
          const b = document.createElement('b');
          b.textContent = e.head.title || '';
          h.append(b, e.head.sub || '');
          return h;
        }
        return menuButton(e, m);
      })
  );
}

function place(m, x, y) {
  const r = m.getBoundingClientRect();
  m.style.left = Math.max(8, Math.min(x, innerWidth - r.width - 8)) + 'px';
  m.style.top = Math.max(8, Math.min(y, innerHeight - r.height - 8)) + 'px';
}

function openMenu(entries, x, y) {
  const m = $('menu');
  closeSub();
  if (m.hidden) menuFocus = document.activeElement;
  fillMenu(m, entries);
  m.hidden = false;
  place(m, x, y);
  m.querySelector('button')?.focus();
}

let subSeq = 0;
let subTimer = 0;
// `focus`: opened from the keyboard, so the first entry takes the focus once loaded.
async function openSub(from, load, focus = false) {
  if ($('menu').hidden || !from.isConnected) return;
  const seq = ++subSeq;
  const s = $('submenu');
  for (const b of $('menu').querySelectorAll('button.open')) b.classList.remove('open');
  from.classList.add('open');
  fillMenu(s, [{ label: T.loading, icon: null, run: () => {} }]);
  s.hidden = false;
  const r = from.getBoundingClientRect();
  const fit = () => {
    const w = s.getBoundingClientRect().width;
    place(s, r.right + w + 4 > innerWidth ? r.left - w - 4 : r.right + 4, r.top - 6);
  };
  fit();
  const entries = await load();
  if (seq !== subSeq || s.hidden) return;
  const hadFocus = focus || s.contains(document.activeElement);
  fillMenu(s, entries);
  fit();
  if (hadFocus) s.querySelector('button')?.focus();
}

function closeSub() {
  subSeq++;
  clearTimeout(subTimer);
  $('submenu').hidden = true;
  for (const b of $('menu').querySelectorAll('button.open')) b.classList.remove('open');
}

function closeMenu() {
  const m = $('menu');
  closeSub();
  if (m.hidden) return;
  m.hidden = true;
  if (menuFocus && document.activeElement && m.contains(document.activeElement)) menuFocus.focus();
}

document.addEventListener('pointerdown', (e) => !$('menu').contains(e.target) && !$('submenu').contains(e.target) && closeMenu(), true);
// Capture, so a shelf scrolling sideways closes it too.
main.addEventListener('scroll', closeMenu, { passive: true, capture: true });
window.addEventListener('blur', closeMenu);
for (const m of [$('menu'), $('submenu')]) {
  m.addEventListener('keydown', (e) => {
    const items = [...m.querySelectorAll('button')];
    const i = items.indexOf(document.activeElement);
    // Arrows stay inside the menu, so they neither seek the track nor scroll the page.
    e.stopPropagation();
    if (e.key === 'Tab') return closeMenu();
    if (!items.length) return;
    if (e.key === 'Escape') m === $('submenu') ? (closeSub(), $('menu').querySelector('button.open, button')?.focus()) : closeMenu();
    else if (e.key === 'ArrowDown') items[(i + 1) % items.length].focus();
    else if (e.key === 'ArrowUp') items[(i - 1 + items.length) % items.length].focus();
    else if (e.key === 'ArrowRight' && document.activeElement?.openSub) document.activeElement.openSub();
    else if (e.key === 'ArrowLeft' && m === $('submenu')) {
      closeSub();
      $('menu').querySelector('button[aria-haspopup]')?.focus();
    } else return;
    e.preventDefault();
  });
}

async function queueAdd(target, position, done, art = '') {
  try {
    const n = await api.queueAdd(target, position);
    // -1: nothing was playing, so the target simply started. 0: YouTube sent nothing to add.
    if (n > 0) toast(done, { art, action: [T.show, () => toggleQueue(true, 'queue')] });
    else if (n === 0) toast(T.queueFailed);
    // The queue tab and the now tab's up-next row both show it.
    if (n && !$('queue').hidden && panelTab !== 'lyrics') loadQueue();
  } catch {
    toast(T.queueFailed);
  }
}

// Save to playlist, in a native modal dialog.

const ICON_LIST = 'M15 6H3v2h12zm0 4H3v2h12zM3 16h8v-2H3zM17 6v8.18c-.31-.11-.65-.18-1-.18-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3V8h3V6z';

function playlistCover(url) {
  if (url) return thumb(url);
  const box = document.createElement('span');
  box.className = 'pl-icon';
  box.append(svg(ICON_LIST));
  return box;
}

async function saveToPlaylist(videoIds) {
  if (!videoIds.length) return;
  const d = $('pl-dialog');
  $('pl-list').replaceChildren();
  $('pl-status').textContent = T.loading;
  $('pl-create').hidden = signedIn === false;
  $('pl-create').onclick = async () => {
    d.close();
    const title = await ask(T.newPlaylist, '');
    if (title && (await change({ kind: 'create', title, videoIds }, T.savedTo + title))) refreshLibrary();
  };
  d.showModal();
  const lists = await api.playlists(videoIds[0]).catch(() => null);
  if (!d.open) return;
  // Signed out, YouTube refuses the request; that is the sign-in hint, not a failure.
  if (!lists || (!lists.length && signedIn === false)) return ($('pl-status').textContent = signedIn === false ? T.noPlaylists : T.actionFailed);
  $('pl-status').textContent = '';
  $('pl-list').append(
    ...lists.map((p) => {
      const b = document.createElement('button');
      const text = div('text');
      text.append(div('title', p.title));
      if (p.subtitle) text.append(div('sub', p.subtitle));
      b.append(playlistCover(p.thumb), text);
      b.addEventListener('click', () => {
        d.close();
        change({ kind: 'add', playlistId: p.playlistId, videoIds }, T.savedTo + p.title, { action: [T.open, () => openPage(p.title, 'VL' + p.playlistId)] });
      });
      return b;
    })
  );
}
$('pl-cancel').addEventListener('click', () => $('pl-dialog').close());
