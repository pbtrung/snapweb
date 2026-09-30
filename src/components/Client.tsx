import React from 'react';
import { useState } from 'react';
import { SnapControl, Snapcast } from '../snapcontrol';
import {
  Box,
  Button,
  Grid,
  InputAdornment,
  Menu,
  MenuItem,
  Slider,
  Stack,
  TextField,
  Typography,
  IconButton,
} from '@mui/material';
import { Dialog, DialogActions, DialogContent, DialogTitle } from '@mui/material';
import { VolumeUp as VolumeUpIcon, VolumeOff as VolumeOffIcon, MoreVert as MoreVertIcon } from '@mui/icons-material';

type ClientProps = {
  client: Snapcast.Client;
  snapcontrol: SnapControl;
  onDelete: () => void;
  onVolumeChange: () => void;
};

export default function Client(props: ClientProps) {
  const client = props.client;
  const [, setUpdate] = useState(0);
  const [menuAnchor, setMenuAnchor] = useState<Element | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
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

  function handleOptionsClicked(event: React.MouseEvent<HTMLButtonElement>) {
    setMenuAnchor(event.currentTarget);
    setName(client.config.name);
    setTmpLatency(client.config.latency);
    setLatency(client.config.latency);
  }

  function handleDetailsClose(apply: boolean) {
    setDetailsOpen(false);
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
  const optionsId = 'client-options-' + client.id;

  return (
    <Box sx={{ opacity: client.connected ? 1.0 : 0.5 }}>
      <Grid container spacing={2} sx={{ justifyContent: 'center', alignItems: 'center' }}>
        <Grid size="grow">
          <Stack spacing={-1} direction="column">
            <Typography variant="subtitle1" align="left" gutterBottom>
              {displayName}
            </Typography>
            <Stack spacing={2} direction="row" sx={{ alignItems: 'center' }}>
              <IconButton
                aria-label={'Mute ' + displayName}
                aria-pressed={client.config.volume.muted}
                onClick={handleMuteClicked}
              >
                {client.config.volume.muted ? <VolumeOffIcon /> : <VolumeUpIcon />}
              </IconButton>
              <Slider
                aria-label={displayName + ' volume'}
                color="secondary"
                min={0}
                max={100}
                size="small"
                value={client.config.volume.percent}
                onChange={(_, value) => handleVolumeChange(value as number)}
              />
            </Stack>
          </Stack>
        </Grid>
        <Grid>
          <IconButton id={optionsId} aria-label={displayName + ' options'} onClick={handleOptionsClicked}>
            <MoreVertIcon />
          </IconButton>
          <Menu
            anchorEl={menuAnchor}
            open={menuAnchor !== null}
            onClose={() => setMenuAnchor(null)}
            slotProps={{ list: { 'aria-labelledby': optionsId } }}
          >
            <MenuItem
              onClick={() => {
                setDetailsOpen(true);
                setMenuAnchor(null);
              }}
            >
              Details
            </MenuItem>
            {!client.connected && (
              <MenuItem
                onClick={() => {
                  props.onDelete();
                  setMenuAnchor(null);
                }}
              >
                Delete
              </MenuItem>
            )}
          </Menu>
        </Grid>
      </Grid>
      <Dialog open={detailsOpen} onClose={() => handleDetailsClose(false)}>
        <DialogTitle>Client settings</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            margin="dense"
            label="Name"
            type="text"
            fullWidth
            variant="standard"
            onChange={(event: React.ChangeEvent<HTMLInputElement>) => setName(event.target.value)}
            value={name}
          />
          <TextField
            margin="dense"
            label="Latency"
            type="number"
            fullWidth
            value={tmpLatency}
            onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
              handleLatencyChange(Number(event.target.value) || 0)
            }
            variant="standard"
            slotProps={{
              input: {
                endAdornment: <InputAdornment position="end">ms</InputAdornment>,
              },
            }}
          />
          {readOnlyFields.map(([label, value]) => (
            <TextField
              key={label}
              margin="dense"
              label={label}
              type="text"
              fullWidth
              variant="standard"
              value={value}
              slotProps={{ input: { readOnly: true } }}
            />
          ))}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => handleDetailsClose(false)}>Cancel</Button>
          <Button onClick={() => handleDetailsClose(true)}>OK</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
