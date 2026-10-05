import { useState } from 'react';
import { Button, Col, Form, InputGroup, Modal, Row } from 'react-bootstrap';
import { EllipsisVertical, Trash2 } from 'lucide-react';
import { SnapControl, Snapcast } from '../snapcontrol';
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
  // The latency is applied live while editing, and restored on Cancel
  const [tmpLatency, setTmpLatency] = useState(client.config.latency);
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
    setTmpLatency(client.config.latency);
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
      props.snapcontrol.setClientLatency(client.id, tmpLatency);
      setLatency(tmpLatency);
    } else {
      props.snapcontrol.setClientLatency(client.id, latency);
      setTmpLatency(latency);
    }
    setName(client.config.name);
  }

  function handleLatencyChange(value: number) {
    setTmpLatency(value);
    props.snapcontrol.setClientLatency(client.id, value);
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
    <li className="list-group-item px-3 py-2" style={{ opacity: client.connected ? 1.0 : 0.5 }}>
      <div className="d-flex align-items-center gap-2">
        <div className="flex-grow-1" style={{ minWidth: 0 }}>
          <div className="d-flex align-items-center gap-2 ps-1">
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
      <Modal
        show={settingsOpen}
        onHide={() => handleSettingsClose(false)}
        centered
        aria-labelledby={idPrefix + '-title'}
      >
        <Modal.Header closeButton>
          <Modal.Title id={idPrefix + '-title'} as="h5">
            Client settings
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
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
          <Form.Group className="mb-3" controlId={idPrefix + '-latency'}>
            <Form.Label>Latency</Form.Label>
            <InputGroup>
              <Form.Control
                type="number"
                value={tmpLatency}
                onChange={(event) => handleLatencyChange(Number(event.target.value) || 0)}
              />
              <InputGroup.Text>ms</InputGroup.Text>
            </InputGroup>
          </Form.Group>
          <div className="border-top pt-2">
            {readOnlyFields.map(([label, value]) => (
              <Form.Group as={Row} key={label} className="g-2" controlId={idPrefix + '-' + label}>
                <Form.Label column xs={3} className="text-body-secondary small">
                  {label}
                </Form.Label>
                <Col xs={9}>
                  <Form.Control plaintext readOnly className="small font-monospace" value={value} />
                </Col>
              </Form.Group>
            ))}
          </div>
        </Modal.Body>
        <Modal.Footer>
          {!client.connected && (
            <Button
              variant="outline-danger"
              className="me-auto d-inline-flex align-items-center gap-2"
              onClick={handleDeleteClicked}
            >
              <Trash2 size={16} aria-hidden="true" />
              Delete
            </Button>
          )}
          <Button variant="outline-secondary" onClick={() => handleSettingsClose(false)}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => handleSettingsClose(true)}>
            OK
          </Button>
        </Modal.Footer>
      </Modal>
    </li>
  );
}
