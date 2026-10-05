import { useState } from 'react';
import { Button, Form, Modal, ToggleButton, ToggleButtonGroup } from 'react-bootstrap';
import { Monitor, Moon, Sun } from 'lucide-react';
import { config, Theme } from '../config';

const themes = [
  { value: Theme.System, label: 'System', icon: Monitor },
  { value: Theme.Light, label: 'Light', icon: Sun },
  { value: Theme.Dark, label: 'Dark', icon: Moon },
];

export default function SettingsDialog(props: { open: boolean; onClose: (_apply: boolean) => void }) {
  const [serverurl, setServerurl] = useState(config.baseUrl);
  const [theme, setTheme] = useState(config.theme);
  const [showOffline, setShowOffline] = useState(config.showOffline);

  function handleClose(apply: boolean) {
    if (apply) {
      config.baseUrl = serverurl;
      config.theme = theme;
      config.showOffline = showOffline;
    }
    props.onClose(apply);
  }

  return (
    <Modal show={props.open} onHide={() => handleClose(false)} centered aria-labelledby="settings-title">
      <Modal.Header closeButton>
        <Modal.Title id="settings-title" as="h5">
          Settings
        </Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <Form.Group className="mb-4" controlId="settings-host">
          <Form.Label className="fw-semibold">Snapserver host</Form.Label>
          <Form.Control
            autoFocus
            type="text"
            spellCheck={false}
            placeholder="ws://host:1780"
            value={serverurl}
            onChange={(event) => setServerurl(event.target.value)}
          />
        </Form.Group>
        <Form.Group className="mb-4">
          <Form.Label as="div" id="settings-theme" className="fw-semibold">
            Theme
          </Form.Label>
          <ToggleButtonGroup
            type="radio"
            name="theme"
            className="w-100"
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
      </Modal.Body>
      <Modal.Footer className="justify-content-between">
        <small className="text-body-secondary">
          {import.meta.env.VITE_APP_NAME} {import.meta.env.VITE_APP_VERSION}
        </small>
        <div className="d-flex gap-2">
          <Button variant="outline-secondary" onClick={() => handleClose(false)}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => handleClose(true)}>
            OK
          </Button>
        </div>
      </Modal.Footer>
    </Modal>
  );
}
