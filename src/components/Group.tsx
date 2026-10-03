import React, { useRef, useState } from 'react';
import Client from './Client';
import logo from '../assets/logo192.png';
import { SnapControl, Snapcast } from '../snapcontrol';
import {
  Alert,
  Box,
  Button,
  Card,
  CardMedia,
  Checkbox,
  Divider,
  FormControl,
  FormControlLabel,
  FormGroup,
  Grid,
  MenuItem,
  Select,
  Slider,
  Snackbar,
  Stack,
  TextField,
  Typography,
  IconButton,
} from '@mui/material';
import { Dialog, DialogActions, DialogContent, DialogTitle } from '@mui/material';
import {
  VolumeUp as VolumeUpIcon,
  VolumeOff as VolumeOffIcon,
  PlayArrow as PlayArrowIcon,
  Pause as PauseIcon,
  SkipPrevious as SkipPreviousIcon,
  SkipNext as SkipNextIcon,
  Settings as SettingsIcon,
  Schedule as ScheduleIcon,
  FolderOpen as FolderOpenIcon,
} from '@mui/icons-material';

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
};

// Client volumes at the start of a group volume drag, which the drag scales from
type VolumeDrag = {
  clientVolumes: Map<string, number>;
  groupVolume: number;
};

// How long "Deleted <client>" can be undone before the client is deleted
const UNDO_DELETE_MS = 6000;

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
  // Ids, since a server update replaces the client objects
  const [deletedClientIds, setDeletedClientIds] = useState<string[]>([]);
  const volumeDrag = useRef<VolumeDrag | null>(null);

  // The model is updated in place, so re-render to show the new values
  function refresh() {
    setUpdate((u) => u + 1);
  }

  function getClients(): Snapcast.Client[] {
    return props.group.clients.filter(
      (client) => (client.connected || props.showOffline) && !deletedClientIds.includes(client.id),
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

  function handleClientDelete(client: Snapcast.Client) {
    if (!deletedClientIds.includes(client.id)) setDeletedClientIds([...deletedClientIds, client.id]);
  }

  function handleSnackbarClose(clientId: string, undo: boolean) {
    if (!undo) props.snapcontrol.deleteClient(clientId);
    setDeletedClientIds((ids) => ids.filter((id) => id !== clientId));
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

  const deleteSnackbars = deletedClientIds.map((clientId) => {
    const name = props.server.getClient(clientId)?.getName() ?? clientId;
    return (
      <Snackbar
        open
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        autoHideDuration={UNDO_DELETE_MS}
        key={'snackbar-' + clientId}
        onClose={(_, reason) => {
          if (reason !== 'clickaway') handleSnackbarClose(clientId, false);
        }}
      >
        <Alert
          severity="info"
          sx={{ width: '100%' }}
          action={
            <Button color="inherit" size="small" onClick={() => handleSnackbarClose(clientId, true)}>
              Undo
            </Button>
          }
        >
          Deleted {name}
        </Alert>
      </Snackbar>
    );
  });

  const clients = getClients();
  if (clients.length === 0) return <div>{deleteSnackbars}</div>;

  const groupName = props.group.name || 'group';
  const stream = props.server.getStream(props.group.stream_id);
  const metadata = stream?.properties.metadata;
  const title = metadata?.title || 'Unknown Title';
  const artist = metadata?.artist ? metadata.artist.join(', ') : 'Unknown Artist';
  const hasDuration = metadata?.duration !== undefined && metadata.duration > 0;

  return (
    <div>
      <Card
        sx={{
          p: 2,
          my: 2,
          flexGrow: 1,
        }}
      >
        <Stack spacing={0} direction="column" sx={{ alignItems: 'left' }}>
          <Grid container direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
            <Stack direction="row" sx={{ justifyContent: 'center', alignItems: 'center' }}>
              <IconButton aria-label={'Settings for ' + groupName} onClick={handleSettingsClicked}>
                <SettingsIcon />
              </IconButton>

              <FormControl variant="standard">
                <Select
                  value={props.group.stream_id}
                  inputProps={{ 'aria-label': 'Active stream' }}
                  onChange={(event) => props.snapcontrol.setStream(props.group.id, event.target.value)}
                >
                  {props.server.streams.map((stream) => (
                    <MenuItem key={stream.id} value={stream.id}>
                      {stream.id}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Stack>

            {stream?.properties.canControl && (
              <Stack direction="row" sx={{ justifyContent: 'center', alignItems: 'center' }}>
                <IconButton aria-label="previous" onClick={() => props.snapcontrol.control(stream.id, 'previous')}>
                  <SkipPreviousIcon />
                </IconButton>
                <IconButton aria-label="play/pause" onClick={() => handlePlayPauseClicked(stream)}>
                  {stream.properties.playbackStatus === 'playing' ? <PauseIcon /> : <PlayArrowIcon />}
                </IconButton>
                <IconButton aria-label="next" onClick={() => props.snapcontrol.control(stream.id, 'next')}>
                  <SkipNextIcon />
                </IconButton>
              </Stack>
            )}
          </Grid>
          {metadata && (
            <Stack spacing={2} direction="row" sx={{ alignItems: 'center' }}>
              <CardMedia component="img" sx={{ width: 48 }} image={metadata.artUrl || logo} alt={title + ' cover'} />
              <Stack spacing={0} direction="column" sx={{ justifyContent: 'center', flexGrow: 1, overflow: 'hidden' }}>
                <Typography noWrap variant="subtitle1" align="left">
                  {title}
                </Typography>
                <Typography noWrap variant="body1" align="left">
                  {artist}
                </Typography>
                {(hasDuration || metadata.url) && (
                  <Box
                    component="dl"
                    sx={{
                      display: 'grid',
                      gridTemplateColumns: 'auto 1fr',
                      columnGap: 1,
                      m: 0,
                      '& dd': { m: 0 },
                    }}
                  >
                    {hasDuration && (
                      <>
                        <Typography
                          component="dt"
                          variant="body2"
                          sx={{ display: 'flex', alignItems: 'center', height: '1lh' }}
                        >
                          <ScheduleIcon fontSize="inherit" titleAccess="Duration" />
                        </Typography>
                        <Typography component="dd" variant="body2">
                          {formatDuration(metadata.duration!)}
                        </Typography>
                      </>
                    )}
                    {metadata.url && (
                      <>
                        <Typography
                          component="dt"
                          variant="body2"
                          sx={{ display: 'flex', alignItems: 'center', height: '1lh' }}
                        >
                          <FolderOpenIcon fontSize="inherit" titleAccess="Path" />
                        </Typography>
                        <Typography component="dd" variant="body2" sx={{ wordBreak: 'break-all' }}>
                          {metadata.url}
                        </Typography>
                      </>
                    )}
                  </Box>
                )}
              </Stack>
            </Stack>
          )}
          {clients.length > 1 && (
            <Stack spacing={2} direction="row" sx={{ alignItems: 'center' }}>
              <IconButton aria-label={'Mute ' + groupName} aria-pressed={props.group.muted} onClick={handleMuteClicked}>
                {props.group.muted ? <VolumeOffIcon /> : <VolumeUpIcon />}
              </IconButton>
              <Slider
                aria-label={groupName + ' volume'}
                color="secondary"
                min={0}
                max={100}
                size="small"
                value={getVolume()}
                onChange={(_, value) => handleVolumeChange(value as number)}
                onChangeCommitted={() => {
                  volumeDrag.current = null;
                }}
              />
            </Stack>
          )}
          {clients.length === 1 && <Box sx={{ py: 0.5 }} />}
        </Stack>
        <Divider />
        <Box sx={{ py: 0.5 }} />
        {clients.map((client) => (
          <Client
            key={client.id}
            client={client}
            snapcontrol={props.snapcontrol}
            onDelete={() => handleClientDelete(client)}
            onVolumeChange={refresh}
          />
        ))}
      </Card>

      <Dialog fullWidth open={settingsOpen} onClose={() => handleSettingsClose(false)}>
        <DialogTitle>Group settings</DialogTitle>
        <DialogContent>
          <Divider textAlign="left">Stream</Divider>
          <TextField
            margin="dense"
            select
            fullWidth
            variant="standard"
            value={settingsStreamId}
            slotProps={{ htmlInput: { 'aria-label': 'Stream' } }}
            onChange={(event) => setSettingsStreamId(event.target.value)}
          >
            {props.server.streams.map((stream) => (
              <MenuItem key={stream.id} value={stream.id}>
                {stream.id}
              </MenuItem>
            ))}
          </TextField>
          <Divider textAlign="left">Clients</Divider>
          <FormGroup>
            {settingsClients.map((element) => (
              <FormControlLabel
                control={
                  <Checkbox
                    checked={element.inGroup}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                      handleGroupClientChange(element.client, e.target.checked)
                    }
                  />
                }
                label={element.client.getName()}
                key={element.client.id}
              />
            ))}
          </FormGroup>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => handleSettingsClose(false)}>Cancel</Button>
          <Button onClick={() => handleSettingsClose(true)}>OK</Button>
        </DialogActions>
      </Dialog>
      {deleteSnackbars}
    </div>
  );
}
