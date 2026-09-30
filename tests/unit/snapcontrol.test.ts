import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { SnapControl, Snapcast } from '../../src/snapcontrol';
import { FakeWebSocket } from '../helpers/fakeWebSocket';
import { quietConsole } from '../helpers/snapControl';
import { makeClient, makeServerStatus, makeStream } from '../fixtures/serverStatus';

describe('Snapcast model', () => {
  it('parses a full server status', () => {
    const server = new Snapcast.Server(makeServerStatus());

    expect(server.groups.map((g) => g.id)).toEqual(['g1', 'g2']);
    expect(server.streams.map((s) => s.id)).toEqual(['s1', 's2']);
    expect(server.server.snapserver.version).toBe('0.30.0');
    expect(server.server.host.name).toBe('snapserver');

    const g2 = server.getGroup('g2')!;
    expect(g2.muted).toBe(true);
    expect(g2.name).toBe('Office');
    expect(g2.stream_id).toBe('s2');
  });

  it('starts empty without json', () => {
    const server = new Snapcast.Server();
    expect(server.groups).toEqual([]);
    expect(server.streams).toEqual([]);
  });

  it('looks up clients, groups and streams by id', () => {
    const server = new Snapcast.Server(makeServerStatus());

    expect(server.getClient('c3')!.config.volume.percent).toBe(20);
    expect(server.getGroup('g1')!.getClient('c2')!.id).toBe('c2');
    expect(server.getStream('s1')!.status).toBe('playing');

    expect(server.getClient('nope')).toBeNull();
    expect(server.getGroup('nope')).toBeNull();
    expect(server.getStream('nope')).toBeNull();
    expect(server.getGroup('g1')!.getClient('c3')).toBeNull();
  });

  it('parses client details', () => {
    const client = new Snapcast.Client(
      makeClient('x', { name: 'Named', latency: 25, muted: true, percent: 33, connected: false }),
    );

    expect(client.config).toEqual({ instance: 1, latency: 25, name: 'Named', volume: { muted: true, percent: 33 } });
    expect(client.connected).toBe(false);
    expect(client.host.ip).toBe('192.0.2.10');
    expect(client.snapclient.version).toBe('0.30.0');
    expect(client.lastSeen).toEqual({ sec: 1700000000, usec: 0 });
  });

  it('uses the configured name, falling back to the host name', () => {
    expect(new Snapcast.Client(makeClient('a', { name: 'Kitchen' })).getName()).toBe('Kitchen');
    expect(new Snapcast.Client(makeClient('b', { hostName: 'pi' })).getName()).toBe('pi');
  });

  it('parses stream properties and metadata', () => {
    const stream = new Snapcast.Stream(makeServerStatus().streams[0]);

    expect(stream.uri.scheme).toBe('pipe');
    expect(stream.properties.canControl).toBe(true);
    expect(stream.properties.canGoPrevious).toBe(false);
    expect(stream.properties.playbackStatus).toBe('playing');
    expect(stream.properties.metadata!.artist).toEqual(['Artist A', 'Artist B']);
    expect(stream.properties.metadata!.duration).toBe(180);
  });

  it('defaults stream properties when the server sends none', () => {
    const stream = new Snapcast.Stream(makeStream('bare'));

    expect(stream.properties.canControl).toBe(false);
    expect(stream.properties.canPlay).toBe(false);
    expect(stream.properties.metadata).toBeUndefined();
  });

  it('replaces groups and streams when re-parsed', () => {
    const server = new Snapcast.Server(makeServerStatus());
    const status = makeServerStatus();
    status.groups.pop();
    status.streams.pop();
    server.fromJson(status);

    expect(server.groups).toHaveLength(1);
    expect(server.streams).toHaveLength(1);
  });
});

