import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Group from '../../src/components/Group';
import { connectedControl, quietConsole, requests } from '../helpers/snapControl';
import { makeServerStatus } from '../fixtures/serverStatus';
import type { FakeWebSocket } from '../helpers/fakeWebSocket';
import type { SnapControl, Snapcast } from '../../src/snapcontrol';

describe('Group', () => {
  let control: SnapControl;
  let ws: FakeWebSocket;
  let onClientDelete: Mock<(client: Snapcast.Client) => void>;

  beforeEach(() => {
    quietConsole();
    ({ control, ws } = connectedControl());
    onClientDelete = vi.fn();
  });

  function renderGroup(id: string, showOffline = false, deletedClientIds: string[] = []) {
    return render(
      <Group
        server={control.server}
        group={control.getGroup(id)}
        snapcontrol={control}
        showOffline={showOffline}
        deletedClientIds={deletedClientIds}
        onClientDelete={onClientDelete}
      />,
    );
  }

  function groupSlider() {
    return screen.getByRole('slider', { name: 'group volume' });
  }

  function groupMute() {
    return screen.getByRole('button', { name: 'Mute group' });
  }

  it('renders its online clients', () => {
    renderGroup('g1');
    expect(screen.getByText('Kitchen')).toBeInTheDocument();
    expect(screen.getByText('livingroom')).toBeInTheDocument();
  });

  it('renders nothing for a group with only offline clients', () => {
    renderGroup('g2');
    expect(screen.queryByRole('slider')).not.toBeInTheDocument();
    expect(screen.queryByText('host-c3')).not.toBeInTheDocument();
  });

  it('shows offline clients when asked to, without a group slider for one client', () => {
    renderGroup('g2', true);
    expect(screen.getByText('host-c3')).toBeInTheDocument();
    expect(screen.getAllByRole('slider', { name: / volume$/ })).toHaveLength(1);
  });

  it('shows the average client volume on the group slider', () => {
    renderGroup('g1');
    expect(screen.getAllByRole('slider', { name: / volume$/ })).toHaveLength(3);
    expect(groupSlider()).toHaveValue('60');
  });

  it('lowers all client volumes proportionally', () => {
    renderGroup('g1');
    fireEvent.change(groupSlider(), { target: { value: 30 } });

    // 30 is half of 60, so every client is halved
    const sent = requests(ws, 'Client.SetVolume').map((m) => [m.params.id, m.params.volume.percent]);
    expect(sent).toEqual([
      ['c1', 20],
      ['c2', 40],
    ]);
    expect(groupSlider()).toHaveValue('30');
  });

  it('raises all client volumes proportionally towards 100', () => {
    renderGroup('g1');
    fireEvent.change(groupSlider(), { target: { value: 80 } });

    // 80 is half way from 60 to 100, so every client moves half way to 100
    const sent = requests(ws, 'Client.SetVolume').map((m) => [m.params.id, m.params.volume.percent]);
    expect(sent).toEqual([
      ['c1', 70],
      ['c2', 90],
    ]);
    expect(groupSlider()).toHaveValue('80');
  });

  // Drag the group slider through the given values in one gesture
  function drag(...values: number[]) {
    const slider = groupSlider();
    fireEvent.pointerDown(slider);
    for (const value of values) fireEvent.change(slider, { target: { value } });
    fireEvent.pointerUp(slider);
  }

  it('keeps volumes finite when a drag starts at 100 and returns to it', () => {
    for (const client of control.getGroup('g1').clients) client.config.volume.percent = 100;
    renderGroup('g1');
    drag(50, 100);

    const sent = requests(ws, 'Client.SetVolume').map((m) => m.params.volume.percent);
    expect(sent.every(Number.isFinite)).toBe(true);
    expect(sent.slice(-2)).toEqual([100, 100]);
  });

  it('raises clients from a group volume of 0', () => {
    for (const client of control.getGroup('g1').clients) client.config.volume.percent = 0;
    renderGroup('g1');
    fireEvent.change(groupSlider(), { target: { value: 50 } });

    expect(requests(ws, 'Client.SetVolume').map((m) => m.params.volume.percent)).toEqual([50, 50]);
  });

  it('scales from the volumes at the start of a drag', () => {
    renderGroup('g1');
    drag(30, 60);

    // Returning to the start value restores the original client volumes
    expect(
      requests(ws, 'Client.SetVolume')
        .slice(-2)
        .map((m) => m.params.volume.percent),
    ).toEqual([40, 80]);
  });

  it('follows client volume changes', () => {
    renderGroup('g1');
    const clientSlider = screen.getByRole('slider', { name: 'Kitchen volume' });
    fireEvent.change(clientSlider, { target: { value: 0 } });

    expect(groupSlider()).toHaveValue('40');
  });

  it('toggles group mute', async () => {
    renderGroup('g1');
    await userEvent.click(groupMute());

    expect(requests(ws, 'Group.SetMute')).toEqual([expect.objectContaining({ params: { id: 'g1', mute: true } })]);
    expect(control.getGroup('g1').muted).toBe(true);
    expect(groupMute()).toHaveAttribute('aria-pressed', 'true');

    await userEvent.click(groupMute());
    expect(requests(ws, 'Group.SetMute').slice(-1)[0].params.mute).toBe(false);
  });

  it('shows stream metadata', () => {
    renderGroup('g1');
    expect(screen.getByText('Song')).toBeInTheDocument();
    expect(screen.getByText('Artist A, Artist B')).toBeInTheDocument();
    expect(screen.getByAltText('Song cover')).toHaveAttribute('src', 'http://example.com/art.png');
    expect(screen.getByRole('img', { name: 'Duration' })).toBeInTheDocument();
    expect(screen.getByText('3:00')).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: 'Path' })).not.toBeInTheDocument();
  });

  it('hides the cover when the stream has none', () => {
    delete control.getStream('s1').properties.metadata!.artUrl;
    renderGroup('g1');
    expect(screen.getByText('Song')).toBeInTheDocument();
    expect(screen.queryByAltText('Song cover')).not.toBeInTheDocument();
  });

  it('hides a cover that fails to load', () => {
    renderGroup('g1');
    fireEvent.error(screen.getByAltText('Song cover'));
    expect(screen.queryByAltText('Song cover')).not.toBeInTheDocument();
  });

  it('switches the stream from the selector', async () => {
    renderGroup('g1');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Active stream' }), 's2');

    expect(requests(ws, 'Group.SetStream')).toEqual([
      expect.objectContaining({ params: { id: 'g1', stream_id: 's2' } }),
    ]);
  });

  describe('playback controls', () => {
    it('are hidden when the stream cannot be controlled', () => {
      const status = makeServerStatus();
      status.groups[0].stream_id = 's2';
      ({ control, ws } = connectedControl(status));
      renderGroup('g1');

      expect(screen.queryByRole('button', { name: /^(Play|Pause|Next|Previous)$/ })).not.toBeInTheDocument();
      expect(screen.queryByText('Song')).not.toBeInTheDocument();
    });

    it('pause a playing stream and skip tracks', async () => {
      renderGroup('g1');
      await userEvent.click(screen.getByRole('button', { name: 'Pause' }));
      await userEvent.click(screen.getByRole('button', { name: 'Next' }));
      await userEvent.click(screen.getByRole('button', { name: 'Previous' }));

      expect(requests(ws, 'Stream.Control').map((m) => m.params)).toEqual([
        { id: 's1', command: 'pause' },
        { id: 's1', command: 'next' },
        { id: 's1', command: 'previous' },
      ]);
    });

    it('play a paused stream', async () => {
      control.getStream('s1').properties.playbackStatus = 'paused';
      renderGroup('g1');
      expect(screen.queryByRole('button', { name: 'Pause' })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Play' }).querySelector('.lucide-play')).not.toBeNull();
      await userEvent.click(screen.getByRole('button', { name: 'Play' }));

      expect(requests(ws, 'Stream.Control')[0].params).toEqual({ id: 's1', command: 'play' });
    });
  });

  describe('settings dialog', () => {
    async function openSettings() {
      await userEvent.click(screen.getByRole('button', { name: 'Settings for group' }));
      return screen.getByRole('dialog');
    }

    it('lists every client with its membership', async () => {
      renderGroup('g1');
      const dialog = await openSettings();

      expect(within(dialog).getByRole('checkbox', { name: 'Kitchen' })).toBeChecked();
      expect(within(dialog).getByRole('checkbox', { name: 'livingroom' })).toBeChecked();
      expect(within(dialog).getByRole('checkbox', { name: 'host-c3' })).not.toBeChecked();
    });

    it('sets the group clients on OK', async () => {
      renderGroup('g1');
      const dialog = await openSettings();
      await userEvent.click(within(dialog).getByRole('checkbox', { name: 'host-c3' }));
      await userEvent.click(within(dialog).getByRole('checkbox', { name: 'livingroom' }));
      expect(within(dialog).getByRole('checkbox', { name: 'host-c3' })).toBeChecked();
      expect(within(dialog).getByRole('checkbox', { name: 'livingroom' })).not.toBeChecked();

      await userEvent.click(within(dialog).getByRole('button', { name: 'OK' }));
      expect(requests(ws, 'Group.SetClients')).toEqual([
        expect.objectContaining({ params: { id: 'g1', clients: ['c1', 'c3'] } }),
      ]);
      expect(requests(ws, 'Group.SetStream')).toHaveLength(0);
    });

    it('does not send anything when nothing changed', async () => {
      renderGroup('g1');
      const dialog = await openSettings();
      await userEvent.click(within(dialog).getByRole('button', { name: 'OK' }));

      expect(ws.sent).toHaveLength(0);
    });

    it('changes the stream on OK', async () => {
      renderGroup('g1');
      const dialog = await openSettings();
      await userEvent.selectOptions(within(dialog).getByRole('combobox', { name: 'Stream' }), 's2');
      await userEvent.click(within(dialog).getByRole('button', { name: 'OK' }));

      expect(requests(ws, 'Group.SetStream')).toEqual([
        expect.objectContaining({ params: { id: 'g1', stream_id: 's2' } }),
      ]);
    });

    it('discards changes on Cancel', async () => {
      renderGroup('g1');
      const dialog = await openSettings();
      await userEvent.click(within(dialog).getByRole('checkbox', { name: 'host-c3' }));
      await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));

      expect(ws.sent).toHaveLength(0);
    });
  });

  describe('deleting a client', () => {
    it('reports a delete from the client settings', async () => {
      renderGroup('g2', true);
      await userEvent.click(screen.getByRole('button', { name: 'Settings for host-c3' }));
      await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }));

      expect(onClientDelete).toHaveBeenCalledWith(control.getClient('c3'));
      expect(requests(ws, 'Server.DeleteClient')).toHaveLength(0);
    });

    it('hides clients waiting to be deleted', () => {
      renderGroup('g1', false, ['c1']);
      expect(screen.queryByText('Kitchen')).not.toBeInTheDocument();
      expect(screen.getByText('livingroom')).toBeInTheDocument();
    });
  });
});
