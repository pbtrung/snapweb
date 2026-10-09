import { useState } from 'react';
import { Accordion, Button, Form, InputGroup, Tab, Tabs, ToggleButton, ToggleButtonGroup } from 'react-bootstrap';
import { LogOut, Monitor, Moon, Settings, Sun, Trash2 } from 'lucide-react';
import Dialog, { DialogSection } from './Dialog';
import { config, Theme } from '../config';
import { SnapControl, Snapcast } from '../snapcontrol';

const themes = [
  { value: Theme.System, label: 'System', icon: Monitor },
  { value: Theme.Light, label: 'Light', icon: Sun },
  { value: Theme.Dark, label: 'Dark', icon: Moon },
];

type SettingsDialogProps = {
  open: boolean;
  onClose: (_apply: boolean) => void;
  server: Snapcast.Server;
  snapcontrol: SnapControl;
  // Clients waiting for their delete to be undone or carried out, hidden here
  deletedClientIds: string[];
  onClientDelete: (client: Snapcast.Client) => void;
  // Whether a control API login is held, which onLogout forgets
  loggedIn?: boolean;
  onLogout?: () => void;
};

// A client's edits. The latency is applied live while editing, and restored
// on Cancel. The field keeps what was typed, so it can be cleared or start
// with "-" without snapping to 0; only valid numbers are sent.
type ClientEdit = {
  name: string;
  latencyText: string;
  // As it was when the dialog opened
  initialName: string;
  initialLatency: number;
};

function groupLabel(group: Snapcast.Group, index: number): string {
  return group.name || 'Group ' + (index + 1);
}

