import { useRef, useState } from 'react';
import { Dropdown } from 'react-bootstrap';
import { AudioLines, Clock, FolderOpen, Pause, Play, Radio, SkipBack, SkipForward } from 'lucide-react';
import Client from './Client';
import VolumeControl from './VolumeControl';
import { SnapControl, Snapcast } from '../snapcontrol';

type GroupProps = {
  server: Snapcast.Server;
  group: Snapcast.Group;
  snapcontrol: SnapControl;
  showOffline: boolean;
  // Clients waiting for their delete to be undone or carried out, hidden here
  deletedClientIds: string[];
};

// Client volumes at the start of a group volume drag, which the drag scales from
type VolumeDrag = {
  clientVolumes: Map<string, number>;
  groupVolume: number;
};

// Scale a client volume by the same ratio the group volume moved, towards
// 0 when lowering and towards 100 when raising
function scaleVolume(clientVolume: number, fromGroupVolume: number, toGroupVolume: number): number {
  if (toGroupVolume < fromGroupVolume)
    return fromGroupVolume === 0 ? 0 : clientVolume * (toGroupVolume / fromGroupVolume);
  if (fromGroupVolume === 100) return clientVolume;
  return clientVolume + (100 - clientVolume) * ((toGroupVolume - fromGroupVolume) / (100 - fromGroupVolume));
}

