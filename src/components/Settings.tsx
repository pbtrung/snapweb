import { useState } from 'react';
import { Form, ToggleButton, ToggleButtonGroup } from 'react-bootstrap';
import { Monitor, Moon, Settings, Sun } from 'lucide-react';
import Dialog, { DialogSection } from './Dialog';
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
    </Dialog>
  );
}
