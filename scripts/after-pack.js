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

# A terminal running as a snap passes on its GIO_MODULE_DIR (and $SNAP), and glib
# falls back to GDummyTlsBackend. The deb never runs inside a snap.
unset GIO_MODULE_DIR

# Native Wayland: XWayland reports a wrong refresh rate on high refresh panels
# (20.08 Hz on 320 Hz) and Chromium draws at it. The cost: on GNOME Wayland no
# window positions and no always-on-top for the mini player. Must be on argv before Electron starts.
WL_ARGS=()
if [ -n "$WAYLAND_DISPLAY" ] && [ "$XDG_SESSION_TYPE" = "wayland" ]; then
  WL_ARGS=(--ozone-platform=wayland)
fi

# The deb's AppArmor profile allows user namespaces, and where the kernel has none
# its postinst makes chrome-sandbox setuid. Only with neither would Chromium abort.
SB_ARGS=()
[ -u "$DIR/chrome-sandbox" ] || unshare -Ur true 2>/dev/null || SB_ARGS=(--no-sandbox)

exec "$DIR/${exeName}.bin" "\${SB_ARGS[@]}" "\${WL_ARGS[@]}" "$@"
`;

  fs.writeFileSync(realPath, wrapper, { mode: 0o755 });
};
