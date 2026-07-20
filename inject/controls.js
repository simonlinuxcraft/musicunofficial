(() => {
  if (window.__ytmControls) return 'already mounted';
  window.__ytmControls = true;

  // No innerHTML anywhere: YouTube enforces Trusted Types, which rejects
  // string-to-markup assignment. Icons come from CSS masks instead.
  function button(kind, action) {
    const b = document.createElement('button');
    b.className = 'ytm-winctl ytm-winctl-' + kind;
    b.tabIndex = -1;
    b.addEventListener('click', action);
    return b;
  }

  function mount() {
    // Fall back to body: the consent page, the login flow and the offline error
    // page have no nav bar, and without this a frameless window has no close
    // button there at all. The host is position:fixed, so body works fine.
    const bar = document.querySelector('ytmusic-nav-bar #right-content') || document.body;
    if (!bar || bar.querySelector('.ytm-winctl-host')) return false;

    const host = document.createElement('div');
    host.className = 'ytm-winctl-host';
    host.appendChild(button('minimize', () => window.windowControls.minimize()));
    host.appendChild(button('maximize', () => window.windowControls.toggleMaximize()));
    host.appendChild(button('close', () => window.windowControls.close()));
    bar.appendChild(host);
    return true;
  }

  // The nav bar is rendered by Polymer after first paint AND gets rebuilt on
  // SPA navigation. The observer has to stay armed even when the first mount
  // succeeds, otherwise the buttons vanish on the next rebuild.
  mount();
  new MutationObserver(() => mount()).observe(document.documentElement, {
    childList: true,
    subtree: true,
  });

  // The class lives on <html>, not on the button: Polymer rebuilds the nav bar
  // and with it the button, but the root element survives, so the glyph stays
  // correct without re-applying it on every mount.
  if (window.windowControls && window.windowControls.onMaximized) {
    window.windowControls.onMaximized((value) => {
      document.documentElement.classList.toggle('ytm-maximized', !!value);
    });
  }
  return 'ok';
})();
