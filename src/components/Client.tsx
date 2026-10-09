import { useState } from 'react';
import { SnapControl, Snapcast } from '../snapcontrol';
import VolumeControl from './VolumeControl';

type ClientProps = {
  client: Snapcast.Client;
  snapcontrol: SnapControl;
  onVolumeChange: () => void;
};

export default function Client(props: ClientProps) {
  const client = props.client;
  const [, setUpdate] = useState(0);
  const displayName = client.getName();

  // setVolume updates the model in place, so re-render to show it, and let
  // the group update its volume
  function handleVolumeChange(value: number) {
    props.snapcontrol.setVolume(client.id, value, false);
    setUpdate((u) => u + 1);
    props.onVolumeChange();
  }

  function handleMuteClicked() {
    props.snapcontrol.setVolume(client.id, client.config.volume.percent, !client.config.volume.muted);
    setUpdate((u) => u + 1);
  }

  return (
    <li className="list-group-item client-row" style={{ opacity: client.connected ? 1.0 : 0.5 }}>
      <div className="d-flex align-items-center gap-2 client-heading">
        <span className="client-name text-truncate">{displayName}</span>
        {!client.connected && (
          <span className="badge rounded-pill text-bg-secondary fw-normal flex-shrink-0">offline</span>
        )}
      </div>
      <VolumeControl
        label={displayName}
        volume={client.config.volume.percent}
        muted={client.config.volume.muted}
        onMuteClick={handleMuteClicked}
        onChange={handleVolumeChange}
      />
    </li>
  );
}
