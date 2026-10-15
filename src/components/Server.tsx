import { Speaker } from 'lucide-react';
import Group from './Group';
import { SnapControl, Snapcast } from '../snapcontrol';
import { visibleClients } from './visibleClients';

type ServerProps = {
  server: Snapcast.Server;
  snapcontrol: SnapControl;
  showOffline: boolean;
  deletedClientIds: string[];
};

export default function Server(props: ServerProps) {
  const groups = props.server.groups;
  const hasClients = groups.some(
    (group) => visibleClients(group, props.showOffline, props.deletedClientIds).length > 0,
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
        />
      ))}
      {groups.length > 0 && !hasClients && (
        <div className="empty-state">
          <span className="empty-state-icon" aria-hidden="true">
            <Speaker size={32} strokeWidth={1.5} />
          </span>
          <p className="fw-semibold mb-1">No clients are online</p>
          <p className="small text-body-secondary mb-0">Start a Snapclient, or show offline clients in the settings</p>
        </div>
      )}
    </main>
  );
}
