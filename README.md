# Snapweb

Web client for [Snapcast](https://github.com/snapcast/snapcast), optimized for
mobile devices, with the look and feel of
[Snapdroid](https://github.com/snapcast/snapdroid)

## Develop

Requires Node.js 20.19+ or 22.12+.

1. Add your snapserver host as a local environment var
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

## Build for production

1. Install dependencies: `npm ci`
1. Build: `npm run build`
1. Copy the created `dist` directory to some path on your snapserver host and
   let the `[http] doc_root` in your `snapserver.conf` point to it
1. Restart `snapserver` and navigate with a browser to
   `http://<snapserver host>:1780`
1. Enjoy :)

Prebuilt versions of upstream Snapweb can be downloaded as zip archive or
debian package in [Releases](https://github.com/snapcast/snapweb/releases).

## Setup as WebApp

On Android open `http://<snapserver host>:1780` in Chrome and select in the menu
`Add to homescreen`
