import { Fragment, useState, type ReactNode } from 'react';
import { Accordion, Button, Form, InputGroup, Tab, Tabs } from 'react-bootstrap';
import {
  Boxes,
  Check,
  LogOut,
  Monitor,
  Moon,
  Plus,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Speaker,
  Sun,
  Trash2,
  type LucideIcon,
} from 'lucide-react';
import Dialog from './Dialog';
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
  // Called as the theme is picked, so it shows before OK; on Cancel the
  // saved theme is shown again
  onThemeChange?: (theme: Theme) => void;
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
      <SettingsSection title="Connection">
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
          <div className="settings-row">
            <span className="d-inline-flex align-items-center gap-2 small text-body-secondary">
              <ShieldCheck size={16} className="text-success" aria-hidden="true" />
              Logged in to the control API
            </span>
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
      </SettingsSection>
      <SettingsSection title="Appearance">
        <Form.Label as="div" id="settings-theme">
          Theme
        </Form.Label>
        <div className="segmented" role="radiogroup" aria-labelledby="settings-theme">
          {themes.map(({ value, label, icon: Icon }) => (
            <label key={value} className="segmented-option">
              <input
                type="radio"
                name="settings-theme"
                value={value}
                checked={theme === value}
                onChange={() => {
                  setTheme(value);
                  props.onThemeChange?.(value);
                }}
              />
              <Icon size={16} aria-hidden="true" />
              {label}
            </label>
          ))}
        </div>
        <div className="settings-row">
          <div>
            <label htmlFor="settings-show-offline" className="fw-medium">
              Show offline clients
            </label>
            <div id="settings-show-offline-hint" className="small text-body-secondary">
              List clients that aren't connected
            </div>
          </div>
          <div className="form-check form-switch m-0">
            <input
              className="form-check-input"
              type="checkbox"
              role="switch"
              id="settings-show-offline"
              aria-describedby="settings-show-offline-hint"
              checked={showOffline}
              onChange={(event) => setShowOffline(event.target.checked)}
            />
          </div>
        </div>
      </SettingsSection>
    </>
  );

  const groupSettings = groups.map((group, index) => {
    const idPrefix = 'settings-group-' + group.id;
    const memberCount = visibleClients.filter((client) => groupIds[client.id] === group.id).length;
    return (
      <div key={group.id} className="settings-card" role="group" aria-labelledby={idPrefix + '-name'}>
        <div className="d-flex align-items-center gap-3">
          <span className="settings-avatar" aria-hidden="true">
            <Boxes size={18} />
          </span>
          <div className="flex-grow-1 overflow-hidden">
            <div id={idPrefix + '-name'} className="fw-semibold text-truncate">
              {groupLabel(group, index)}
            </div>
            <div className="small text-body-secondary">
              {memberCount} {memberCount === 1 ? 'client' : 'clients'}
            </div>
          </div>
          <Form.Select
            size="sm"
            className="settings-stream"
            aria-label="Stream"
            value={streamIds[group.id]}
            onChange={(event) => setStreamIds((ids) => ({ ...ids, [group.id]: event.target.value }))}
          >
            {props.server.streams.map((stream) => (
              <option key={stream.id} value={stream.id}>
                {stream.id}
              </option>
            ))}
          </Form.Select>
        </div>
        <div className="chip-list">
          {visibleClients.map((client) => {
            const checked = groupIds[client.id] === group.id;
            const id = idPrefix + '-client-' + client.id;
            return (
              <Fragment key={client.id}>
                <input
                  className="btn-check"
                  type="checkbox"
                  id={id}
                  checked={checked}
                  onChange={(event) => handleGroupClientChange(client.id, group.id, event.target.checked)}
                />
                <label className="chip" htmlFor={id}>
                  {checked ? <Check size={14} aria-hidden="true" /> : <Plus size={14} aria-hidden="true" />}
                  <span className="text-truncate">{client.getName()}</span>
                  {!client.connected && (
                    // Hidden from the checkbox's name, which is the client name
                    <span className="status-dot" title="offline" aria-hidden="true" />
                  )}
                </label>
              </Fragment>
            );
          })}
        </div>
      </div>
    );
  });

  const clientSettings = (
    <Accordion alwaysOpen className="client-accordion">
      {visibleClients.map((client) => {
        const edit = clientEdits[client.id];
        const idPrefix = 'settings-client-' + client.id;
        const readOnlyFields: [string, string][] = [
          ['Host', client.host.name],
          ['IP', client.host.ip],
          ['MAC', client.host.mac],
          ['OS', client.host.os],
          ['Client', client.snapclient.name + ' ' + client.snapclient.version],
          ['ID', client.id],
        ];
        return (
          <Accordion.Item key={client.id} eventKey={client.id}>
            <Accordion.Header>
              <span className={'settings-avatar' + (client.connected ? '' : ' offline')} aria-hidden="true">
                <Speaker size={18} />
              </span>
              <span className="flex-grow-1 overflow-hidden text-start">
                <span className="d-block fw-semibold text-truncate">{client.getName()}</span>
                {/* Repeats the details below, so hidden from the button's name */}
                <span className="d-flex align-items-center gap-2 small text-body-secondary" aria-hidden="true">
                  <span className={'status-dot' + (client.connected ? ' online' : '')} />
                  <span className="text-truncate">
                    {client.connected ? 'Online' : 'Offline'} · {client.host.ip}
                  </span>
                </span>
              </span>
            </Accordion.Header>
            <Accordion.Body role="group" aria-label={client.getName()}>
              <div className="client-fields">
                <Form.Group controlId={idPrefix + '-name'}>
                  <Form.Label>Name</Form.Label>
                  <Form.Control
                    type="text"
                    spellCheck={false}
                    placeholder={client.host.name}
                    value={edit.name}
                    onChange={(event) => updateClientEdit(client.id, { name: event.target.value })}
                  />
                </Form.Group>
                <Form.Group controlId={idPrefix + '-latency'}>
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
              </div>
              <div className="detail-grid">
                {readOnlyFields.map(([label, value]) => (
                  <Form.Group key={label} className="detail" controlId={idPrefix + '-' + label}>
                    <Form.Label>{label}</Form.Label>
                    <Form.Control plaintext readOnly value={value} title={value} />
                  </Form.Group>
                ))}
              </div>
              {!client.connected && (
                <div className="settings-row">
                  <span className="small text-body-secondary">Offline clients can be removed from the server</span>
                  <Button
                    variant="outline-danger"
                    size="sm"
                    className="d-inline-flex align-items-center gap-2 flex-shrink-0"
                    onClick={() => props.onClientDelete(client)}
                  >
                    <Trash2 size={16} aria-hidden="true" />
                    Delete
                  </Button>
                </div>
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
      className="settings-dialog"
      onClose={handleClose}
    >
      <Tabs defaultActiveKey="general" variant="pills" fill className="settings-tabs">
        <Tab eventKey="general" title={<TabTitle icon={SlidersHorizontal} label="General" />}>
          {general}
        </Tab>
        <Tab eventKey="groups" title={<TabTitle icon={Boxes} label="Groups" />} disabled={groups.length === 0}>
          <div className="settings-stack">{groupSettings}</div>
        </Tab>
        <Tab
          eventKey="clients"
          title={<TabTitle icon={Speaker} label="Clients" />}
          disabled={visibleClients.length === 0}
        >
          {clientSettings}
        </Tab>
      </Tabs>
    </Dialog>
  );
}

function TabTitle(props: { icon: LucideIcon; label: string }) {
  const Icon = props.icon;
  return (
    <span className="d-inline-flex align-items-center justify-content-center gap-2">
      <Icon size={16} aria-hidden="true" />
      {props.label}
    </span>
  );
}

// A titled card of settings
function SettingsSection(props: { title: string; children: ReactNode }) {
  return (
    <section className="settings-section" aria-label={props.title}>
      <h6 className="section-label">{props.title}</h6>
      <div className="settings-card">{props.children}</div>
    </section>
  );
}
