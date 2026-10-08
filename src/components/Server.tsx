import { Speaker } from 'lucide-react';
import Group from './Group';
import { SnapControl, Snapcast } from '../snapcontrol';

type ServerProps = {
  server: Snapcast.Server;
  snapcontrol: SnapControl;
  showOffline: boolean;
  deletedClientIds: string[];
  onClientDelete: (client: Snapcast.Client) => void;
};

export default function Server(props: ServerProps) {
  const groups = props.server.groups;
  const hasClients = groups.some((group) =>
    group.clients.some(
      (client) => (client.connected || props.showOffline) && !props.deletedClientIds.includes(client.id),
    ),
  );
  return (
    <main className="app-main app-content container-fluid d-flex flex-column">
      {groups.map((group) => (
        <Group
          group={group}
          key={group.id}
          server={props.server}
          snapcontrol={props.snapcontrol}
          showOffline={props.showOffline}
          deletedClientIds={props.deletedClientIds}
          onClientDelete={props.onClientDelete}
        />
      ))}
      {groups.length > 0 && !hasClients && (
        <div className="text-center text-body-secondary py-5">
          <Speaker size={48} strokeWidth={1.5} className="mb-3 opacity-50" aria-hidden="true" />
          <p className="mb-0">No clients are online</p>
        </div>
      )}
    </main>
  );
}