// The app, group and client settings in one dialog. It is mounted only
// while open, so it starts from the saved settings and the current server
// state each time.
export default function SettingsDialog(props: SettingsDialogProps) {
  const [serverurl, setServerurl] = useState(config.baseUrl);
  const [theme, setTheme] = useState(config.theme);
  const [showOffline, setShowOffline] = useState(config.showOffline);
  const [groups] = useState(() => props.server.groups);
  const [clients] = useState(() => groups.flatMap((group) => group.clients));
  const [initialStreamIds] = useState<Record<string, string>>(() =>
    Object.fromEntries(groups.map((group) => [group.id, group.stream_id])),
  );
  const [streamIds, setStreamIds] = useState(initialStreamIds);
  // The group each client is in, or null for one taken out of its group,
  // which Snapserver then puts in a group of its own
  const [initialGroupIds] = useState<Record<string, string | null>>(() =>
    Object.fromEntries(groups.flatMap((group) => group.clients.map((client) => [client.id, group.id]))),
  );
  const [groupIds, setGroupIds] = useState(initialGroupIds);
  const [clientEdits, setClientEdits] = useState<Record<string, ClientEdit>>(() =>
    Object.fromEntries(
      clients.map((client) => [
        client.id,
        {
          name: client.config.name,
          latencyText: String(client.config.latency),
          initialName: client.config.name,
          initialLatency: client.config.latency,
        },
      ]),
    ),
  );

  const visibleClients = clients.filter((client) => !props.deletedClientIds.includes(client.id));

  // A client may have been deleted from the model while the dialog was open
  function exists(clientId: string): boolean {
    try {
      props.snapcontrol.getClient(clientId);
      return true;
    } catch {
      return false;
    }
  }

  function applyGroups() {
    for (const group of groups) {
      if (streamIds[group.id] !== initialStreamIds[group.id])
        props.snapcontrol.setStream(group.id, streamIds[group.id]);
    }
    // Adding a client to a group takes it out of its old group, so a group
    // that only lost clients to other groups needs no request of its own.
    // Groups gaining clients go first, so a group that only had clients
    // taken out still exists when its turn comes.
    const requests = groups.flatMap((group) => {
      const members = clients.filter((client) => groupIds[client.id] === group.id && exists(client.id));
      const gains = members.some((client) => initialGroupIds[client.id] !== group.id);
      const takenOut = clients.some(
        (client) => initialGroupIds[client.id] === group.id && groupIds[client.id] === null && exists(client.id),
      );
      return gains || takenOut ? [{ group, members, gains }] : [];
    });
    requests.sort((a, b) => Number(b.gains) - Number(a.gains));
    for (const { group, members } of requests)
      props.snapcontrol.setClients(
        group.id,
        members.map((client) => client.id),
      );
  }

  function applyClients(apply: boolean) {
    for (const [clientId, edit] of Object.entries(clientEdits)) {
      if (!exists(clientId)) continue;
      // The last valid latency was already applied while editing
      if (!apply) props.snapcontrol.setClientLatency(clientId, edit.initialLatency);
      else if (edit.name !== edit.initialName) props.snapcontrol.setClientName(clientId, edit.name);
    }
  }

  function handleClose(apply: boolean) {
    if (apply) {
      config.baseUrl = serverurl;
      config.theme = theme;
      config.showOffline = showOffline;
      applyGroups();
    }
    applyClients(apply);
    props.onClose(apply);
  }

  function handleGroupClientChange(clientId: string, groupId: string, inGroup: boolean) {
    setGroupIds((ids) => ({
      ...ids,
      [clientId]: inGroup ? groupId : ids[clientId] === groupId ? null : ids[clientId],
    }));
  }

  function updateClientEdit(clientId: string, change: Partial<ClientEdit>) {
    setClientEdits((edits) => ({ ...edits, [clientId]: { ...edits[clientId], ...change } }));
  }

  function handleLatencyChange(clientId: string, text: string) {
    updateClientEdit(clientId, { latencyText: text });
    const value = Number(text);
    if (text.trim() !== '' && Number.isFinite(value) && exists(clientId))
      props.snapcontrol.setClientLatency(clientId, Math.round(value));
  }

  const general = (
    <>
      <DialogSection title="Connection">
        <Form.Group controlId="settings-host">
          <Form.Label>Snapserver host</Form.Label>
          <Form.Control
            autoFocus
            type="text"
            spellCheck={false}
            placeholder="ws://host:1780"
            value={serverurl}
            onChange={(event) => setServerurl(event.target.value)}
          />
        </Form.Group>
        {props.loggedIn && (
          <div className="d-flex align-items-center justify-content-between gap-3 mt-3">
            <span className="small text-body-secondary">Logged in to the control API</span>
            <Button
              variant="outline-danger"
              size="sm"
              className="d-inline-flex align-items-center gap-2"
              onClick={props.onLogout}
            >
              <LogOut size={16} aria-hidden="true" />
              Log out
            </Button>
          </div>
        )}
      </DialogSection>
      <DialogSection title="Appearance">
        <Form.Group className="mb-3">
          <Form.Label as="div" id="settings-theme">
            Theme
          </Form.Label>
          <ToggleButtonGroup
            type="radio"
            name="theme"
            className="segmented w-100"
            aria-labelledby="settings-theme"
            value={theme}
            onChange={(value: Theme) => setTheme(value)}
          >
            {themes.map(({ value, label, icon: Icon }) => (
              <ToggleButton
                key={value}
                id={'settings-theme-' + value}
                value={value}
                variant="outline-primary"
                className="d-inline-flex align-items-center justify-content-center gap-2"
              >
                <Icon size={16} aria-hidden="true" />
                {label}
              </ToggleButton>
            ))}
          </ToggleButtonGroup>
        </Form.Group>
        <Form.Check
          type="switch"
          id="settings-show-offline"
          label="Show offline clients"
          checked={showOffline}
          onChange={(event) => setShowOffline(event.target.checked)}
        />
      </DialogSection>
    </>
  );

  const groupSettings = groups.map((group, index) => {
    const idPrefix = 'settings-group-' + group.id;
    return (
      <DialogSection key={group.id} title={groupLabel(group, index)}>
        <Form.Group className="mb-3" controlId={idPrefix + '-stream'}>
          <Form.Label>Stream</Form.Label>
          <Form.Select
            value={streamIds[group.id]}
            onChange={(event) => setStreamIds((ids) => ({ ...ids, [group.id]: event.target.value }))}
          >
            {props.server.streams.map((stream) => (
              <option key={stream.id} value={stream.id}>
                {stream.id}
              </option>
            ))}
          </Form.Select>
        </Form.Group>
        <Form.Label as="div" id={idPrefix + '-clients'}>
          Clients
        </Form.Label>
        <div className="list-group check-list" role="group" aria-labelledby={idPrefix + '-clients'}>
          {visibleClients.map((client) => (
            <label key={client.id} className="list-group-item d-flex align-items-center gap-3">
              <input
                className="form-check-input m-0 flex-shrink-0"
                type="checkbox"
                checked={groupIds[client.id] === group.id}
                onChange={(event) => handleGroupClientChange(client.id, group.id, event.target.checked)}
              />
              <span className="text-truncate">{client.getName()}</span>
              {!client.connected && (
                // Hidden from the checkbox's name, which is the client name
                <span className="badge rounded-pill text-bg-secondary fw-normal ms-auto" aria-hidden="true">
                  offline
                </span>
              )}
            </label>
          ))}
        </div>
      </DialogSection>
    );
  });

  const clientSettings = (
    <Accordion alwaysOpen className="client-accordion">
      {visibleClients.map((client) => {
        const edit = clientEdits[client.id];
        const idPrefix = 'settings-client-' + client.id;
        const readOnlyFields: [string, string][] = [
          ['Client', client.snapclient.name + ' ' + client.snapclient.version],
          ['MAC', client.host.mac],
          ['ID', client.id],
          ['IP', client.host.ip],
          ['Host', client.host.name],
          ['OS', client.host.os],
        ];
        return (
          <Accordion.Item key={client.id} eventKey={client.id}>
            <Accordion.Header>
              <span className="text-truncate">{client.getName()}</span>
              {!client.connected && (
                <span className="badge rounded-pill text-bg-secondary fw-normal ms-2" aria-hidden="true">
                  offline
                </span>
              )}
            </Accordion.Header>
            <Accordion.Body role="group" aria-label={client.getName()}>
              <Form.Group className="mb-3" controlId={idPrefix + '-name'}>
                <Form.Label>Name</Form.Label>
                <Form.Control
                  type="text"
                  spellCheck={false}
                  placeholder={client.host.name}
                  value={edit.name}
                  onChange={(event) => updateClientEdit(client.id, { name: event.target.value })}
                />
              </Form.Group>
              <Form.Group className="mb-3" controlId={idPrefix + '-latency'}>
                <Form.Label>Latency</Form.Label>
                <InputGroup>
                  <Form.Control
                    type="number"
                    value={edit.latencyText}
                    onChange={(event) => handleLatencyChange(client.id, event.target.value)}
                  />
                  <InputGroup.Text>ms</InputGroup.Text>
                </InputGroup>
              </Form.Group>
              <div className="info-list">
                {readOnlyFields.map(([label, value]) => (
                  <Form.Group key={label} className="info-row" controlId={idPrefix + '-' + label}>
                    <Form.Label>{label}</Form.Label>
                    <Form.Control plaintext readOnly value={value} />
                  </Form.Group>
                ))}
              </div>
              {!client.connected && (
                <Button
                  variant="outline-danger"
                  size="sm"
                  className="d-inline-flex align-items-center gap-2 mt-3"
                  onClick={() => props.onClientDelete(client)}
                >
                  <Trash2 size={16} aria-hidden="true" />
                  Delete
                </Button>
              )}
            </Accordion.Body>
          </Accordion.Item>
        );
      })}
    </Accordion>
  );

  return (
    <Dialog
      show={props.open}
      id="settings"
      title="Settings"
      icon={Settings}
      onClose={handleClose}
      footerStart={
        <small className="text-body-secondary">
          {import.meta.env.VITE_APP_NAME} {import.meta.env.VITE_APP_VERSION}
        </small>
      }
    >
      <Tabs defaultActiveKey="general" variant="underline" fill className="settings-tabs">
        <Tab eventKey="general" title="General">
          {general}
        </Tab>
        <Tab eventKey="groups" title="Groups" disabled={groups.length === 0}>
          {groupSettings}
        </Tab>
        <Tab eventKey="clients" title="Clients" disabled={visibleClients.length === 0}>
          {clientSettings}
        </Tab>
      </Tabs>
    </Dialog>
  );
}
