# Snapweb changelog

## Version 0.999

### Bugfixes

- Fix audio cutting out after the audio clock stalls (context suspended,
  output device stall or change): sync the server time against the
  performance clock, map audio time to it with getOutputTimestamp(), and
  resync at once on a clock jump instead of playing out of sync for tens of
  seconds and then dropping about a second of audio
- Restart playback when it falls behind after the main thread stalls,
  instead of playing out of sync from then on
- Fix the audio stream lifecycle: stop() cancels a pending reconnect, codec
  headers no longer start overlapping playback chains, and AudioContexts and
  decoders are released instead of leaking
- Fix a hard sync that padded over half a buffer silencing the whole buffer,
  and follow output latency changes (e.g. switching to Bluetooth)
- Fix Opus streams below 48 kHz playing at the wrong speed, 32 bit Opus
  overflowing and the first Opus frames being dropped; recover the FLAC
  decoder after a failed decode
- Fix sockets replaced while connecting staying open and reporting a false
  "connected", and requests throwing while reconnecting
- Keep the control connection alive through proxies and tunnels that close
  idle WebSockets, and keep playback running when it reconnects
- Normalize the server url ("host:1780", "http://...", trailing slashes) and
  survive blocked or full browser storage
- Fix NaN group volumes when dragging from 0 or 100, deleted clients
  reappearing during undo, a rejected play() leaving the player stuck, and
  the settings dialog keeping cancelled edits
- Fix the PWA icons and theme colour in the manifest

### Features

- Show the stream duration and file path in the group card
- Name controls after their group or client for screen readers
- Log the codec, sample format, metadata, connection state and audio clock
  jumps to the console, and log dropped chunks once per sync instead of once
  per chunk

### General

- Move index.html into src/
- Type-check the Vite and Vitest configs in the build
- Declare the required Node.js version (22.22.2+, 24.15+ or 26+)

### Contributors

- @pbtrung

_Trung Pham <pbtrung@outlook.com>  Mon, 05 Oct 2026 09:00:04 -0700_

## Version 0.9999

### Bugfixes

