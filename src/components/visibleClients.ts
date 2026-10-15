import { Snapcast } from '../snapcontrol';

// The clients of a group shown in the UI: online ones (and offline ones when
// asked for), without those waiting for their delete to be undone or carried out
export function visibleClients(
  group: Snapcast.Group,
  showOffline: boolean,
  deletedClientIds: string[],
): Snapcast.Client[] {
  return group.clients.filter((client) => (client.connected || showOffline) && !deletedClientIds.includes(client.id));
}
