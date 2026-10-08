import { useState, useEffect, useRef, useSyncExternalStore } from 'react';
import { Alert, Button, Spinner } from 'react-bootstrap';
import { Play, Settings, Square } from 'lucide-react';
import Server from './Server';
import SettingsDialog from './Settings';
import LoginDialog from './Login';
import UndoDeleteNotice from './UndoDeleteNotice';
import { Theme, config, getClientId } from '../config';
import { SnapControl, Snapcast } from '../snapcontrol';
import type { SnapStream } from '../snapstream';
import logo from '../assets/logo192.png';
import silence from '../assets/10-seconds-of-silence.mp3';
import { updateMediaSession } from '../mediaSession';

const darkQuery = '(prefers-color-scheme: dark)';

function subscribeToColorScheme(onChange: () => void) {
  const query = window.matchMedia(darkQuery);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

function prefersDarkColorScheme() {
  return window.matchMedia(darkQuery).matches;
}

export default function SnapWeb() {
  const [, setUpdate] = useState(0);
  const [server, setServer] = useState(new Snapcast.Server());
  const [showOffline, setShowOffline] = useState(config.showOffline);
  const [theme, setTheme] = useState(config.theme);
  const [serverUrl, setServerUrl] = useState(config.baseUrl);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isConnected, setConnected] = useState(false);
  const [connectError, setConnectError] = useState('');
  // The server wants a login; the dialog asks for it, and once cancelled a
  // notice offers it again
  const [authRequired, setAuthRequired] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);
  // Kept here rather than in the groups, so a pending delete survives its
  // group being re-rendered, emptied or replaced by a server update
  const [deletedClients, setDeletedClients] = useState<{ id: string; name: string }[]>([]);
  const snapstreamRef = useRef<SnapStream | null>(null);
  const audioRef = useRef(new Audio());
  const handlersRef = useRef<{
    onChange: (server: Snapcast.Server) => void;
    onConnectionChanged: (connected: boolean, error?: string) => void;
    onAuthRequired: (required: boolean) => void;
  } | null>(null);
  const [snapControl] = useState(() => {
    const control = new SnapControl();
    control.onChange = (_control: SnapControl, server: Snapcast.Server) => handlersRef.current?.onChange(server);
    control.onConnectionChanged = (_control: SnapControl, connected: boolean, error?: string) =>
      handlersRef.current?.onConnectionChanged(connected, error);
    control.onAuthRequired = (_control: SnapControl, required: boolean) =>
      handlersRef.current?.onAuthRequired(required);
    return control;
  });

  const prefersDarkMode = useSyncExternalStore(subscribeToColorScheme, prefersDarkColorScheme);
  const colorScheme = theme == Theme.Dark || (theme == Theme.System && prefersDarkMode) ? 'dark' : 'light';

  useEffect(() => {
    document.documentElement.setAttribute('data-bs-theme', colorScheme);
  }, [colorScheme]);

  useEffect(() => {
    snapControl.connect(serverUrl);
    return () => snapControl.disconnect();
  }, [serverUrl, snapControl]);

  function getMyStreamId(): string {
    try {
      return snapControl.getGroupFromClient(getClientId()).stream_id;
    } catch {
      return '';
    }
  }

  function handleChange(snapserver: Snapcast.Server) {
    setServer(snapserver);
    // The model is updated in place, so a new render is needed even when
    // snapserver is the same object as before
    setUpdate((u) => u + 1);
    if (!snapstreamRef.current) return;
    try {
      updateMediaSession(snapControl, getMyStreamId(), audioRef.current);
    } catch (e) {
      console.debug('Failed to update the media session: ' + e);
    }
  }

  function handleConnectionChanged(connected: boolean, error?: string) {
    // The audio stream has its own connection and reconnects by itself, so
    // playback carries on while the control connection is re-established
    if (!connected) {
      setServer(new Snapcast.Server());
      // Kept while reconnecting, so a lost connection doesn't flicker
      // between the error and "Connecting..." on every retry
      if (error) setConnectError(error);
    } else {
      setConnectError('');
    }
    setConnected(connected);
  }

  // SnapControl reports changes only, so the dialog opens once per login
  // needed rather than on every reconnect
  function handleAuthRequired(required: boolean) {
    setAuthRequired(required);
    setLoginOpen(required);
  }

  // Refresh on every render so the SnapControl callbacks always see the latest state
  useEffect(() => {
    handlersRef.current = {
      onChange: handleChange,
      onConnectionChanged: handleConnectionChanged,
      onAuthRequired: handleAuthRequired,
    };
  });

  useEffect(() => {
    const audio = audioRef.current;
    if (!isPlaying) {
      snapstreamRef.current?.stop();
      snapstreamRef.current = null;
      audio.pause();
      audio.src = '';
      return;
    }
    // Looping silence keeps the page's media session alive while playing
    audio.src = silence;
    audio.loop = true;
    // The audio stream and its decoders are loaded on first use, which
    // keeps them out of the initial bundle
    let cancelled = false;
    Promise.all([audio.play(), import('../snapstream')])
      .then(([, { SnapStream }]) => {
        if (!cancelled) snapstreamRef.current = new SnapStream(config.baseUrl);
      })
      .catch((e) => {
        // e.g. the browser's autoplay policy rejected play()
        console.warn('Failed to start playback: ' + e);
        if (!cancelled) setIsPlaying(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isPlaying]);

  function handleClientDelete(client: Snapcast.Client) {
    setDeletedClients((clients) =>
      clients.some(({ id }) => id === client.id) ? clients : [...clients, { id: client.id, name: client.getName() }],
    );
  }

  function handleUndoDeleteClose(clientId: string, undo: boolean) {
    if (!undo) snapControl.deleteClient(clientId);
    setDeletedClients((clients) => clients.filter(({ id }) => id !== clientId));
  }

  function connectionAlert() {
    if (isConnected) return null;
    return (
      <Alert variant={connectError ? 'danger' : 'light'} className="d-flex align-items-center gap-3 py-2 pe-2">
        {!connectError && <Spinner animation="border" size="sm" className="flex-shrink-0" aria-hidden="true" />}
        <div className="flex-grow-1 overflow-hidden">
          <div className="fw-semibold">{connectError || 'Connecting...'}</div>
          <div className="small text-truncate opacity-75">Snapserver host: {serverUrl}</div>
        </div>
        <Button
          variant="link"
          size="sm"
          className="fw-semibold text-decoration-none"
          onClick={() => setSettingsOpen(true)}
        >
          Settings
        </Button>
      </Alert>
    );
  }

  function loginAlert() {
    if (!isConnected || !authRequired || loginOpen) return null;
    return (
      <Alert variant="danger" className="d-flex align-items-center gap-3 py-2 pe-2">
        <div className="flex-grow-1 fw-semibold">Login required</div>
        <Button
          variant="link"
          size="sm"
          className="fw-semibold text-decoration-none"
          onClick={() => setLoginOpen(true)}
        >
          Log in
        </Button>
      </Alert>
    );
  }

  return (
    <>
      <header className="app-header sticky-top border-bottom">
        <nav className="app-main container-fluid d-flex align-items-center gap-2 py-2">
          <img src={logo} alt="" className="app-logo" />
          <span className="fs-5 fw-semibold me-auto">Snapcast</span>
          <div className="btn-group header-actions" role="group" aria-label="Actions">
            <button
              type="button"
              className="btn btn-outline-primary btn-icon"
              aria-label="Open settings"
              onClick={() => setSettingsOpen(true)}
            >
              <Settings size={18} />
            </button>
            {/* Playback carries on without the control connection, so it can always be stopped */}
            {(isConnected || isPlaying) && (
              <button
                type="button"
                className={'btn btn-icon ' + (isPlaying ? 'btn-primary' : 'btn-outline-primary')}
                aria-label={isPlaying ? 'Stop playing' : 'Play on this device'}
                aria-pressed={isPlaying}
                onClick={() => setIsPlaying(!isPlaying)}
              >
                {isPlaying ? <Square size={16} fill="currentColor" /> : <Play size={18} fill="currentColor" />}
              </button>
            )}
          </div>
        </nav>
      </header>
      <Server
        server={server}
        snapcontrol={snapControl}
        showOffline={showOffline}
        deletedClientIds={deletedClients.map(({ id }) => id)}
        onClientDelete={handleClientDelete}
      />
      {(deletedClients.length > 0 || !isConnected || (authRequired && !loginOpen)) && (
        <div className="notice-stack">
          {deletedClients.map(({ id, name }) => (
            <UndoDeleteNotice key={id} name={name} onClose={(undo) => handleUndoDeleteClose(id, undo)} />
          ))}
          {connectionAlert()}
          {loginAlert()}
        </div>
      )}
      {/* Mounted only while open, so the password isn't kept around */}
      {loginOpen && (
        <LoginDialog
          open
          onLogin={async (username, password, remember) => {
            await snapControl.login(username, password, remember);
            setLoginOpen(false);
          }}
          onCancel={() => setLoginOpen(false)}
        />
      )}
      {/* Mounted only while open, so it starts from the saved settings each time */}
      {settingsOpen && (
        <SettingsDialog
          open
          loggedIn={snapControl.loggedIn}
          onLogout={() => {
            setSettingsOpen(false);
            snapControl.logout();
          }}
          onClose={(apply: boolean) => {
            setSettingsOpen(false);
            if (apply) {
              if (config.baseUrl !== serverUrl) {
                // The login belongs to the old server
                snapControl.forgetLogin();
                // The audio stream is still connected to the old server
                setIsPlaying(false);
                setServer(new Snapcast.Server());
                setConnectError('');
              }
              setServerUrl(config.baseUrl);
              setTheme(config.theme);
              setShowOffline(config.showOffline);
            }
          }}
        />
      )}
    </>
  );
}
