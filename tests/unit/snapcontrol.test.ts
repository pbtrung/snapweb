import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { SnapControl, Snapcast, base64, needsLogin } from '../../src/snapcontrol';
import { authToken } from '../../src/config';
import { FakeWebSocket } from '../helpers/fakeWebSocket';
import { quietConsole, requests } from '../helpers/snapControl';
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

describe('login helpers', () => {
  it('recognizes the errors that ask for a login', () => {
    expect(needsLogin({ code: 401, message: 'Unauthorized' })).toBe(true);
    expect(needsLogin({ code: -32000, message: 'Unauthorized' })).toBe(true);
    expect(needsLogin({ code: -32000, message: 'Internal error' })).toBe(false);
    expect(needsLogin({ code: -32601, message: 'Method not found' })).toBe(false);
    expect(needsLogin(undefined)).toBe(false);
  });

  it('encodes Basic credentials as UTF-8 base64', () => {
    expect(base64('admin:secret')).toBe('YWRtaW46c2VjcmV0');
    expect(base64('jürgen:pässwört ⚡')).toBe(Buffer.from('jürgen:pässwört ⚡', 'utf8').toString('base64'));
  });
});

describe('SnapControl', () => {
  let control: SnapControl;
  let onChange: Mock<NonNullable<SnapControl['onChange']>>;
  let onConnectionChanged: Mock<NonNullable<SnapControl['onConnectionChanged']>>;
  let onAuthRequired: Mock<NonNullable<SnapControl['onAuthRequired']>>;

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
    onAuthRequired = vi.fn<NonNullable<SnapControl['onAuthRequired']>>();
    control.onAuthRequired = onAuthRequired;
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

    it('keeps an idle connection alive until it drops', () => {
      vi.useFakeTimers();
      const ws = connected();
      const sent = ws.sent.length;

      vi.advanceTimersByTime(10000);
      expect(ws.sent).toHaveLength(sent + 1);
      expect(ws.lastSent()).toMatchObject({ jsonrpc: '2.0', method: 'Server.GetRPCVersion' });
      ws.receive({ id: ws.lastSent().id, jsonrpc: '2.0', result: { major: 2, minor: 0, patch: 0 } });
      expect(onChange).not.toHaveBeenCalled();

      ws.drop();
      // Only the reconnect timer is left, not the keepalive
      expect(vi.getTimerCount()).toBe(1);
    });

    it('stops the keepalive on disconnect', () => {
      vi.useFakeTimers();
      connected();
      control.disconnect();

      expect(vi.getTimerCount()).toBe(0);
    });

    it('stays connected while keepalive replies arrive', () => {
      vi.useFakeTimers();
      const ws = connected();
      for (let i = 0; i < 6; i++) {
        vi.advanceTimersByTime(10000);
        ws.receive({ id: ws.lastSent().id, jsonrpc: '2.0', result: { major: 2, minor: 0, patch: 0 } });
      }

      expect(FakeWebSocket.instances).toHaveLength(1);
      expect(onConnectionChanged).not.toHaveBeenCalled();
    });

    it('reconnects when a half-open connection stops answering', () => {
      vi.useFakeTimers();
      const ws = connected();
      vi.advanceTimersByTime(30000);
      expect(FakeWebSocket.instances).toHaveLength(1);

      vi.advanceTimersByTime(10000);
      expect(onConnectionChanged).toHaveBeenCalledWith(control, false, 'Connection lost, trying to reconnect.');
      expect(ws.readyState).toBe(FakeWebSocket.CLOSED);
      expect(FakeWebSocket.instances).toHaveLength(2);
      expect(FakeWebSocket.latest().url).toBe('ws://snapserver:1780/jsonrpc');
    });

    it('refetches the status when a request fails', () => {
      vi.useFakeTimers();
      const ws = connected();
      control.setStream('g1', 'bogus');
      expect(control.getGroup('g1').stream_id).toBe('bogus');

      ws.receive({ id: ws.lastSent().id, jsonrpc: '2.0', error: { code: -32603, message: 'Stream not found' } });
      vi.advanceTimersByTime(1000);
      const request = ws.lastSent();
      expect(request.method).toBe('Server.GetStatus');

      ws.receive({ id: request.id, jsonrpc: '2.0', result: { server: makeServerStatus() } });
      expect(control.getGroup('g1').stream_id).toBe('s1');
    });

    it('refetches the status when the status request fails', () => {
      vi.useFakeTimers();
      const ws = connected();
      control.setClients('g1', ['c1', 'c2', 'gone']);
      const failed = ws.lastSent().id;

      expect(() =>
        ws.receive({ id: failed, jsonrpc: '2.0', error: { code: -32603, message: 'Client not found' } }),
      ).not.toThrow();
      vi.advanceTimersByTime(1000);
      expect(ws.lastSent()).toMatchObject({ method: 'Server.GetStatus' });
      expect(ws.lastSent().id).not.toBe(failed);
    });

    it('ignores malformed messages', () => {
      const ws = connected();
      expect(() => ws.onmessage?.({ data: '{not json' })).not.toThrow();
      expect(onChange).not.toHaveBeenCalled();
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

    it('rounds client volume to whole percents', () => {
      control.setVolume('c1', 33.333);
      expect(ws.lastSent().params.volume.percent).toBe(33);
      expect(control.getClient('c1').config.volume.percent).toBe(33);
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

  describe('error backoff', () => {
    function lastStatusRequest(ws: FakeWebSocket) {
      return requests(ws, 'Server.GetStatus').slice(-1)[0];
    }

    function failRequest(ws: FakeWebSocket, request: { id: number }, code = -32603) {
      ws.receive({ id: request.id, jsonrpc: '2.0', error: { code, message: 'Internal error' } });
    }

    it('refetches with a delay that doubles while the status keeps failing, up to 30 s', () => {
      vi.useFakeTimers();
      const ws = connected();
      control.setStream('g1', 'bogus');
      failRequest(ws, ws.lastSent());

      for (const delay of [1000, 2000, 4000, 8000, 16000, 30000, 30000]) {
        const before = requests(ws, 'Server.GetStatus').length;
        vi.advanceTimersByTime(delay - 1);
        expect(requests(ws, 'Server.GetStatus')).toHaveLength(before);
        vi.advanceTimersByTime(1);
        expect(requests(ws, 'Server.GetStatus')).toHaveLength(before + 1);
        failRequest(ws, lastStatusRequest(ws));
      }
    });

    it('starts over at 1 s once a status arrives', () => {
      vi.useFakeTimers();
      const ws = connected();
      control.setStream('g1', 'bogus');
      failRequest(ws, ws.lastSent());
      vi.advanceTimersByTime(1000);
      failRequest(ws, lastStatusRequest(ws));
      vi.advanceTimersByTime(2000);
      ws.receive({ id: lastStatusRequest(ws).id, jsonrpc: '2.0', result: { server: makeServerStatus() } });

      control.muteGroup('g1', true);
      failRequest(ws, ws.lastSent());
      const before = requests(ws, 'Server.GetStatus').length;
      vi.advanceTimersByTime(1000);
      expect(requests(ws, 'Server.GetStatus')).toHaveLength(before + 1);
    });

    it('coalesces failures into one pending refetch', () => {
      vi.useFakeTimers();
      const ws = connected();
      ws.sent = [];
      control.setStream('g1', 's2');
      control.muteGroup('g1', true);
      control.setVolume('c1', 10);
      for (const request of [...ws.sent]) failRequest(ws, request);

      vi.advanceTimersByTime(1000);
      expect(requests(ws, 'Server.GetStatus')).toHaveLength(1);
      vi.advanceTimersByTime(60000);
      expect(requests(ws, 'Server.GetStatus')).toHaveLength(1);
    });

    it('does not refetch after a stream control error', () => {
      vi.useFakeTimers();
      const ws = connected();
      ws.sent = [];
      control.control('s1', 'play');
      ws.receive({ id: ws.lastSent().id, jsonrpc: '2.0', error: { code: 1, message: 'Stream can not be controlled' } });

      vi.advanceTimersByTime(5000);
      expect(requests(ws, 'Server.GetStatus')).toHaveLength(0);
    });

    it('cancels a pending refetch on disconnect', () => {
      vi.useFakeTimers();
      const ws = connected();
      control.muteGroup('g1', true);
      failRequest(ws, ws.lastSent());
      control.disconnect();

      expect(vi.getTimerCount()).toBe(0);
    });
  });

  describe('authentication', () => {
    const unauthorized = { code: 401, message: 'Unauthorized' };

    beforeEach(() => {
      window.localStorage.clear();
      window.sessionStorage.clear();
    });

    // Lets the async login steps run after a reply
    async function settle() {
      for (let i = 0; i < 10; i++) await Promise.resolve();
    }

    function opened(): FakeWebSocket {
      control.connect('ws://snapserver:1780');
      const ws = FakeWebSocket.latest();
      ws.open();
      return ws;
    }

    // A connection whose status request asked for a login
    function needingLogin(): FakeWebSocket {
      const ws = opened();
      ws.receive({ id: ws.lastSent().id, jsonrpc: '2.0', error: unauthorized });
      return ws;
    }

    function reply(ws: FakeWebSocket, request: { id: number }, result: unknown) {
      ws.receive({ id: request.id, jsonrpc: '2.0', result });
    }

    function fail(ws: FakeWebSocket, request: { id: number }, error: unknown) {
      ws.receive({ id: request.id, jsonrpc: '2.0', error });
    }

    it('asks for a login when the status needs one, and does not refetch', () => {
      vi.useFakeTimers();
      const ws = needingLogin();

      expect(onAuthRequired).toHaveBeenCalledExactlyOnceWith(control, true);
      expect(control.authRequired).toBe(true);
      vi.advanceTimersByTime(25000);
      expect(requests(ws, 'Server.GetStatus')).toHaveLength(1);
    });

    it('also asks for a login on -32000 Unauthorized from older servers', () => {
      const ws = opened();
      fail(ws, ws.lastSent(), { code: -32000, message: 'Unauthorized' });
      expect(onAuthRequired).toHaveBeenCalledWith(control, true);
    });

    it('asks only once while the login is missing, across reconnects', () => {
      vi.useFakeTimers();
      needingLogin().drop();
      vi.advanceTimersByTime(1000);
      const ws = FakeWebSocket.latest();
      ws.open();
      fail(ws, ws.lastSent(), unauthorized);

      expect(onAuthRequired).toHaveBeenCalledTimes(1);
    });

    it('logs in with Basic, then fetches the status and a token', async () => {
      const ws = needingLogin();
      ws.sent = [];
      const login = control.login('admin', 'pässwort', false);

      expect(ws.sent).toEqual([
        {
          id: expect.any(Number),
          jsonrpc: '2.0',
          method: 'Server.Authenticate',
          params: { scheme: 'Basic', param: base64('admin:pässwort') },
        },
      ]);
      reply(ws, ws.sent[0], 'ok');
      await settle();
      expect(ws.sent.map((m) => m.method)).toEqual(['Server.Authenticate', 'Server.GetStatus', 'Server.GetToken']);
      expect(ws.sent[2].params).toEqual({ username: 'admin', password: 'pässwort' });
      expect(onAuthRequired).toHaveBeenLastCalledWith(control, false);

      reply(ws, ws.sent[1], { server: makeServerStatus() });
      expect(control.server.groups).toHaveLength(2);
      reply(ws, ws.sent[2], { token: 'jwt' });
      await login;

      expect(control.token).toBe('jwt');
      expect(control.basic).toBeUndefined();
      expect(control.loggedIn).toBe(true);
    });

    it('stores the token for the session only, without Remember me', async () => {
      const ws = needingLogin();
      const login = control.login('admin', 'secret', false);
      reply(ws, ws.lastSent(), 'ok');
      await settle();
      reply(ws, requests(ws, 'Server.GetToken')[0], { token: 'jwt' });
      await login;

      expect(window.sessionStorage.getItem('auth.token')).toBe('jwt');
      expect(window.localStorage.getItem('auth.token')).toBeNull();
    });

    it('stores the token in localStorage with Remember me', async () => {
      const ws = needingLogin();
      const login = control.login('admin', 'secret', true);
      reply(ws, ws.lastSent(), 'ok');
      await settle();
      reply(ws, requests(ws, 'Server.GetToken')[0], { token: 'jwt' });
      await login;

      expect(window.localStorage.getItem('auth.token')).toBe('jwt');
      expect(window.sessionStorage.getItem('auth.token')).toBeNull();
    });

    it('keeps the login in memory only when the server has no Server.GetToken', async () => {
      const ws = needingLogin();
      const login = control.login('admin', 'secret', true);
      reply(ws, ws.lastSent(), 'ok');
      await settle();
      fail(ws, requests(ws, 'Server.GetToken')[0], { code: -32601, message: 'Method not found' });
      await login;

      expect(control.token).toBeUndefined();
      expect(control.basic).toBe(base64('admin:secret'));
      expect(window.localStorage.getItem('auth.token')).toBeNull();
      expect(window.sessionStorage.getItem('auth.token')).toBeNull();
      expect(JSON.stringify({ ...window.localStorage })).not.toContain('secret');

      // and sends it again after reconnecting
      ws.drop();
      control.connect('ws://snapserver:1780');
      const next = FakeWebSocket.latest();
      next.open();
      expect(next.sent).toEqual([
        expect.objectContaining({
          method: 'Server.Authenticate',
          params: { scheme: 'Basic', param: base64('admin:secret') },
        }),
      ]);
    });

    it('rejects a wrong password without fetching anything', async () => {
      const ws = needingLogin();
      ws.sent = [];
      const login = control.login('admin', 'wrong', true);
      fail(ws, ws.lastSent(), unauthorized);

      await expect(login).rejects.toThrow('Wrong user name or password');
      expect(ws.sent).toHaveLength(1);
      expect(control.loggedIn).toBe(false);
      expect(control.authRequired).toBe(true);
    });

    it('fails to log in while not connected', async () => {
      control.connect('ws://snapserver:1780');
      await expect(control.login('admin', 'secret', false)).rejects.toThrow('Not connected to Snapserver');
    });

    it('authenticates with the stored token before anything else on connect', async () => {
      authToken.set('jwt', true);
      const ws = opened();

      expect(ws.sent).toEqual([
        expect.objectContaining({ method: 'Server.Authenticate', params: { scheme: 'Bearer', param: 'jwt' } }),
      ]);
      // Held back until the login is answered
      control.control('s1', 'play');
      expect(ws.sent).toHaveLength(1);

      reply(ws, ws.sent[0], 'ok');
      await settle();
      expect(ws.sent.map((m) => m.method)).toEqual(['Server.Authenticate', 'Stream.Control', 'Server.GetStatus']);
      reply(ws, requests(ws, 'Server.GetStatus')[0], { server: makeServerStatus() });
      expect(control.server.groups).toHaveLength(2);
      expect(onAuthRequired).not.toHaveBeenCalled();
    });

    it('sends the keepalive while the login is answered', () => {
      vi.useFakeTimers();
      authToken.set('jwt', true);
      const ws = opened();
      vi.advanceTimersByTime(10000);

      expect(ws.sent.map((m) => m.method)).toEqual(['Server.Authenticate', 'Server.GetRPCVersion']);
    });

    it('authenticates with the token again after the keepalive reconnects', async () => {
      vi.useFakeTimers();
      control.token = 'jwt';
      const ws = opened();
      reply(ws, ws.lastSent(), 'ok');
      await settle();
      reply(ws, requests(ws, 'Server.GetStatus')[0], { server: makeServerStatus() });

      vi.advanceTimersByTime(40000);
      const next = FakeWebSocket.latest();
      expect(next).not.toBe(ws);
      next.open();
      expect(next.sent).toEqual([
        expect.objectContaining({ method: 'Server.Authenticate', params: { scheme: 'Bearer', param: 'jwt' } }),
      ]);
    });

    it('asks for a new login when the token expired', async () => {
      authToken.set('expired', true);
      const ws = opened();
      fail(ws, ws.lastSent(), unauthorized);
      await settle();

      expect(onAuthRequired).toHaveBeenCalledExactlyOnceWith(control, true);
      expect(requests(ws, 'Server.GetStatus')).toHaveLength(0);
      expect(control.token).toBeUndefined();
      expect(authToken.get()).toBeUndefined();
    });

    it('falls back to the Basic login held in memory when the token is rejected', async () => {
      control.token = 'expired';
      control.basic = base64('admin:secret');
      const ws = opened();
      fail(ws, ws.lastSent(), unauthorized);
      await settle();

      expect(ws.lastSent()).toMatchObject({
        method: 'Server.Authenticate',
        params: { scheme: 'Basic', param: base64('admin:secret') },
      });
      reply(ws, ws.lastSent(), 'ok');
      await settle();
      expect(ws.lastSent()).toMatchObject({ method: 'Server.GetStatus' });
      expect(control.token).toBeUndefined();
      expect(onAuthRequired).not.toHaveBeenCalled();
    });

    it('requests the status when the server does not know Server.Authenticate', async () => {
      control.token = 'jwt';
      const ws = opened();
      fail(ws, ws.lastSent(), { code: -32601, message: 'Method not found' });
      await settle();

      expect(ws.lastSent()).toMatchObject({ method: 'Server.GetStatus' });
    });

    it('forgets the login and reconnects on logout', async () => {
      authToken.set('jwt', true);
      const ws = opened();
      reply(ws, ws.lastSent(), 'ok');
      await settle();
      control.logout();

      expect(ws.readyState).toBe(FakeWebSocket.CLOSED);
      expect(authToken.get()).toBeUndefined();
      expect(control.loggedIn).toBe(false);
      const next = FakeWebSocket.latest();
      next.open();
      expect(next.sent).toEqual([expect.objectContaining({ method: 'Server.GetStatus' })]);
    });

    it('stops asking for a login when it is forgotten', () => {
      needingLogin();
      control.forgetLogin();
      expect(onAuthRequired).toHaveBeenLastCalledWith(control, false);
    });
  });
});
