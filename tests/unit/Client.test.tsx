import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Client from '../../src/components/Client';
import { connectedControl, quietConsole, requests } from '../helpers/snapControl';
import type { FakeWebSocket } from '../helpers/fakeWebSocket';
import type { SnapControl } from '../../src/snapcontrol';

describe('Client', () => {
  let control: SnapControl;
  let ws: FakeWebSocket;

  beforeEach(() => {
    quietConsole();
    ({ control, ws } = connectedControl());
  });

  function renderClient(id: string, handlers: { onDelete?: () => void; onVolumeChange?: () => void } = {}) {
    const onDelete = handlers.onDelete ?? vi.fn();
    const onVolumeChange = handlers.onVolumeChange ?? vi.fn();
    const result = render(
      <Client
        client={control.getClient(id)}
        snapcontrol={control}
        onDelete={onDelete}
        onVolumeChange={onVolumeChange}
      />,
    );
    return { ...result, onDelete, onVolumeChange };
  }

  function volumeSlider() {
    return screen.getByRole('slider', { name: / volume$/ });
  }

  it('shows the configured name', () => {
    renderClient('c1');
    expect(screen.getByText('Kitchen')).toBeInTheDocument();
  });

  it('falls back to the host name', () => {
    renderClient('c2');
    expect(screen.getByText('livingroom')).toBeInTheDocument();
  });

  it('dims offline clients', () => {
    const { container } = renderClient('c3');
    expect(container.firstChild).toHaveStyle({ opacity: '0.5' });
  });

  it('shows the client volume', () => {
    renderClient('c1');
    expect(volumeSlider()).toHaveValue('40');
  });

  it('sets the volume when the slider moves', () => {
    const { onVolumeChange } = renderClient('c1');
    fireEvent.change(volumeSlider(), { target: { value: 70 } });

    expect(requests(ws, 'Client.SetVolume')).toEqual([
      expect.objectContaining({ params: { id: 'c1', volume: { muted: false, percent: 70 } } }),
    ]);
    expect(control.getClient('c1').config.volume.percent).toBe(70);
    expect(onVolumeChange).toHaveBeenCalledTimes(1);
  });

  it('toggles mute', async () => {
    renderClient('c1');
    const mute = screen.getByRole('button', { name: /^Mute / });
    expect(mute).toHaveAttribute('aria-pressed', 'false');

    await userEvent.click(mute);
    expect(requests(ws, 'Client.SetVolume').slice(-1)[0].params.volume).toEqual({ muted: true, percent: 40 });
    expect(mute).toHaveAttribute('aria-pressed', 'true');

    await userEvent.click(mute);
    expect(requests(ws, 'Client.SetVolume').slice(-1)[0].params.volume).toEqual({ muted: false, percent: 40 });
    expect(mute).toHaveAttribute('aria-pressed', 'false');
  });

  it('only offers Delete for offline clients', async () => {
    renderClient('c1');
    await userEvent.click(screen.getByRole('button', { name: /^Settings for / }));
    expect(within(screen.getByRole('dialog')).queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
  });

  it('calls onDelete from the settings of an offline client', async () => {
    const { onDelete } = renderClient('c3');
    await userEvent.click(screen.getByRole('button', { name: /^Settings for / }));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }));

    expect(onDelete).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  describe('settings dialog', () => {
    async function openSettings() {
      await userEvent.click(screen.getByRole('button', { name: /^Settings for / }));
      return screen.getByRole('dialog');
    }

    it('shows the client details read-only', async () => {
      renderClient('c1');
      const dialog = await openSettings();

      expect(within(dialog).getByLabelText('Name')).toHaveValue('Kitchen');
      expect(within(dialog).getByLabelText('Client')).toHaveValue('Snapclient 0.30.0');
      expect(within(dialog).getByLabelText('ID')).toHaveValue('c1');
      expect(within(dialog).getByLabelText('Host')).toHaveValue('host-c1');
      for (const field of ['Client', 'MAC', 'ID', 'IP', 'Host', 'OS'])
        expect(within(dialog).getByLabelText(field)).toHaveAttribute('readonly');
    });

    it('renames the client on OK', async () => {
      renderClient('c1');
      const dialog = await openSettings();
      const name = within(dialog).getByLabelText('Name');
      await userEvent.clear(name);
      await userEvent.type(name, 'Dining');
      expect(requests(ws, 'Client.SetName')).toHaveLength(0);

      await userEvent.click(within(dialog).getByRole('button', { name: 'OK' }));
      expect(requests(ws, 'Client.SetName')).toEqual([
        expect.objectContaining({ params: { id: 'c1', name: 'Dining' } }),
      ]);
      expect(screen.getByText('Dining')).toBeInTheDocument();
    });

    it('applies latency live and keeps it on OK', async () => {
      renderClient('c1');
      const dialog = await openSettings();
      fireEvent.change(within(dialog).getByLabelText('Latency'), { target: { value: '25' } });

      expect(requests(ws, 'Client.SetLatency').slice(-1)[0].params).toEqual({ id: 'c1', latency: 25 });
      await userEvent.click(within(dialog).getByRole('button', { name: 'OK' }));
      expect(control.getClient('c1').config.latency).toBe(25);
      expect(requests(ws, 'Client.SetName')).toHaveLength(0);
    });

    it('reverts latency and name on Cancel', async () => {
      renderClient('c1');
      const dialog = await openSettings();
      fireEvent.change(within(dialog).getByLabelText('Latency'), { target: { value: '25' } });
      fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Other' } });
      await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));

      expect(requests(ws, 'Client.SetLatency').slice(-1)[0].params).toEqual({ id: 'c1', latency: 0 });
      expect(control.getClient('c1').config.latency).toBe(0);
      expect(requests(ws, 'Client.SetName')).toHaveLength(0);
      expect(screen.getByText('Kitchen')).toBeInTheDocument();
    });

    it('lets the latency field be cleared without sending anything', async () => {
      control.getClient('c1').config.latency = 10;
      renderClient('c1');
      const dialog = await openSettings();
      const field = within(dialog).getByLabelText('Latency');
      fireEvent.change(field, { target: { value: '' } });

      expect(field).toHaveValue(null);
      expect(requests(ws, 'Client.SetLatency')).toHaveLength(0);

      fireEvent.change(field, { target: { value: '-20' } });
      expect(requests(ws, 'Client.SetLatency').slice(-1)[0].params).toEqual({ id: 'c1', latency: -20 });
    });

    it('keeps the last valid latency on OK', async () => {
      control.getClient('c1').config.latency = 10;
      renderClient('c1');
      const dialog = await openSettings();
      const field = within(dialog).getByLabelText('Latency');
      fireEvent.change(field, { target: { value: '30' } });
      fireEvent.change(field, { target: { value: '' } });
      await userEvent.click(within(dialog).getByRole('button', { name: 'OK' }));

      expect(control.getClient('c1').config.latency).toBe(30);
      await openSettings();
      expect(within(screen.getByRole('dialog')).getByLabelText('Latency')).toHaveValue(30);
    });
  });
});