- Fix time sync median, which sorted clock offsets as strings (PR #165)
- Fix audio playing about 6 dB too quiet, fix non-ASCII names being
  truncated in stream messages, fix a color scheme listener leaking on every
  render, fix NaN group volume for empty groups (PR #166)
- Fix audio sync: measure the server time on the clock buffers are scheduled
  on, so the output latency is no longer counted twice, which made Snapweb
  play ahead of other clients
- Fix startup sync: ignore time replies measured on the previous clock, sync
  with a burst of requests and play silence until synced instead of dropping
  chunks
- Fix swapped sent/received timestamps when reading message headers
- Ignore messages from the previous server after switching servers, and don't
  drop a batch of notifications because one refers to an unknown client
- Fix React hooks issues: state and props mutated during render, callbacks
  reassigned on every render, setState in effects
- Don't start playback when stopped before the audio code finished loading

### Features

- Load the audio stream and decoders on first playback, and split the
  bundle into cacheable vendor chunks (initial load 1.1 MB -> about 560 kB)

### General

- Update packages: MUI 9, Vite 8, ESLint 10, TypeScript 6
- Switch to @vitejs/plugin-react, replace the deprecated glob 11
- Add unit, component and Snapserver integration tests (Vitest)
- Add Prettier and format the codebase
- Remove CI workflow, dependabot, Debian packaging and devcontainer setup
- Remove README screenshots and the Contributing section

### Contributors

- @pbtrung
- @xn101de

_Trung Pham <pbtrung@outlook.com>  Wed, 30 Sep 2026 13:58:45 -0700_

## Version 0.9.3

### Bugfixes

- Fix CI build

### General

- Update packages
- Update URLs to snapcast org

### Contributors

- @badaix

_Johannes Pohl <snapweb@badaix.de>  Mon, 15 Dec 2025 00:13:37 +0200_

## Version 0.9.2

### Bugfixes

- Fix type error

### General

- Update packages

### Contributors

- @badaix

_Johannes Pohl <snapweb@badaix.de>  Thu, 02 Oct 2025 00:13:37 +0200_

## Version 0.9.1

### Bugfixes

- Fix About dialog

### General

- Update packages

### Contributors

- @badaix

_Johannes Pohl <snapweb@badaix.de>  Sun, 03 Aug 2025 00:13:37 +0200_

## Version 0.9.0

### Features

- Add opus support (Issue #8, PR #129)

### General

- Update packages, fix deprecations

### Contributors

- @chicco-carone
- @badaix

_Johannes Pohl <snapweb@badaix.de>  Sat, 07 Jun 2025 00:13:37 +0200_

## Version 0.8.0

### Features

- Support 24 and 32 bit samples
- Build with relative base URL (PR #84)

### Bugfixes

### General

- Improve audio latency (PR #93)

### Contributors

- @mawe42
- @mgoltzsche

_Johannes Pohl <snapweb@badaix.de>  Tue, 06 Aug 2024 00:13:37 +0200_

## Version 0.7.0

### Features

- Configurable Snapserver host
- Apply dark or light theme depending on the system theme
- Show client name in Client settings
- PWA ready

### Bugfixes

- Fix several ESLint issues
- Fix Chrome DevTools issues
- Fix Debian package compatibility for prior Bullseye (Issue #73)

### General

- Switch from the deprecated Create React App (CRA) to Vite
- Disable spell checking in text fields

_Johannes Pohl <snapweb@badaix.de>  Thu, 21 Mar 2024 00:13:37 +0200_

## Version 0.6.0

### Features

- Dark mode (Issue #38)
- Show track title, artist and album art
- Stream control: Play, pause, previous, next
- Support for showing disconnected devices (Issue #7)
- Show license and version information (Issue #15)
- Improved iOS playback (Issue #18, PR #45)

### Bugfixes

- HTML input is sanitized (Issue #36)

### General

- Rewrite of the GUI with React

### Contributors

- @curiousercreative 

_Johannes Pohl <snapweb@badaix.de>  Sat, 24 Feb 2024 00:13:37 +0200_

## Version 0.5.0

### Features

- Show list of artists

### Bugfixes

- Fix version in Hello message

### General

_Johannes Pohl <snapweb@badaix.de>  Sun, 05 Feb 2023 00:13:37 +0200_

## Version 0.4.0

### Features

- Add support for MediaSession

### Bugfixes

- Fix compilation with Typescript 4.4

### General

_Johannes Pohl <snapweb@badaix.de>  Wed, 22 Dec 2021 00:13:37 +0200_

## Version 0.3.0

### Features

- Recreate AudioContext if the stream changes

### Bugfixes

### General

_Johannes Pohl <snapweb@badaix.de>  Sat, 15 May 2021 00:13:37 +0200_

## Version 0.2.0

### Features

- Initial playback support on iOS (PR #18)

### Bugfixes

- Fix support for older browsers (PR #28)

### General

- Add version information as meta tag (not yet visible in the GUI) (PR #15)

_Johannes Pohl <snapweb@badaix.de>  Tue, 02 Mar 2021 00:13:37 +0200_

## Version 0.1.0

- Added deleteClient method (PR #4)

### Features

- Make URL base configurable (PR #20)
- Allow use of (https) reverse proxies by default (PR #25)
- Auto play when stream becomes available if URL hash contains 'autoplay' (PR #12)

### Bugfixes

- Fixed issue #21 (PR #22)
- Fix fallback code and increase compatibility with older browsers (PR #13)

### General

- Prefer localStorage over complicated cookie-based key-value store (PR #11)
- Auto-reconnect WebSockets if connection is lost (PR #23)
- Misc code improvements (PR #24)
- Turn on more tsc strictness options (PR #26)

_Johannes Pohl <snapweb@badaix.de>  Mon, 22 Feb 2021 00:13:37 +0200_