// Format a duration in seconds as m:ss, or h:mm:ss from one hour up
function formatDuration(seconds: number): string {
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const ss = String(total % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

export default function Group(props: GroupProps) {
  const [, setUpdate] = useState(0);
  const volumeDrag = useRef<VolumeDrag | null>(null);

  // The model is updated in place, so re-render to show the new values
  function refresh() {
    setUpdate((u) => u + 1);
  }

  function getClients(): Snapcast.Client[] {
    return props.group.clients.filter(
      (client) => (client.connected || props.showOffline) && !props.deletedClientIds.includes(client.id),
    );
  }

  function getVolume(): number {
    const clients = getClients();
    // Avoid a NaN volume for groups without (online) clients
    if (clients.length === 0) return 0;
    return clients.reduce((sum, client) => sum + client.config.volume.percent, 0) / clients.length;
  }

  function handleMuteClicked() {
    props.snapcontrol.muteGroup(props.group.id, !props.group.muted);
    refresh();
  }

  function handleVolumeChange(value: number) {
    if (volumeDrag.current === null) {
      const clients = getClients();
      volumeDrag.current = {
        clientVolumes: new Map(clients.map((client) => [client.id, client.config.volume.percent])),
        groupVolume: getVolume(),
      };
    }
    const drag = volumeDrag.current;
    for (const client of getClients()) {
      // A client that appeared during the drag keeps its volume
      const startVolume = drag.clientVolumes.get(client.id);
      if (startVolume === undefined) continue;
      props.snapcontrol.setVolume(client.id, scaleVolume(startVolume, drag.groupVolume, value));
    }
    refresh();
  }

  function handlePlayPauseClicked(stream: Snapcast.Stream) {
    props.snapcontrol.control(stream.id, stream.properties.playbackStatus === 'playing' ? 'pause' : 'play');
  }

  const clients = getClients();
  if (clients.length === 0) return null;

  const groupName = props.group.name || 'group';
  const stream = props.server.getStream(props.group.stream_id);
  const metadata = stream?.properties.metadata;
  const title = metadata?.title || 'Unknown Title';
  const artist = metadata?.artist ? metadata.artist.join(', ') : 'Unknown Artist';
  const hasDuration = metadata?.duration !== undefined && metadata.duration > 0;
  const isPlaying = stream?.properties.playbackStatus === 'playing';
  // A stream without playback control still reports whether audio is coming in
  const isActive = isPlaying || stream?.status === 'playing';

  const controls = stream?.properties.canControl && (
    <div className="transport d-flex align-items-center gap-1">
      <button
        type="button"
        className="btn btn-ghost btn-icon"
        aria-label="Previous"
        onClick={() => props.snapcontrol.control(stream.id, 'previous')}
      >
        <SkipBack size={18} fill="currentColor" />
      </button>
      <button
        type="button"
        className="btn btn-primary btn-icon btn-play"
        aria-label={isPlaying ? 'Pause' : 'Play'}
        onClick={() => handlePlayPauseClicked(stream)}
      >
        {isPlaying ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" />}
      </button>
      <button
        type="button"
        className="btn btn-ghost btn-icon"
        aria-label="Next"
        onClick={() => props.snapcontrol.control(stream.id, 'next')}
      >
        <SkipForward size={18} fill="currentColor" />
      </button>
    </div>
  );

  return (
    <section className="card group-card" aria-label={props.group.name || undefined}>
      <div className="card-body">
        <div className="group-heading d-flex align-items-center gap-2">
          <span className={'group-status' + (isActive ? ' playing' : '')} aria-hidden="true">
            <AudioLines size={16} />
          </span>
          <div className="flex-grow-1 overflow-hidden">
            {props.group.name && <div className="group-name text-truncate">{props.group.name}</div>}
            <div className="small text-body-secondary text-truncate">
              {clients.length} {clients.length === 1 ? 'client' : 'clients'}
              {stream && (isActive ? ' · Playing' : ' · Idle')}
            </div>
          </div>
          <Dropdown align="end" className="stream-picker">
            <Dropdown.Toggle
              variant=""
              className="stream-toggle"
              aria-label={'Active stream: ' + props.group.stream_id}
            >
              <Radio size={14} aria-hidden="true" />
              <span className="text-truncate">{props.group.stream_id}</span>
            </Dropdown.Toggle>
            <Dropdown.Menu className="stream-menu">
              {props.server.streams.map((option) => {
                const selected = option.id === props.group.stream_id;
                return (
                  <Dropdown.Item
                    key={option.id}
                    as="button"
                    className="text-truncate"
                    active={selected}
                    aria-current={selected || undefined}
                    onClick={() => props.snapcontrol.setStream(props.group.id, option.id)}
                  >
                    {option.id}
                  </Dropdown.Item>
                );
              })}
            </Dropdown.Menu>
          </Dropdown>
        </div>

        {metadata ? (
          <div className="now-playing mt-3">
            <div className="d-flex flex-column flex-sm-row align-items-center gap-3">
              <div className="flex-grow-1 overflow-hidden align-self-stretch align-self-sm-auto text-start">
                <div className="track-title text-truncate">{title}</div>
                <div className="text-body-secondary text-truncate">{artist}</div>
                {(hasDuration || metadata.url) && (
                  <dl className="track-meta small text-body-secondary mb-0 mt-1">
                    {hasDuration && (
                      <>
                        <dt>
                          <Clock size={14} role="img" aria-label="Duration" />
                        </dt>
                        <dd>{formatDuration(metadata.duration!)}</dd>
                      </>
                    )}
                    {metadata.url && (
                      <>
                        <dt>
                          <FolderOpen size={14} role="img" aria-label="Path" />
                        </dt>
                        <dd>{metadata.url}</dd>
                      </>
                    )}
                  </dl>
                )}
              </div>
              {controls}
            </div>
          </div>
        ) : (
          controls && <div className="mt-3 d-flex justify-content-center">{controls}</div>
        )}

        {clients.length > 1 && (
          <div className="group-volume mt-3">
            <div className="section-label mb-0 ps-1">Group volume</div>
            <VolumeControl
              label={groupName}
              volume={getVolume()}
              muted={props.group.muted}
              onMuteClick={handleMuteClicked}
              onChange={handleVolumeChange}
              onChangeEnd={() => {
                volumeDrag.current = null;
              }}
            />
          </div>
        )}
      </div>

      <ul className="list-group list-group-flush border-top">
        {clients.map((client) => (
          <Client key={client.id} client={client} snapcontrol={props.snapcontrol} onVolumeChange={refresh} />
        ))}
      </ul>
    </section>
  );
}
