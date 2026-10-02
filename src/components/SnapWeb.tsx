import { useState, useEffect, useRef } from 'react';
import Server from './Server';
import AboutDialog from './AboutDialog';
import SettingsDialog from './Settings';
import useMediaQuery from '@mui/material/useMediaQuery';
import { Theme, config, getClientId } from '../config';
import { SnapControl, Snapcast } from '../snapcontrol';
import type { SnapStream } from '../snapstream';
import {
  AppBar,
  Box,
  Drawer,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  Toolbar,
  Typography,
  IconButton,
  Snackbar,
  Alert,
  Button,
} from '@mui/material';
import { PlayArrow as PlayArrowIcon, Stop as StopIcon, Menu as MenuIcon } from '@mui/icons-material';
import { createTheme, ThemeProvider } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import silence from '../assets/10-seconds-of-silence.mp3';
import { updateMediaSession } from '../mediaSession';

function makeTheme(mode: 'light' | 'dark') {
  return createTheme({
    palette: {
      mode,
      primary: {
        light: '#757ce8',
        main: '#607d8b',
        dark: '#002884',
        contrastText: '#fff',
      },
      secondary: {
        light: '#ff7961',
        main: '#f44336',
        dark: '#ba000d',
        contrastText: '#000',
      },
    },
    typography: {
      subtitle1: {
        fontSize: 17,
      },
      body1: {
        fontWeight: 500,
      },
      h5: {
        fontWeight: 300,
      },
    },
    components: {
      MuiTextField: {
        defaultProps: {
          spellCheck: false,
        },
      },
    },
  });
}

const lightTheme = makeTheme('light');
const darkTheme = makeTheme('dark');

export default function SnapWeb() {
  const [, setUpdate] = useState(0);
  const [server, setServer] = useState(new Snapcast.Server());
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [showOffline, setShowOffline] = useState(config.showOffline);
  const [theme, setTheme] = useState(config.theme);
  const [serverUrl, setServerUrl] = useState(config.baseUrl);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isConnected, setConnected] = useState(false);
  const [connectError, setConnectError] = useState('');
  const snapstreamRef = useRef<SnapStream | null>(null);
  const audioRef = useRef(new Audio());
  const handlersRef = useRef<{
    onChange: (server: Snapcast.Server) => void;
    onConnectionChanged: (connected: boolean, error?: string) => void;
  } | null>(null);
  const [snapControl] = useState(() => {
    const control = new SnapControl();
    control.onChange = (_control: SnapControl, server: Snapcast.Server) => handlersRef.current?.onChange(server);
    control.onConnectionChanged = (_control: SnapControl, connected: boolean, error?: string) =>
      handlersRef.current?.onConnectionChanged(connected, error);
    return control;
  });

  const prefersDarkMode = useMediaQuery('(prefers-color-scheme: dark)');

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
      if (error) setConnectError(error);
    }
    setConnected(connected);
  }

  // Refresh on every render so the SnapControl callbacks always see the latest state
  useEffect(() => {
    handlersRef.current = { onChange: handleChange, onConnectionChanged: handleConnectionChanged };
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

  function connectionSnackbar() {
    if (isConnected) return null;
    return (
      <Snackbar open anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
        <Alert
          severity={connectError ? 'error' : 'info'}
          sx={{ width: '100%' }}
          action={
            <Button color="inherit" size="small" onClick={() => setSettingsOpen(true)}>
              Settings
            </Button>
          }
        >
          <div>{connectError || 'Connecting...'}</div>
          <div>Snapserver host: {serverUrl}</div>
        </Alert>
      </Snackbar>
    );
  }

  return (
    <ThemeProvider theme={theme == Theme.Dark || (theme == Theme.System && prefersDarkMode) ? darkTheme : lightTheme}>
      <CssBaseline />
      <div className="SnapWeb">
        <AppBar position="sticky">
          <Toolbar>
            <IconButton
              size="large"
              edge="start"
              color="inherit"
              aria-label="menu"
              sx={{ mr: 2 }}
              onClick={() => setDrawerOpen(true)}
            >
              <MenuIcon />
            </IconButton>
            <Typography variant="h6" component="div" sx={{ flexGrow: 1 }}>
              Snapcast
            </Typography>
            {isConnected && (
              <IconButton
                size="large"
                edge="start"
                color="inherit"
                aria-label={isPlaying ? 'Stop playing' : 'Play on this device'}
                sx={{ mr: 2 }}
                onClick={() => setIsPlaying(!isPlaying)}
              >
                {isPlaying ? <StopIcon fontSize="large" /> : <PlayArrowIcon fontSize="large" />}
              </IconButton>
            )}
          </Toolbar>
        </AppBar>
        <Drawer anchor="top" open={drawerOpen} onClose={() => setDrawerOpen(false)}>
          <Box role="presentation" sx={{ mt: 1 }}>
            <List>
              <ListItem disablePadding>
                <ListItemButton
                  onClick={() => {
                    setAboutOpen(true);
                    setDrawerOpen(false);
                  }}
                >
                  <ListItemText primary="About..." />
                </ListItemButton>
              </ListItem>
              <ListItem disablePadding>
                <ListItemButton
                  onClick={() => {
                    setSettingsOpen(true);
                    setDrawerOpen(false);
                  }}
                >
                  <ListItemText primary="Settings..." />
                </ListItemButton>
              </ListItem>
            </List>
          </Box>
        </Drawer>
        <Server server={server} snapcontrol={snapControl} showOffline={showOffline} />
        {connectionSnackbar()}
        <AboutDialog open={aboutOpen} onClose={() => setAboutOpen(false)} />
        {/* Mounted only while open, so it starts from the saved settings each time */}
        {settingsOpen && (
          <SettingsDialog
            open
            onClose={(apply: boolean) => {
              setSettingsOpen(false);
              if (apply) {
                if (config.baseUrl !== serverUrl) {
                  // The audio stream is still connected to the old server
                  setIsPlaying(false);
                  setServer(new Snapcast.Server());
                }
                setServerUrl(config.baseUrl);
                setTheme(config.theme);
                setShowOffline(config.showOffline);
              }
            }}
          />
        )}
      </div>
    </ThemeProvider>
  );
}
