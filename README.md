<div align="center">

<img src="icon.png" width="128" alt="MusicUnofficial">

# MusicUnofficial

**An unofficial desktop wrapper for the YouTube Music player on Linux.**

</div>

---

## Please read first

> **This is not an official YouTube or Google product.**
>
> This project is **not affiliated with, endorsed by, sponsored by, or connected
> to Google LLC or YouTube** in any way. It is an independent, unofficial
> third-party application.
>
> YouTube, YouTube Music and the YouTube logo are trademarks of Google LLC. They
> are referenced here only to describe what this application is for.
>
> The application does not host, store, distribute or modify any music or video
> content. It loads the public YouTube Music website in a browser window, exactly
> as any web browser would. Your account, your subscription and everything you
> play remain entirely between you and YouTube. Advertising is displayed as
> served, nothing is blocked or bypassed.
>
> **For anything concerning your account, your subscription, billing or content
> availability, contact YouTube support. This project cannot help with those and
> has no access to them.**

---

## What it is

A thin desktop shell around `music.youtube.com`. It exists so that music does not
have to live in a browser tab: it gets its own window, its own icon, a tray
entry, and it answers to the media keys on your keyboard like a native player.

It deliberately does not try to be a music suite. There are no plugins, no
themes, no downloader, no ad blocker and no telemetry. Fewer moving parts means
fewer things that break when YouTube changes its site.

## Features

| | |
|---|---|
| Own window | Frameless, with window controls placed in the page's own navigation bar |
| Media keys | Play, pause and skip work through MPRIS, including the GNOME media widget and the lock screen |
| Tray | Closing the window keeps playback running; quit from the tray or with `Ctrl+Q` |
| Remembers itself | Window size, position and maximised state are restored on the next start |
| Stays signed in | The profile survives updates, so an update does not sign you out |
| Runs anywhere | No `libfuse2` required, works on distributions that stopped shipping it |
| No dependencies | Zero runtime dependencies beyond Electron itself |

## Keyboard shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl` `Q` | Quit |
| `Ctrl` `R` | Reload the page |
| `Ctrl` `+` / `Ctrl` `-` | Zoom in and out |
| `Ctrl` `0` | Reset zoom |

Media keys are handled by the desktop through MPRIS and need no configuration.

## Install

Download the AppImage from the releases page, then:

```bash
chmod +x MusicUnofficial-*.AppImage
./MusicUnofficial-*.AppImage
```

To get a menu entry and a proper icon, place the AppImage somewhere permanent
such as `~/Applications` and integrate it with your usual AppImage tool, or
create a desktop entry with `StartupWMClass=musicunofficial` so the panel can
match the running window to it.

### Requirements

Linux x86_64, glibc 2.25 or newer, which covers every current distribution. A
tray icon requires a status area; on plain GNOME that means the AppIndicator
extension. Without it the application still runs and closing the window quits
normally.

## Build from source

```bash
npm install
npm test
npm run build-appimage
```

The build swaps in the AppImage type2-runtime so the result starts on systems
without `libfuse2`. Icons are generated from a single source file:

```bash
npm run icons
```

Edit `assets/symbol.svg` and run the command to regenerate the application icon,
the tray icon and the mark in the navigation bar.

## Licence

Source code is MIT, see [LICENSE](LICENSE).

Release artifacts bundle Electron, Chromium and the AppImage runtime under their
own terms, listed in [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
