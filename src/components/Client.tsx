import { useState } from 'react';
import { Button, Form, InputGroup } from 'react-bootstrap';
import { EllipsisVertical, Speaker, Trash2 } from 'lucide-react';
import { SnapControl, Snapcast } from '../snapcontrol';
import Dialog, { DialogSection } from './Dialog';
import VolumeControl from './VolumeControl';

type ClientProps = {
  client: Snapcast.Client;
  snapcontrol: SnapControl;
  onDelete: () => void;
  onVolumeChange: () => void;
};

export default function Client(props: ClientProps) {
  const client = props.client;
  const [, setUpdate] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [name, setName] = useState(client.config.name);
  // The latency is applied live while editing, and restored on Cancel. The
  // field keeps what was typed, so it can be cleared or start with "-"
  // without snapping to 0; only valid numbers are sent.
  const [latencyText, setLatencyText] = useState(String(client.config.latency));
  const [latency, setLatency] = useState(client.config.latency);
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

  function handleSettingsClicked() {
    setName(client.config.name);
    setLatencyText(String(client.config.latency));
    setLatency(client.config.latency);
    setSettingsOpen(true);
  }

  function handleDeleteClicked() {
    handleSettingsClose(false);
    props.onDelete();
  }

  function handleSettingsClose(apply: boolean) {
    setSettingsOpen(false);
    if (apply) {
      props.snapcontrol.setClientName(client.id, name);
      // The last valid latency was already applied while editing
      setLatency(client.config.latency);
    } else {
      props.snapcontrol.setClientLatency(client.id, latency);
    }
    setLatencyText(String(apply ? client.config.latency : latency));
    setName(client.config.name);
  }

  function handleLatencyChange(text: string) {
    setLatencyText(text);
    const value = Number(text);
    if (text.trim() !== '' && Number.isFinite(value)) props.snapcontrol.setClientLatency(client.id, Math.round(value));
  }

  const readOnlyFields: [string, string][] = [
    ['Client', client.snapclient.name + ' ' + client.snapclient.version],
    ['MAC', client.host.mac],
    ['ID', client.id],
    ['IP', client.host.ip],
    ['Host', client.host.name],
    ['OS', client.host.os],
  ];
  const idPrefix = 'client-' + client.id;

  return (
    <li className="list-group-item client-row" style={{ opacity: client.connected ? 1.0 : 0.5 }}>
      <div className="d-flex align-items-center gap-2">
        <div className="flex-grow-1" style={{ minWidth: 0 }}>
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
        </div>
        <button
          type="button"
          className="btn btn-ghost btn-icon"
          aria-label={'Settings for ' + displayName}
          onClick={handleSettingsClicked}
        >
          <EllipsisVertical size={20} />
        </button>
      </div>
      <Dialog
        show={settingsOpen}
        id={idPrefix}
        title="Client settings"
        icon={Speaker}
        onClose={handleSettingsClose}
        footerStart={
          !client.connected && (
            <Button
              variant="outline-danger"
              className="d-inline-flex align-items-center gap-2"
              onClick={handleDeleteClicked}
            >
              <Trash2 size={16} aria-hidden="true" />
              Delete
            </Button>
          )
        }
      >
        <DialogSection title="General">
          <Form.Group className="mb-3" controlId={idPrefix + '-name'}>
            <Form.Label>Name</Form.Label>
            <Form.Control
              autoFocus
              type="text"
              spellCheck={false}
              placeholder={client.host.name}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </Form.Group>
          <Form.Group controlId={idPrefix + '-latency'}>
            <Form.Label>Latency</Form.Label>
            <InputGroup>
              <Form.Control
                type="number"
                value={latencyText}
                onChange={(event) => handleLatencyChange(event.target.value)}
              />
              <InputGroup.Text>ms</InputGroup.Text>
            </InputGroup>
          </Form.Group>
        </DialogSection>
        <DialogSection title="Details">
          <div className="info-list">
            {readOnlyFields.map(([label, value]) => (
              <Form.Group key={label} className="info-row" controlId={idPrefix + '-' + label}>
                <Form.Label>{label}</Form.Label>
                <Form.Control plaintext readOnly value={value} />
              </Form.Group>
            ))}
          </div>
        </DialogSection>
      </Dialog>
    </li>
  );
}
