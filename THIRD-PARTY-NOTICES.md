# Third party notices

This project ships third party components inside its release artifacts. Their
licence terms are reproduced or referenced below.

## AppImage type2-runtime

Every AppImage produced by this project embeds `vendor/runtime-x86_64`, the
AppImage type 2 runtime. `scripts/swap-runtime.js` puts it in front of the
squashfs payload, replacing the older runtime that electron-builder embeds by
default. The replacement is what allows the AppImage to start on distributions
that no longer ship `libfuse2`.

The binary is redistributed **unmodified**, exactly as published upstream.

| | |
|---|---|
| Project | https://github.com/AppImage/type2-runtime |
| Upstream commit | https://github.com/AppImage/type2-runtime/commit/75849dc |
| Downloaded from | https://github.com/AppImage/type2-runtime/releases/download/continuous/runtime-x86_64 |
| File | `vendor/runtime-x86_64` (944632 bytes) |
| SHA256 | `1cc49bcf1e2ccd593c379adb17c9f85a36d619088296504de95b1d06215aebbf` |

The runtime carries the following notice, reproduced verbatim from the binary:

```
License:
  This executable contains code from
  * runtime, licensed under the terms of
    https://github.com/AppImage/type2-runtime/blob/main/LICENSE
  * musl libc, licensed under the terms of
    https://git.musl-libc.org/cgit/musl/tree/COPYRIGHT
  * libfuse, licensed under the terms of
    https://github.com/libfuse/libfuse/blob/master/LGPL2.txt
  * squashfuse, licensed under the terms of
    https://github.com/vasi/squashfuse/blob/master/LICENSE
  * libzstd, licensed under the terms of
    https://github.com/facebook/zstd/blob/dev/LICENSE
  * zlib, licensed under the terms of
    https://zlib.net/zlib_license.html
Please see https://github.com/AppImage/type2-runtime
for information on how to obtain and build the source code
```

### Source code

libfuse is licensed under LGPL-2.1 and is statically linked into the runtime.
The complete corresponding source for the runtime and every library it contains
is published at https://github.com/AppImage/type2-runtime, at the commit listed
above, together with the build instructions needed to reproduce the binary.

Anyone who receives this application may obtain that source from the upstream
project. Because the binary is redistributed unmodified, no patches are held
back here.

## Electron and Chromium

Release artifacts bundle Electron, which in turn bundles Chromium and its
dependencies. electron-builder generates `LICENSES.chromium.html` inside the
packaged application; that file must not be stripped from any build or package
of this project.

| | |
|---|---|
| Electron | https://github.com/electron/electron/blob/main/LICENSE (MIT) |
| Chromium and dependencies | `LICENSES.chromium.html` inside the packaged app |
