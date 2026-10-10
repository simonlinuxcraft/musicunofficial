const fs = require('fs');
const path = require('path');

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'linux') return;

  const dir = context.appOutDir;
  const exeName = context.packager.executableName;
  const realPath = path.join(dir, exeName);
  const binPath = path.join(dir, exeName + '.bin');

  if (fs.existsSync(binPath)) return;
  if (!fs.existsSync(realPath)) return;

  fs.renameSync(realPath, binPath);

  const wrapper = `#!/bin/bash
DIR="$(dirname "$(readlink -f "$0")")"

# Snap-Terminals (z.B. alacritty als Snap) vererben GIO_MODULE_DIR auf einen
# Pfad, der hier nicht existiert. Unset, damit glib-basierte Nebenpfade nicht
# auf GDummyTlsBackend zurueckfallen. Chromium selbst ist davon unabhaengig.
# Laeuft die App SELBST als Snap, zeigt die Variable auf den Snap-eigenen
# Modulpfad und muss stehen bleiben, sonst faellt genau dort TLS aus.
[ -z "$SNAP" ] && unset GIO_MODULE_DIR

# Nativ Wayland statt XWayland: XWayland meldet bei Monitoren mit hoher
# Bildrate eine falsche Rate (gemessen 20,08 Hz an 320-Hz-Panels), Chromium
# zeichnet dann nur 20 Bilder/s. Preis: unter GNOME-Wayland setzt die App
# keine Fensterpositionen und kein "immer im Vordergrund" (Mini-Player).
# Switch muss VOR Electron-Init am argv stehen, deshalb hier im Wrapper.
WL_ARGS=()
if [ -n "$WAYLAND_DISPLAY" ] && [ "$XDG_SESSION_TYPE" = "wayland" ]; then
  WL_ARGS=(--ozone-platform=wayland)
fi

case " $* " in
  *" --no-sandbox "*) exec "$DIR/${exeName}.bin" "\${WL_ARGS[@]}" "$@" ;;
  *) exec "$DIR/${exeName}.bin" --no-sandbox "\${WL_ARGS[@]}" "$@" ;;
esac
`;

  fs.writeFileSync(realPath, wrapper, { mode: 0o755 });
};
