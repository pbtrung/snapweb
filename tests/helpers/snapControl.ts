import { vi } from 'vitest';
import { SnapControl } from '../../src/snapcontrol';
import { FakeWebSocket } from './fakeWebSocket';
import { makeServerStatus } from '../fixtures/serverStatus';

// A SnapControl connected to a FakeWebSocket and loaded with the fixture status
export function connectedControl(status = makeServerStatus()) {
  FakeWebSocket.reset();
  vi.stubGlobal('WebSocket', FakeWebSocket);
  const control = new SnapControl();
  control.connect('ws://snapserver:1780');
  const ws = FakeWebSocket.latest();
  ws.open();
  ws.receive({ id: ws.lastSent().id, jsonrpc: '2.0', result: { server: status } });
  ws.sent = [];
  return { control, ws };
}

// Only the requests with the given JSON-RPC method
export function requests(ws: FakeWebSocket, method: string): any[] {
  return ws.sent.filter(m => m.method === method);
}

export function quietConsole() {
  for (const level of ['debug', 'log', 'info'] as const)
    vi.spyOn(console, level).mockImplementation(() => { });
}
