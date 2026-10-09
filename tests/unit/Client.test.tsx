import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
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

  function renderClient(id: string, handlers: { onVolumeChange?: () => void } = {}) {
    const onVolumeChange = handlers.onVolumeChange ?? vi.fn();
    const result = render(
      <Client client={control.getClient(id)} snapcontrol={control} onVolumeChange={onVolumeChange} />,
    );
    return { ...result, onVolumeChange };
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
});
