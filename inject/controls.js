(() => {
  if (window.__ytmControls) return 'already mounted';
  window.__ytmControls = true;

  // No innerHTML: YouTube enforces Trusted Types. The glyphs are CSS masks.
  function button(kind, label, action) {
    const b = document.createElement('button');
    b.className = 'ytm-winctl ytm-winctl-' + kind;
    b.title = label;
    b.tabIndex = -1;
    b.addEventListener('click', action);
    return b;
  }

  const host = document.createElement('div');
  host.className = 'ytm-winctl-host';
  host.append(
    button('mini', 'Mini player (Ctrl+M)', () => window.windowControls.openMini()),
    button('minimize', 'Minimise', () => window.windowControls.minimize()),
    button('maximize', 'Maximise', () => window.windowControls.toggleMaximize()),
    button('close', 'Close', () => window.windowControls.close())
  );
  // On <html>, which Polymer never rebuilds, so it is mounted once and needs no
  // MutationObserver. Also covers the consent, login and error pages.
  document.documentElement.append(host);

  // Consent and login pages are light, where the white glyphs would vanish.
  document.documentElement.classList.toggle('ytm-light', location.hostname !== 'music.youtube.com');

  // On <html> as well, so the glyph survives whatever the page does to its own nodes.
  window.windowControls.onMaximized((value) => {
    document.documentElement.classList.toggle('ytm-maximized', !!value);
  });
  return 'ok';
})();
