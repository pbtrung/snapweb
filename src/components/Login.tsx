import { useState, type KeyboardEvent } from 'react';
import { Alert, Form } from 'react-bootstrap';
import { LogIn } from 'lucide-react';
import Dialog from './Dialog';

type LoginDialogProps = {
  open: boolean;
  // Rejects with a message for the user when the login fails
  onLogin: (username: string, password: string, remember: boolean) => Promise<void>;
  onCancel: () => void;
};

// Asks for the user name and password the Snapserver control API wants
export default function LoginDialog(props: LoginDialogProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await props.onLogin(username, password, remember);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function handleClose(apply: boolean) {
    if (apply) void submit();
    else props.onCancel();
  }

  // The fields aren't in a form with a submit button, so handle Enter here
  function handleKeyDown(event: KeyboardEvent) {
    if (event.key === 'Enter' && event.target instanceof HTMLInputElement) {
      event.preventDefault();
      void submit();
    }
  }

  return (
    <Dialog
      show={props.open}
      id="login"
      title="Log in"
      icon={LogIn}
      okLabel="Log in"
      okDisabled={busy}
      onClose={handleClose}
    >
      <div className="dialog-section" onKeyDown={handleKeyDown}>
        <p className="text-body-secondary">This Snapserver needs a login to be controlled.</p>
        {error && (
          <Alert variant="danger" className="py-2">
            {error}
          </Alert>
        )}
        <Form.Group className="mb-3" controlId="login-username">
          <Form.Label>User name</Form.Label>
          <Form.Control
            autoFocus
            type="text"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            value={username}
            onChange={(event) => setUsername(event.target.value)}
          />
        </Form.Group>
        <Form.Group className="mb-3" controlId="login-password">
          <Form.Label>Password</Form.Label>
          <Form.Control
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </Form.Group>
        <Form.Check
          type="checkbox"
          id="login-remember"
          label="Remember me"
          checked={remember}
          onChange={(event) => setRemember(event.target.checked)}
        />
      </div>
    </Dialog>
  );
}
