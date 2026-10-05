import { Speaker } from 'lucide-react';
import Group from './Group';
import { SnapControl, Snapcast } from '../snapcontrol';

type ServerProps = {
  server: Snapcast.Server;
  snapcontrol: SnapControl;
  showOffline: boolean;
};

export default function Server(props: ServerProps) {
  const groups = props.server.groups;
  const hasClients = groups.some((group) => group.clients.some((client) => client.connected || props.showOffline));
  return (
    <main className="app-main container-fluid d-flex flex-column gap-3 py-3 px-3">
      {groups.map((group) => (
        <Group
          group={group}
          key={group.id}
          server={props.server}
          snapcontrol={props.snapcontrol}
          showOffline={props.showOffline}
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