describe('SnapControl', () => {
  let control: SnapControl;
  let onChange: Mock<NonNullable<SnapControl['onChange']>>;
  let onConnectionChanged: Mock<NonNullable<SnapControl['onConnectionChanged']>>;

  function connected(status = makeServerStatus()): FakeWebSocket {
    control.connect('ws://snapserver:1780');
    const ws = FakeWebSocket.latest();
    ws.open();
    const request = ws.lastSent();
    ws.receive({ id: request.id, jsonrpc: '2.0', result: { server: status } });
    onChange.mockClear();
    onConnectionChanged.mockClear();
    return ws;
  }

  beforeEach(() => {
    FakeWebSocket.reset();
    vi.stubGlobal('WebSocket', FakeWebSocket);
    quietConsole({ errors: true });
    control = new SnapControl();
    onChange = vi.fn<NonNullable<SnapControl['onChange']>>();
    onConnectionChanged = vi.fn<NonNullable<SnapControl['onConnectionChanged']>>();
    control.onChange = onChange;
    control.onConnectionChanged = onConnectionChanged;
  });

  afterEach(() => {
    control.disconnect();
    vi.useRealTimers();
  });

  describe('connection', () => {
    it('connects to the jsonrpc endpoint and requests the status on open', () => {
      control.connect('ws://snapserver:1780');
      const ws = FakeWebSocket.latest();
      expect(ws.url).toBe('ws://snapserver:1780/jsonrpc');

      ws.open();
      expect(ws.lastSent()).toEqual({ id: 1, jsonrpc: '2.0', method: 'Server.GetStatus' });
      expect(onConnectionChanged).toHaveBeenLastCalledWith(control, true);
    });

    it('loads the server from the status response and notifies', () => {
      control.connect('ws://snapserver:1780');
      const ws = FakeWebSocket.latest();
      ws.open();
      ws.receive({ id: ws.lastSent().id, jsonrpc: '2.0', result: { server: makeServerStatus() } });

      expect(control.server.groups).toHaveLength(2);
      expect(onChange).toHaveBeenCalledWith(control, control.server);
    });

    it('ignores responses to other requests', () => {
      const ws = connected();
      ws.receive({ id: 999, jsonrpc: '2.0', result: { volume: { muted: false, percent: 1 } } });

      expect(onChange).not.toHaveBeenCalled();
    });

    it('reconnects one second after the connection drops', () => {
      vi.useFakeTimers();
      control.connect('ws://snapserver:1780');
      const ws = FakeWebSocket.latest();
      ws.open();
      ws.drop();

      expect(onConnectionChanged).toHaveBeenLastCalledWith(control, false, 'Connection lost, trying to reconnect.');
      expect(FakeWebSocket.instances).toHaveLength(1);
      vi.advanceTimersByTime(1000);
      expect(FakeWebSocket.instances).toHaveLength(2);
      expect(FakeWebSocket.latest().url).toBe('ws://snapserver:1780/jsonrpc');
    });

    it('retries when the WebSocket constructor throws', () => {
      vi.useFakeTimers();
      let attempts = 0;
      vi.stubGlobal(
        'WebSocket',
        class {
          constructor() {
            attempts++;
            throw new Error('bad url');
          }
        },
      );
      control.connect('nonsense');

      expect(onConnectionChanged).toHaveBeenLastCalledWith(
        control,
        false,
        'Exception while connecting: "Error: bad url", trying to reconnect.',
      );
      vi.advanceTimersByTime(1000);
      expect(attempts).toBe(2);
    });

    it('does not reconnect after an explicit disconnect', () => {
      vi.useFakeTimers();
      control.connect('ws://snapserver:1780');
      const ws = FakeWebSocket.latest();
      ws.open();
      control.disconnect();

      expect(ws.readyState).toBe(FakeWebSocket.CLOSED);
      expect(onConnectionChanged).toHaveBeenLastCalledWith(control, false);
      ws.onclose?.();
      vi.advanceTimersByTime(5000);
      expect(FakeWebSocket.instances).toHaveLength(1);
    });

    it('closes a socket that is still connecting, and ignores its late open', () => {
      control.connect('ws://first:1780');
      const first = FakeWebSocket.latest();
      control.connect('ws://second:1780');
      const second = FakeWebSocket.latest();

      expect(first.readyState).toBe(FakeWebSocket.CLOSED);
      first.open();
      expect(first.sent).toEqual([]);
      expect(second.sent).toEqual([]);
      expect(onConnectionChanged).not.toHaveBeenCalledWith(control, true);
    });

    it('does not send while not connected', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      control.connect('ws://snapserver:1780');
      const ws = FakeWebSocket.latest();
      ws.open();
      ws.receive({ id: ws.lastSent().id, jsonrpc: '2.0', result: { server: makeServerStatus() } });
      ws.readyState = FakeWebSocket.CLOSED;

      expect(() => control.setVolume('c1', 10)).not.toThrow();
      expect(ws.sent).toHaveLength(1);
      expect(warn).toHaveBeenCalledWith('Not connected, dropping Client.SetVolume');
    });

    it('cancels a pending reconnect on disconnect', () => {
      vi.useFakeTimers();
      control.connect('ws://snapserver:1780');
      FakeWebSocket.latest().drop();
      control.disconnect();
      vi.advanceTimersByTime(5000);

      expect(FakeWebSocket.instances).toHaveLength(1);
    });
  });

  describe('lookups', () => {
    beforeEach(() => {
      connected();
    });

    it('finds clients, groups and streams or throws', () => {
      expect(control.getClient('c1').getName()).toBe('Kitchen');
      expect(control.getGroup('g2').name).toBe('Office');
      expect(control.getStream('s2').id).toBe('s2');
      expect(() => control.getClient('x')).toThrow('client x was null');
      expect(() => control.getGroup('x')).toThrow('group x was null');
      expect(() => control.getStream('x')).toThrow('stream x was null');
    });

    it('resolves the group and stream of a client', () => {
      expect(control.getGroupFromClient('c3').id).toBe('g2');
      expect(control.getStreamFromClient('c1').id).toBe('s1');
      expect(() => control.getGroupFromClient('x')).toThrow('group for client x was null');
    });

    it('averages the group volume', () => {
      const g1 = control.getGroup('g1');
      expect(control.getGroupVolume(g1, false)).toBe(60);

      control.getClient('c2').connected = false;
      expect(control.getGroupVolume(g1, true)).toBe(40);

      control.getClient('c1').connected = false;
      expect(control.getGroupVolume(g1, true)).toBe(0);

      expect(
        control.getGroupVolume(
          new Snapcast.Group({ id: 'empty', name: '', stream_id: 's1', muted: false, clients: [] }),
          false,
        ),
      ).toBe(0);
    });
  });

  describe('requests', () => {
    let ws: FakeWebSocket;
    beforeEach(() => {
      ws = connected();
    });

    it('sets and clamps client volume', () => {
      control.setVolume('c1', 55);
      expect(ws.lastSent()).toMatchObject({
        jsonrpc: '2.0',
        method: 'Client.SetVolume',
        params: { id: 'c1', volume: { muted: false, percent: 55 } },
      });
      expect(control.getClient('c1').config.volume.percent).toBe(55);

      control.setVolume('c1', 150, true);
      expect(ws.lastSent().params.volume).toEqual({ muted: true, percent: 100 });

      control.setVolume('c1', -5);
      expect(ws.lastSent().params.volume).toEqual({ muted: true, percent: 0 });
    });

    it('uses increasing request ids', () => {
      control.setVolume('c1', 1);
      control.setVolume('c1', 2);
      const ids = ws.sent.map((m) => m.id);
      expect(ids).toEqual([...ids].sort((a, b) => a - b));
      expect(new Set(ids).size).toBe(ids.length);
    });

    it('renames a client only when the name changes', () => {
      control.setClientName('c1', 'Kitchen');
      control.setClientName('c2', 'livingroom');
      expect(ws.sent).toHaveLength(1);

      control.setClientName('c1', 'Dining');
      expect(ws.lastSent()).toMatchObject({ method: 'Client.SetName', params: { id: 'c1', name: 'Dining' } });
      expect(control.getClient('c1').config.name).toBe('Dining');
    });

    it('sets latency only when it changes', () => {
      control.setClientLatency('c1', 0);
      expect(ws.sent).toHaveLength(1);

      control.setClientLatency('c1', 30);
      expect(ws.lastSent()).toMatchObject({ method: 'Client.SetLatency', params: { id: 'c1', latency: 30 } });
      expect(control.getClient('c1').config.latency).toBe(30);
    });

    it('drops every group left empty, including adjacent ones', () => {
      const status = makeServerStatus();
      status.groups.push({ clients: [makeClient('c4')], id: 'g3', muted: false, name: '', stream_id: 's1' });
      ws = connected(status);
      control.deleteClient('c3');
      control.deleteClient('c4');

      expect(control.server.groups.map((g) => g.id)).toEqual(['g1']);
    });

    it('deletes a client and drops its group once empty', () => {
      control.deleteClient('c2');
      expect(ws.lastSent()).toMatchObject({ method: 'Server.DeleteClient', params: { id: 'c2' } });
      expect(control.getGroup('g1').clients.map((c) => c.id)).toEqual(['c1']);

      control.deleteClient('c3');
      expect(control.server.groups.map((g) => g.id)).toEqual(['g1']);
    });

    it('sets a group stream', () => {
      control.setStream('g1', 's2');
      expect(ws.lastSent()).toMatchObject({ method: 'Group.SetStream', params: { id: 'g1', stream_id: 's2' } });
      expect(control.getGroup('g1').stream_id).toBe('s2');
    });

    it('sets group clients and reloads the server from the response', () => {
      control.setClients('g1', ['c1', 'c2', 'c3']);
      const request = ws.lastSent();
      expect(request).toMatchObject({ method: 'Group.SetClients', params: { id: 'g1', clients: ['c1', 'c2', 'c3'] } });

      const status = makeServerStatus();
      status.groups[0].clients.push(status.groups[1].clients[0]);
      status.groups.pop();
      ws.receive({ id: request.id, jsonrpc: '2.0', result: { server: status } });

      expect(control.getGroup('g1').clients).toHaveLength(3);
      expect(onChange).toHaveBeenCalledTimes(1);
    });

    it('mutes a group', () => {
      control.muteGroup('g1', true);
      expect(ws.lastSent()).toMatchObject({ method: 'Group.SetMute', params: { id: 'g1', mute: true } });
      expect(control.getGroup('g1').muted).toBe(true);
    });

    it('sends stream control commands with optional params', () => {
      control.control('s1', 'next');
      expect(ws.lastSent()).toMatchObject({ method: 'Stream.Control', params: { id: 's1', command: 'next' } });
      expect(ws.lastSent().params.params).toBeUndefined();

      control.control('s1', 'seek', { offset: 10 });
      expect(ws.lastSent().params).toEqual({ id: 's1', command: 'seek', params: { offset: 10 } });
    });
  });

  describe('notifications', () => {
    let ws: FakeWebSocket;
    beforeEach(() => {
      ws = connected();
    });

    function notify(method: string, params: unknown) {
      ws.receive({ jsonrpc: '2.0', method: method, params: params });
    }

    it('applies Client.OnVolumeChanged', () => {
      notify('Client.OnVolumeChanged', { id: 'c1', volume: { muted: true, percent: 12 } });
      expect(control.getClient('c1').config.volume).toEqual({ muted: true, percent: 12 });
      expect(onChange).toHaveBeenCalledWith(control, control.server);
    });

    it('applies Client.OnLatencyChanged', () => {
      notify('Client.OnLatencyChanged', { id: 'c1', latency: 42 });
      expect(control.getClient('c1').config.latency).toBe(42);
    });

    it('applies Client.OnNameChanged', () => {
      notify('Client.OnNameChanged', { id: 'c2', name: 'Lounge' });
      expect(control.getClient('c2').getName()).toBe('Lounge');
    });

    it('applies Client.OnConnect and Client.OnDisconnect', () => {
      notify('Client.OnConnect', { id: 'c3', client: makeClient('c3', { connected: true, percent: 20 }) });
      expect(control.getClient('c3').connected).toBe(true);

      notify('Client.OnDisconnect', { id: 'c3', client: makeClient('c3', { connected: false, percent: 20 }) });
      expect(control.getClient('c3').connected).toBe(false);
    });

    it('applies Group.OnMute and Group.OnStreamChanged', () => {
      notify('Group.OnMute', { id: 'g1', mute: true });
      expect(control.getGroup('g1').muted).toBe(true);

      notify('Group.OnStreamChanged', { id: 'g1', stream_id: 's2' });
      expect(control.getGroup('g1').stream_id).toBe('s2');
    });

    it('applies Group.OnNameChanged', () => {
      notify('Group.OnNameChanged', { id: 'g1', name: 'Downstairs' });
      expect(control.getGroup('g1').name).toBe('Downstairs');
    });

    it('applies Stream.OnUpdate and Stream.OnProperties', () => {
      const updated = makeStream('s2', { canControl: true, playbackStatus: 'paused' });
      notify('Stream.OnUpdate', { id: 's2', stream: updated });
      expect(control.getStream('s2').properties.canControl).toBe(true);

      notify('Stream.OnProperties', {
        id: 's2',
        properties: { playbackStatus: 'playing', metadata: { title: 'New' } },
      });
      expect(control.getStream('s2').properties.playbackStatus).toBe('playing');
      expect(control.getStream('s2').properties.metadata!.title).toBe('New');
    });

    it('applies Server.OnUpdate', () => {
      const status = makeServerStatus();
      status.groups.pop();
      notify('Server.OnUpdate', { server: status });
      expect(control.server.groups).toHaveLength(1);
    });

    it('applies a batch of notifications', () => {
      ws.receive([
        { jsonrpc: '2.0', method: 'Group.OnMute', params: { id: 'g1', mute: true } },
        { jsonrpc: '2.0', method: 'Client.OnNameChanged', params: { id: 'c1', name: 'Batch' } },
      ]);
      expect(control.getGroup('g1').muted).toBe(true);
      expect(control.getClient('c1').config.name).toBe('Batch');
      expect(onChange).toHaveBeenCalledTimes(1);
    });

    it('still notifies on unknown notifications', () => {
      notify('Something.New', {});
      expect(onChange).toHaveBeenCalledTimes(1);
    });

    it('skips notifications for unknown clients and applies the rest', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      ws.receive([
        { jsonrpc: '2.0', method: 'Client.OnDisconnect', params: { id: 'gone', client: makeClient('gone') } },
        { jsonrpc: '2.0', method: 'Group.OnMute', params: { id: 'g1', mute: true } },
      ]);

      expect(control.getGroup('g1').muted).toBe(true);
      expect(onChange).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('Client.OnDisconnect'));
    });

    it('ignores messages from a connection after disconnecting', () => {
      control.disconnect();
      notify('Group.OnMute', { id: 'g1', mute: true });

      expect(control.getGroup('g1').muted).toBe(false);
      expect(onChange).not.toHaveBeenCalled();
    });

    it('works without an onChange handler', () => {
      control.onChange = null;
      expect(() => notify('Group.OnMute', { id: 'g1', mute: true })).not.toThrow();
      expect(control.getGroup('g1').muted).toBe(true);
    });
  });
});
