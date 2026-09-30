import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SnapControl } from '../../src/snapcontrol';
import { allClients, connect, fetchStatus, pickClient, pickGroup, serverUrl, waitFor } from './helpers';

// Every test restores what it changes. Clients and groups are picked offline
// first, and nothing is ever deleted, regrouped or sent playback commands.
describe.skipIf(!serverUrl)('SnapControl against ' + (serverUrl || 'a real Snapserver'), () => {
  // actor makes the changes, observer checks the notifications arrive
  let actor: SnapControl;
  let observer: SnapControl;

  beforeAll(async () => {
    actor = await connect();
    observer = await connect();
  });

  afterAll(() => {
    actor?.disconnect();
    observer?.disconnect();
  });

  describe('status', () => {
    it('loads the server, groups, clients and streams', () => {
      const server = actor.server;
      expect(server.server.snapserver.name).toBe('Snapserver');
      expect(server.server.snapserver.controlProtocolVersion).toBeGreaterThanOrEqual(1);
      expect(server.groups.length).toBeGreaterThan(0);
      expect(server.streams.length).toBeGreaterThan(0);
    });

    it('has consistent references between groups, clients and streams', () => {
      const server = actor.server;
      for (const group of server.groups) {
        expect(group.id).not.toBe('');
        expect(server.getStream(group.stream_id)).not.toBeNull();
        for (const client of group.clients) {
          expect(actor.getGroupFromClient(client.id)).toBe(group);
          expect(client.getName()).not.toBe('');
          expect(client.config.volume.percent).toBeGreaterThanOrEqual(0);
          expect(client.config.volume.percent).toBeLessThanOrEqual(100);
        }
      }
    });

    it('computes group volumes in range', () => {
      for (const group of actor.server.groups) {
        const volume = actor.getGroupVolume(group, false);
        expect(volume).toBeGreaterThanOrEqual(0);
        expect(volume).toBeLessThanOrEqual(100);
      }
    });
  });

  describe('client', () => {
    it('sets the volume and mute, and restores them', async () => {
      const client = pickClient(actor.server);
      const original = { ...client.config.volume };
      const percent = original.percent >= 50 ? original.percent - 17 : original.percent + 17;

      try {
        actor.setVolume(client.id, percent, !original.muted);
        await waitFor(() => {
          const seen = observer.getClient(client.id).config.volume;
          return seen.percent === percent && seen.muted === !original.muted;
        }, 'Client.OnVolumeChanged');
        expect((await fetchStatus()).getClient(client.id)!.config.volume).toEqual({ muted: !original.muted, percent: percent });
      } finally {
        actor.setVolume(client.id, original.percent, original.muted);
      }

      await waitFor(() => observer.getClient(client.id).config.volume.percent === original.percent, 'the volume to be restored');
      expect((await fetchStatus()).getClient(client.id)!.config.volume).toEqual(original);
    });

    it('sets a non-ASCII name, and restores it', async () => {
      const client = pickClient(actor.server);
      const original = client.config.name;
      const name = 'Küche ⚡ integration test';

      try {
        actor.setClientName(client.id, name);
        await waitFor(() => observer.getClient(client.id).config.name === name, 'Client.OnNameChanged');
        expect((await fetchStatus()).getClient(client.id)!.getName()).toBe(name);
      } finally {
        // setClientName skips names equal to the displayed one, so send the
        // original even if it is empty
        actor.getClient(client.id).config.name = name;
        actor.setClientName(client.id, original);
      }

      await waitFor(() => observer.getClient(client.id).config.name === original, 'the name to be restored');
      expect((await fetchStatus()).getClient(client.id)!.config.name).toBe(original);
    });

    it('sets the latency, and restores it', async () => {
      const client = pickClient(actor.server);
      const original = client.config.latency;
      const latency = original + 25;

      try {
        actor.setClientLatency(client.id, latency);
        // Client.OnLatencyChanged doesn't trigger onChange, but updates the model
        await waitFor(() => observer.getClient(client.id).config.latency === latency, 'Client.OnLatencyChanged');
        expect((await fetchStatus()).getClient(client.id)!.config.latency).toBe(latency);
      } finally {
        actor.setClientLatency(client.id, original);
      }

      await waitFor(() => observer.getClient(client.id).config.latency === original, 'the latency to be restored');
      expect((await fetchStatus()).getClient(client.id)!.config.latency).toBe(original);
    });
  });

  describe('group', () => {
    it('mutes and restores', async () => {
      const group = pickGroup(actor.server);
      const original = group.muted;

      try {
        actor.muteGroup(group.id, !original);
        await waitFor(() => observer.getGroup(group.id).muted === !original, 'Group.OnMute');
        expect((await fetchStatus()).getGroup(group.id)!.muted).toBe(!original);
      } finally {
        actor.muteGroup(group.id, original);
      }

      await waitFor(() => observer.getGroup(group.id).muted === original, 'the mute state to be restored');
      expect((await fetchStatus()).getGroup(group.id)!.muted).toBe(original);
    });

    it('switches the stream and restores it', async (context) => {
      if (actor.server.streams.length < 2)
        context.skip('needs a server with at least two streams');
      const group = pickGroup(actor.server);
      const original = group.stream_id;
      const other = actor.server.streams.find(stream => stream.id !== original)!.id;

      try {
        actor.setStream(group.id, other);
        await waitFor(() => observer.getGroup(group.id).stream_id === other, 'Group.OnStreamChanged');
        expect((await fetchStatus()).getGroup(group.id)!.stream_id).toBe(other);
      } finally {
        actor.setStream(group.id, original);
      }

      await waitFor(() => observer.getGroup(group.id).stream_id === original, 'the stream to be restored');
    });
  });

  describe('connection', () => {
    it('reports connect and disconnect', async () => {
      const control = new SnapControl();
      const states: boolean[] = [];
      control.onConnectionChanged = (_control, connected) => { states.push(connected); };
      control.connect(serverUrl);
      await waitFor(() => states.includes(true), 'the connection');
      control.disconnect();

      expect(states.slice(-1)[0]).toBe(false);
    });

    it('keeps every client when reloading the status', async () => {
      const before = allClients(actor.server).map(client => client.id).sort();
      const after = allClients(await fetchStatus()).map(client => client.id).sort();
      expect(after).toEqual(before);
    });
  });
});
