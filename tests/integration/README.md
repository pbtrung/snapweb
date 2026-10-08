# Integration tests

These tests talk to a real Snapserver over its JSON-RPC control API and the
audio stream endpoint. They are skipped unless `SNAPSERVER_URL` is set:

```sh
SNAPSERVER_URL=ws://10.10.1.1:1780 npm run test:integration
```

They change live server state, so they:

- restore every setting they change (client volume, mute, name and latency,
  group mute and stream), wait for the restore to arrive even when the test
  fails, and verify it with a fresh `Server.GetStatus` when it passes
- pick offline clients and groups first, so nothing audible changes when an
  offline one exists
- never delete or regroup existing clients, or send playback commands
- register one temporary client (`snapweb-integration-*`) for the audio stream
  handshake, and delete only that client afterwards

Stream switching is skipped on servers with a single stream.

For a server that requires a login, also set `SNAPSERVER_USER` and
`SNAPSERVER_PASSWORD`. The tests then log in when the server asks, and
`auth.test.ts` checks the login itself: a wrong password is refused, the
status loads after logging in, the token (or, on servers without
`Server.GetToken`, the Basic login) works on a new connection, and an invalid
token asks for a login again. These are skipped without a user name:

```sh
SNAPSERVER_URL=ws://10.10.1.1:1780 SNAPSERVER_USER=admin SNAPSERVER_PASSWORD=secret npm run test:integration
```
