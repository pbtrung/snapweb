import { useRef, useState } from 'react';
import { Form } from 'react-bootstrap';
import { Clock, FolderOpen, Pause, Play, Settings2, SkipBack, SkipForward } from 'lucide-react';
import Client from './Client';
import Dialog, { DialogSection } from './Dialog';
import VolumeControl from './VolumeControl';
import { SnapControl, Snapcast } from '../snapcontrol';

type GroupClient = {
  client: Snapcast.Client;
  inGroup: boolean;
  wasInGroup: boolean;
};

type GroupProps = {
  server: Snapcast.Server;
  group: Snapcast.Group;
  snapcontrol: SnapControl;
  showOffline: boolean;
  // Clients waiting for their delete to be undone or carried out, hidden here
  deletedClientIds: string[];
  onClientDelete: (client: Snapcast.Client) => void;
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
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsClients, setSettingsClients] = useState<GroupClient[]>([]);
  const [settingsStreamId, setSettingsStreamId] = useState('');
  // Cover art that failed to load, which is hidden like a missing one
  const [brokenArtUrl, setBrokenArtUrl] = useState('');
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

  function handleSettingsClicked() {
    setSettingsClients(
      props.server.groups.flatMap((group) =>
        group.clients.map((client) => {
          const inGroup = props.group.clients.includes(client);
          return { client, inGroup, wasInGroup: inGroup };
        }),
      ),
    );
    setSettingsStreamId(props.group.stream_id);
    setSettingsOpen(true);
  }

  function handleSettingsClose(apply: boolean) {
    if (apply) {
      if (settingsClients.some((element) => element.inGroup !== element.wasInGroup))
        props.snapcontrol.setClients(
          props.group.id,
          settingsClients.filter((element) => element.inGroup).map((element) => element.client.id),
        );
      if (props.group.stream_id !== settingsStreamId) props.snapcontrol.setStream(props.group.id, settingsStreamId);
    }
    setSettingsOpen(false);
  }

  function handleGroupClientChange(client: Snapcast.Client, inGroup: boolean) {
    setSettingsClients(
      settingsClients.map((element) => (element.client === client ? { ...element, inGroup } : element)),
    );
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
  const idPrefix = 'group-' + props.group.id;

  return (
    <section className="card group-card">
      <div className="card-body">
        <div className="d-flex align-items-center gap-2">
          <Form.Select
            size="sm"
            className="stream-select"
            aria-label="Active stream"
            value={props.group.stream_id}
            onChange={(event) => props.snapcontrol.setStream(props.group.id, event.target.value)}
          >
            {props.server.streams.map((stream) => (
              <option key={stream.id} value={stream.id}>
                {stream.id}
              </option>
            ))}
          </Form.Select>
          <div className="flex-grow-1" />
          {stream?.properties.canControl && (
            <div className="d-flex align-items-center gap-1">
              <button
                type="button"
                className="btn btn-ghost btn-icon"
                aria-label="Previous"
                onClick={() => props.snapcontrol.control(stream.id, 'previous')}
              >
                <SkipBack size={18} />
              </button>
              <button
                type="button"
                className="btn btn-primary btn-icon"
                aria-label={isPlaying ? 'Pause' : 'Play'}
                onClick={() => handlePlayPauseClicked(stream)}
              >
                {isPlaying ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" />}
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-icon"
                aria-label="Next"
                onClick={() => props.snapcontrol.control(stream.id, 'next')}
              >
                <SkipForward size={18} />
              </button>
            </div>
          )}
          <button
            type="button"
            className="btn btn-ghost btn-icon"
            aria-label={'Settings for ' + groupName}
            onClick={handleSettingsClicked}
          >
            <Settings2 size={20} />
          </button>
        </div>

        {metadata && (
          <div className="now-playing d-flex flex-column flex-sm-row align-items-center gap-3 mt-3">
            {metadata.artUrl && metadata.artUrl !== brokenArtUrl && (
              <img
                className="cover-art"
                src={metadata.artUrl}
                alt={title + ' cover'}
                // Unreachable cover art, e.g. a URL only the server can resolve
                onError={() => setBrokenArtUrl(metadata.artUrl!)}
              />
            )}
            <div className="flex-grow-1 overflow-hidden align-self-stretch align-self-sm-auto">
              <div className="fw-semibold text-truncate">{title}</div>
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
          </div>
        )}

        {clients.length > 1 && (
          <div className="mt-3">
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
          <Client
            key={client.id}
            client={client}
            snapcontrol={props.snapcontrol}
            onDelete={() => props.onClientDelete(client)}
            onVolumeChange={refresh}
          />
        ))}
      </ul>

      <Dialog show={settingsOpen} id={idPrefix} title="Group settings" icon={Settings2} onClose={handleSettingsClose}>
        <DialogSection title="Stream">
          <Form.Group controlId={idPrefix + '-stream'}>
            <Form.Label visuallyHidden>Stream</Form.Label>
            <Form.Select value={settingsStreamId} onChange={(event) => setSettingsStreamId(event.target.value)}>
              {props.server.streams.map((stream) => (
                <option key={stream.id} value={stream.id}>
                  {stream.id}
                </option>
              ))}
            </Form.Select>
          </Form.Group>
        </DialogSection>
        <DialogSection title="Clients">
          <div className="list-group check-list">
            {settingsClients.map((element) => (
              <label key={element.client.id} className="list-group-item d-flex align-items-center gap-3">
                <input
                  className="form-check-input m-0 flex-shrink-0"
                  type="checkbox"
                  checked={element.inGroup}
                  onChange={(event) => handleGroupClientChange(element.client, event.target.checked)}
                />
                <span className="text-truncate">{element.client.getName()}</span>
                {!element.client.connected && (
                  // Hidden from the checkbox's name, which is the client name
                  <span className="badge rounded-pill text-bg-secondary fw-normal ms-auto" aria-hidden="true">
                    offline
                  </span>
                )}
              </label>
            ))}
          </div>
        </DialogSection>
      </Dialog>
    </section>
  );
}
