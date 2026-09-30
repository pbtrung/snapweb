/// <reference types="node" />
import { SnapControl, Snapcast } from '../../src/snapcontrol';

// Base url of the Snapserver to test against, e.g. ws://10.10.1.1:1780
export const serverUrl = process.env.SNAPSERVER_URL ?? '';

export async function waitFor<T>(
  check: () => T | undefined | false | Promise<T | undefined | false>,
  what: string,
  timeoutMs = 5000,
): Promise<T> {
  const start = Date.now();
  for (;;) {
    try {
      const result = await check();
      if (result !== undefined && result !== false) return result;
    } catch {
      // not there yet, e.g. the model isn't loaded
    }
    if (Date.now() - start > timeoutMs) throw new Error('Timed out waiting for ' + what);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

// A SnapControl that has received the initial server status
export async function connect(): Promise<SnapControl> {
  const control = new SnapControl();
  control.connect(serverUrl);
  try {
    // Notifications can arrive before the status response, so wait for the
    // status itself rather than any onChange
    await waitFor(() => control.server.server !== undefined, 'the server status from ' + serverUrl);
  } catch (e) {
    // Otherwise it keeps reconnecting in the background
    control.disconnect();
    throw e;
  }
  return control;
}

// A fresh Server.GetStatus over a new connection, independent of any model
export async function fetchStatus(): Promise<Snapcast.Server> {
  const control = await connect();
  control.disconnect();
  return control.server;
}

export function allClients(server: Snapcast.Server): Snapcast.Client[] {
  return server.groups.flatMap((group) => group.clients);
}

// Prefer offline clients and groups, so tests don't change what anyone hears
export function pickClient(server: Snapcast.Server): Snapcast.Client {
  const clients = allClients(server);
  return clients.find((client) => !client.connected) ?? clients[0];
}

export function pickGroup(server: Snapcast.Server): Snapcast.Group {
  return server.groups.find((group) => group.clients.every((client) => !client.connected)) ?? server.groups[0];
}
