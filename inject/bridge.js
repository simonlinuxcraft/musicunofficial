// The page side of src/page.js. Each call runs this whole file in the YouTube
// Music page and calls one of its functions with the page's <ytmusic-app> and
// JSON arguments, so nothing stays behind in the page. No semicolon at the end:
// src/page.js uses the file as an expression.
// ponytail: internals of the page (control classes, the queue element and its store); they break when YouTube renames them.
(() => {
  const BAR = 'ytmusic-player-bar';
  const MINI = 'ytmusic-app-layout > ytmusic-miniplayer';
  const $ = (sel) => document.querySelector(sel);
  const press = (sel) => $(sel).click();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  // By class, not aria label: the labels follow the UI language.
  const SHUFFLE = `${BAR} .shuffle, ${MINI} .ytmusicPlayerControlsShuffleButton button, ytmusic-player-controls .shuffle`;
  const REPEAT = `${BAR} .repeat, ${MINI} .ytmusicPlayerControlsRepeatButton button, ytmusic-player-controls .repeat`;
  const queueEl = () => $('ytmusic-player-queue');
  const queueState = () => queueEl().queue.store.getState().queue;
  const runs = (x) => (x?.runs || []).map((r) => r.text).join('');

  const ACTIONS = {
    shuffle: () => press(SHUFFLE),
    repeat: () => press(REPEAT),
    mute: () => press(`${BAR} .volume, ${MINI} .ytMusicMiniPlayerMuteButton button`),
    like: () => press(`${BAR} #like-button-renderer button, ${MINI} like-button-view-model button`),
    dislike: () =>
      (document.querySelectorAll(`${BAR} #like-button-renderer button`)[1] || $(`${MINI} dislike-button-view-model button`)).click(),
    // The classic bar's slider takes the value on change, the redesigned one on input.
    volume: (v) => {
      const s = $(`${BAR} #volume-slider, ${MINI} .ytSliderShapeVerticalSlider`);
      s.value = v;
      if (s.tagName === 'INPUT') s.dispatchEvent(new Event('input', { bubbles: true }));
      s.dispatchEvent(new CustomEvent('change', { bubbles: true, composed: true }));
    },
    // MPRIS sets a state rather than toggling; the bar only toggles, so click until it matches.
    repeatTo: async (mode) => {
      for (let i = 0; i < 3 && queueState().repeatMode !== mode; i++) {
        press(REPEAT);
        await sleep(120);
      }
    },
    shuffleTo: (on) => {
      if (!!queueState().shuffleEnabled !== on) press(SHUFFLE);
    },
    avSong: () => press('ytmusic-av-toggle .song-button'),
    avVideo: () => press('ytmusic-av-toggle .video-button'),
    // Only YouTube's own skip button, which it shows once an ad may be skipped.
    skipAd: () => {
      const b = $('.ytp-skip-ad-button, .ytp-ad-skip-button-modern, .ytp-ad-skip-button');
      if (b) b.click();
    },
  };

  // Rows as the page shows them. A track with a music video sits in a wrapper with
  // both versions, and the one not chosen by the song/video switch is under [hidden].
  const rows = () =>
    [...document.querySelectorAll('ytmusic-player-queue ytmusic-player-queue-item')].filter(
      (el) => !el.closest('ytmusic-playlist-panel-video-wrapper-renderer > [hidden]')
    );
  // The row's place in the reorderable list, -1 for autoplay suggestions.
  const top = (el) => {
    const row = el.closest('#contents > *');
    return row ? [...row.parentElement.children].indexOf(row) : -1;
  };
  // Store index of the playing track. After a shuffle the store keeps the previous
  // track's index (and selected flag) until the next track, so the player decides.
  const current = () => {
    const p = $('#movie_player');
    const id = p?.getVideoData ? p.getVideoData().video_id : '';
    const sel = queueState().selectedItemIndex;
    const tops = rows()
      .filter((el) => el.data && el.data.videoId === id)
      .map(top);
    return tops.length && !tops.includes(sel) ? tops[0] : sel;
  };

  return {
    // The page's own network manager signs the request for the logged-in account.
    fetch: (app, endpoint, body) => app.networkManager.fetch(endpoint, body),

    // The SPA's own navigation event: switches track in place and builds the queue, no reload.
    navigate: (app, endpoint) => {
      app.dispatchEvent(new CustomEvent('yt-navigate', { bubbles: true, composed: true, detail: { endpoint } }));
    },

    signedIn: () => ytcfg.get('LOGGED_IN'),

    control: async (app, action, value) => {
      await ACTIONS[action](value);
    },

    // Artist and album links under the title; the redesigned bar has no hrefs, the playing queue entry has the endpoints.
    nowLinks: () => {
      // The classic layout has a second bar in its player page; one is enough.
      const bar = $(BAR);
      const a = bar ? [...bar.querySelectorAll('.byline a')] : [];
      if (a.length) return a.map((x) => ({ text: x.textContent, href: x.getAttribute('href') }));
      const it = queueState().items[current()] || {};
      const r = it.playlistPanelVideoRenderer || it.playlistPanelVideoWrapperRenderer?.primaryRenderer.playlistPanelVideoRenderer || {};
      return (r.longBylineText?.runs || [])
        .filter((x) => x.navigationEndpoint?.browseEndpoint)
        .map((x) => ({ text: x.text, href: 'browse/' + x.navigationEndpoint.browseEndpoint.browseId }));
    },

    // The queue as the page renders it; long queues load further rows as they play.
    // `itemId` is the id the queue removes a row by. The rows' own selected attribute
    // can stay on tracks played before, so the playing row comes from current().
    queue: () => {
      const sel = current();
      return rows().map((el) => {
        const d = el.data || {};
        const th = d.thumbnail?.thumbnails || [];
        const pic = th.find((x) => x.width >= 96) || th[th.length - 1];
        const t = top(el);
        const w = d.navigationEndpoint?.watchEndpoint;
        return {
          videoId: d.videoId,
          title: runs(d.title),
          artist: runs(d.shortBylineText || d.longBylineText),
          length: runs(d.lengthText),
          thumb: pic ? pic.url : '',
          selected: t >= 0 ? t === sel : el.hasAttribute('selected'),
          top: t,
          itemId: w ? w.index : null,
        };
      });
    },

    // The row's own play button jumps inside the current queue and keeps its order,
    // which a fresh navigation to the track would rebuild.
    queuePlay: (app, index, id) => {
      const list = rows();
      let row = list[index];
      if (!row || !row.data || row.data.videoId !== id) row = list.find((r) => r.data && r.data.videoId === id);
      if (row) row.querySelector('#play-button').click();
    },

    // The queue's own removal, which also skips on if it is the current track and
    // keeps YouTube's server-side copy of the queue in step.
    queueRemove: async (app, itemId) => {
      await queueEl().queue.removeItem(String(itemId));
    },

    // What the page's drag and drop does: move the row in the list, then let the
    // queue's drop handler read the new order and pass it on to the server.
    queueMove: (app, from, to) => {
      const qel = queueEl();
      const list = [...qel.querySelectorAll('#contents > *')];
      if (!list[from] || !list[to] || from === to) return false;
      const node = list[from];
      node.parentElement.insertBefore(node, from < to ? list[to].nextSibling : list[to]);
      qel.onDrop({ detail: { dragEl: node } });
      return true;
    },

    // "Play next" and "add to queue". The page's own command for this only shows a
    // toast in a hidden window and leaves the queue as it was, so the items are
    // fetched the way the page does and put into its queue store directly.
    // -1 while the queue is empty, otherwise how many items went in.
    queueAdd: async (app, target, position) => {
      const q = queueEl();
      const st = q.queue.store.getState().queue;
      if (!st.items.length) return -1;
      const res = await app.networkManager.fetch('/music/get_queue', {
        queueContextParams: st.queueContextParams,
        queueInsertPosition: position,
        ...(target.videoIds ? { videoIds: target.videoIds } : target.videoId ? { videoIds: [target.videoId] } : { playlistId: target.playlistId }),
      });
      const items = (res?.queueDatas || []).map((d) => d.content).filter(Boolean);
      if (!items.length) return 0;
      const now = q.queue.store.getState().queue;
      const sel = now.items.length ? current() : -1;
      const index = position === 'INSERT_AFTER_CURRENT_VIDEO' && sel >= 0 ? sel + 1 : now.items.length;
      q.dispatch({
        type: 'ADD_ITEMS',
        payload: { nextQueueItemId: now.nextQueueItemId, index, items, shuffleEnabled: false, shouldAssignIds: true },
      });
      return items.length;
    },

    // The player stores it (yt-player-quality, about a year) only once a track plays or pauses.
    setQuality: async (app, q) => {
      const p = $('#movie_player');
      for (let i = 0; i < 50 && ![1, 2].includes(p.getPlayerState()); i++) await sleep(200);
      p.setPlaybackQualityRange(q, q);
    },
  };
})()
