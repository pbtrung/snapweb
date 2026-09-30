# Integration tests

These tests talk to a real Snapserver over its JSON-RPC control API and the
audio stream endpoint. They are skipped unless `SNAPSERVER_URL` is set:

```sh
SNAPSERVER_URL=ws://10.10.1.1:1780 npm run test:integration
```

They change live server state, so they:

- restore every setting they change (client volume, mute, name and latency,
  group mute and stream) and verify the restore with a fresh `Server.GetStatus`
- pick offline clients and groups first, so nothing audible changes when an
  offline one exists
- never delete or regroup existing clients, or send playback commands
- register one temporary client (`snapweb-integration-*`) for the audio stream
  handshake, and delete only that client afterwards

Stream switching is skipped on servers with a single stream.
