import { afterAll, describe, expect, it } from 'vitest';
import { connect, fetchStatus, serverUrl, waitFor } from './helpers';

// config.ts reads window.location when loaded. jsdom would provide it, but its
// Event class breaks Node's WebSocket, so stub just enough for the import.
(globalThis as any).window ??= { location: { host: '', protocol: 'http:' } };
const { HelloMessage, JsonMessage, TimeMessage } = await import('../../src/snapstream');

// Handshakes on the audio stream endpoint as a throwaway client, which the
// server remembers, so the test deletes exactly that client afterwards
describe.skipIf(!serverUrl)('audio stream handshake', () => {
  const clientId = 'snapweb-integration-' + Math.random().toString(16).slice(2, 10);
  const hostName = 'Snapweb Küche ⚡ test';
  let socket: WebSocket | undefined;
  const received: { type: number; buffer: ArrayBuffer }[] = [];

  afterAll(async () => {
    socket?.close();
    const status = await waitFor(async () => {
      const server = await fetchStatus();
      const client = server.getClient(clientId);
      return client === null || !client.connected ? server : undefined;
    }, 'the test client to disconnect');
    if (status.getClient(clientId)) {
      const control = await connect();
      control.deleteClient(clientId);
      await waitFor(async () => (await fetchStatus()).getClient(clientId) === null, 'the test client to be deleted');
      control.disconnect();
    }
  });

  it('accepts a Hello with a non-ASCII host name and answers with settings and codec', async () => {
    socket = new WebSocket(serverUrl + '/stream');
    socket.binaryType = 'arraybuffer';
    socket.onmessage = (event: MessageEvent) => {
      const buffer = event.data as ArrayBuffer;
      received.push({ type: new DataView(buffer).getUint16(0, true), buffer: buffer });
    };
    await new Promise<void>((resolve, reject) => {
      socket!.onopen = () => resolve();
      socket!.onerror = () => reject(new Error('could not open ' + serverUrl + '/stream'));
    });

    const hello = new HelloMessage();
    hello.mac = '00:00:00:00:00:00';
    hello.hostname = hostName;
    hello.uniqueId = clientId;
    hello.os = 'integration test';
    hello.version = '0.0.0';
    hello.clientName = 'Snapweb';
    hello.id = 1;
    socket.send(hello.serialize());

    // 3 = ServerSettings, 1 = CodecHeader
    const settings = await waitFor(() => received.find((m) => m.type === 3), 'ServerSettings');
    await waitFor(() => received.find((m) => m.type === 1), 'CodecHeader');
    const json = new JsonMessage(settings.buffer).json;
    expect(json).toHaveProperty('bufferMs');
    expect(json).toHaveProperty('volume');

    // The host name only survives if the message size counted UTF-8 bytes
    const loaded = await waitFor(
      async () => (await fetchStatus()).getClient(clientId) ?? undefined,
      'the test client in the status',
    );
    expect(loaded.host.name).toBe(hostName);
    expect(loaded.connected).toBe(true);
    expect(loaded.snapclient.name).toBe('Snapweb');
  });

  it('answers time requests with refersTo and server timestamps in wire order', async () => {
    const request = new TimeMessage();
    request.id = 4242;
    request.sent.setMilliseconds(performance.now());
    request.latency.setMilliseconds(performance.now());
    socket!.send(request.serialize());

    const reply = await waitFor(
      () => received.find((m) => m.type === 4 && new TimeMessage(m.buffer).refersTo === 4242),
      'the time reply',
    );
    const time = new TimeMessage(reply.buffer);
    // The server stamps received on arrival and sent when replying
    expect(time.sent.getMilliseconds()).toBeGreaterThanOrEqual(time.received.getMilliseconds());
    expect(time.sent.getMilliseconds() - time.received.getMilliseconds()).toBeLessThan(100);
  });
});
