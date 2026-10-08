# Snapweb

Web client for [Snapcast](https://github.com/snapcast/snapcast), optimized for
mobile devices, with the look and feel of
[Snapdroid](https://github.com/snapcast/snapdroid)

## Develop

Requires Node.js 22.22.2+, 24.15+ or 26+ (see `engines` in `package.json`).

1. Point the dev server at your snapserver (the default is the page's own
   host). This is only the default: a host entered in Settings takes over
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
downloads one and installs it into `./snapweb`, replacing the previous
version in one step:

```bash
./update-snapweb.sh            # the latest release
./update-snapweb.sh v0.999.1   # a specific tag
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

The app name and version come from `package.json`; bump `version` there
before tagging a release.

## Login

When Snapserver requires authentication for its control API, Snapweb asks for
a user name and password and logs in with them (`Server.Authenticate`). The
audio stream needs no login, so playback works either way.

- Snapweb then asks the server for a login token (`Server.GetToken`) and keeps
  only the token, never the password. The token is valid for 24 hours; once it
  expires Snapweb asks for the login again.
- With **Remember me** the token is stored in the browser and survives
  restarts. Without it, it is kept for the browser tab only.
- Servers without `Server.GetToken` get the login again on every reconnect
  from memory, so it lasts until the page is closed or reloaded.
- **Log out** in Settings forgets the login, including a stored token.
  Changing the Snapserver host forgets it too.

If the login dialog was cancelled, the "Login required" notice opens it
again.

## Setup as WebApp

On Android open `http://<snapserver host>:1780` in Chrome and select in the menu
`Add to homescreen`
