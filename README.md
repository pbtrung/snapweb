# Snapweb

Web client for [Snapcast](https://github.com/snapcast/snapcast), optimized for
mobile devices, with the look and feel of
[Snapdroid](https://github.com/snapcast/snapdroid)

## Develop

Requires Node.js 22.22.2+, 24.15+ or 26+ (see `engines` in `package.json`).

1. Point the dev server at your snapserver (the default is the page's own
   host). This is only the default: a host entered in Settings takes over.
    ```bash
    echo 'VITE_APP_SNAPSERVER_HOST = localhost:1780' > .env.local
    ```
1. Install dependencies
    ```bash
    npm ci
    ```
1. Run local web server and watcher
    ```bash
    npm run dev
    ```

### Test

- Unit and component tests (Vitest, jsdom): `npm test`
- With a coverage report in `coverage/`: `npm run test:coverage`
- Integration tests against a real Snapserver. They change and restore live
  server state, see [tests/integration/README.md](tests/integration/README.md):
    ```bash
    SNAPSERVER_URL=ws://<snapserver host>:1780 npm run test:integration
    ```

### Code style

- Format with Prettier: `npm run format` (`npm run format:check` only checks)
- Lint with ESLint: `npm run lint`

## Install a release

Releases are published as `snapweb-vX.Y.Z.zip` on
[GitHub](https://github.com/pbtrung/snapweb/releases). `update-snapweb.sh`
downloads one and installs it into `./snapweb`. The release is unpacked next
to the installed one and swapped in with two renames, so the web server never
serves a half-extracted tree; between the renames the directory is briefly
missing, and should the swap fail the previous release is put back. Updates
of the same directory run one at a time:

```bash
./update-snapweb.sh            # the latest release
./update-snapweb.sh v0.99.1    # a specific tag
FORCE=1 ./update-snapweb.sh    # reinstall even if up to date
SNAPWEB_DIR=/usr/share/snapserver/snapweb ./update-snapweb.sh
```

It needs `curl` or `wget`, and `unzip`. Point the `[http] doc_root` in your
`snapserver.conf` at the install directory.

## Build for production

1. Install dependencies: `npm ci`
1. Build: `npm run build`
1. Copy the created `dist` directory to some path on your snapserver host and
   let the `[http] doc_root` in your `snapserver.conf` point to it
1. Restart `snapserver` and navigate with a browser to
   `http://<snapserver host>:1780`
1. Enjoy :)

Plain HTTP is fine without a login. With one, or for the full WebApp, serve
Snapweb over HTTPS, see below.

The app name and version come from `package.json`; bump `version` there
before tagging a release.

## HTTPS

Over `http://` Snapweb talks to Snapserver over unencrypted WebSockets
(`ws://`), where anyone on the network can read a login: the user name and
password (`Server.Authenticate` and `Server.GetToken`) and the token after
them. The login dialog warns about this for any host other than this device.
Over `https://` Snapweb uses `wss://` instead.

Use Snapserver's own HTTPS support where it has one, or put a reverse proxy
with a certificate in front of it. The proxy must pass on the WebSocket
upgrades for both `/jsonrpc` (control) and `/stream` (audio), e.g. with nginx:

```nginx
location / {
    proxy_pass http://127.0.0.1:1780;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
}
```

## Login

When Snapserver requires authentication for its control API, Snapweb asks for
a user name and password and logs in with them (`Server.Authenticate`). The
audio stream needs no login, so playback works either way. Use HTTPS for it,
see above.

- Snapweb then asks the server for a login token (`Server.GetToken`). When it
  gets one it keeps only the token, never the password. How long a token stays
  valid is up to the server; Snapweb finds out it expired when it next logs in
  with it, on a reconnect, and then asks for the login again.
- With **Remember me** the token is stored in the browser and survives
  restarts. Without it, it is kept for the browser tab only.
- Servers without `Server.GetToken` can't issue tokens, so Snapweb keeps the
  user name and password in memory instead (Base64 encoded for HTTP Basic
  authentication, which is not encryption) and logs in with them again on
  every reconnect. They are never stored, so the login lasts until the page is
  closed or reloaded.
- A token or login is only ever sent to the server that accepted it.
- **Log out** in Settings forgets the login, including a stored token.
  Changing the Snapserver host forgets it too.

If the login dialog was cancelled, the "Login required" notice opens it
again.

## Setup as WebApp

Snapweb is a progressive web app: served over HTTPS (see above), it installs
with its own icon and window, and its service worker caches the app so it
starts quickly and updates itself in the background. On Android open
`https://<snapweb host>` in Chrome and select `Add to Home screen` or
`Install app` in the menu.

Browsers only run service workers on secure origins (HTTPS, or `localhost`).
Over plain `http://<snapserver host>:1780` Chrome can still add a home screen
shortcut, but it opens a normal browser tab without the caching and updates.
