import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SettingsDialog from '../../src/components/Settings';
import { config, Theme } from '../../src/config';
import { SnapControl, Snapcast } from '../../src/snapcontrol';
import { connectedControl, quietConsole, requests } from '../helpers/snapControl';
import type { FakeWebSocket } from '../helpers/fakeWebSocket';

describe('SettingsDialog', () => {
  let control: SnapControl;
  let ws: FakeWebSocket;
  let onClientDelete: Mock<(client: Snapcast.Client) => void>;

  beforeEach(() => {
    window.localStorage.clear();
    config.baseUrl = 'ws://old:1780';
    config.theme = Theme.Light;
    config.showOffline = false;
    quietConsole();
    ({ control, ws } = connectedControl());
    onClientDelete = vi.fn();
  });

  function renderSettings(
    props: { open?: boolean; onClose?: (apply: boolean) => void; loggedIn?: boolean; onLogout?: () => void } = {},
    deletedClientIds: string[] = [],
  ) {
    const onClose = props.onClose ?? vi.fn();
    const element = (
      <SettingsDialog
        open={props.open ?? true}
        onClose={onClose}
        loggedIn={props.loggedIn}
        onLogout={props.onLogout}
        server={control.server}
        snapcontrol={control}
        deletedClientIds={deletedClientIds}
        onClientDelete={onClientDelete}
      />
    );
    return { ...render(element), onClose };
  }

  function ok() {
    return userEvent.click(screen.getByRole('button', { name: 'OK' }));
  }

  function cancel() {
    return userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  }

  describe('general', () => {
    it('shows the current settings', () => {
      renderSettings();
      expect(screen.getByRole('tab', { name: 'General' })).toHaveAttribute('aria-selected', 'true');
      expect(screen.getByLabelText('Snapserver host')).toHaveValue('ws://old:1780');
      expect(screen.getByRole('radio', { name: 'Light' })).toBeChecked();
      expect(screen.getByRole('checkbox', { name: 'Show offline clients' })).not.toBeChecked();
    });

    it('saves the settings on OK', async () => {
      const { onClose } = renderSettings();
      const host = screen.getByLabelText('Snapserver host');
      await userEvent.clear(host);
      await userEvent.type(host, 'ws://new:1780');
      await userEvent.click(screen.getByRole('radio', { name: 'Dark' }));
      await userEvent.click(screen.getByRole('checkbox', { name: 'Show offline clients' }));
      await ok();

      expect(onClose).toHaveBeenCalledWith(true);
      expect(config.baseUrl).toBe('ws://new:1780');
      expect(config.theme).toBe(Theme.Dark);
      expect(config.showOffline).toBe(true);
      expect(ws.sent).toHaveLength(0);
    });

    it('keeps the settings on Cancel', async () => {
      const { onClose } = renderSettings();
      await userEvent.type(screen.getByLabelText('Snapserver host'), '/x');
      await userEvent.click(screen.getByRole('checkbox', { name: 'Show offline clients' }));
      await cancel();

      expect(onClose).toHaveBeenCalledWith(false);
      expect(config.baseUrl).toBe('ws://old:1780');
      expect(config.showOffline).toBe(false);
    });

    it('closes without saving on Escape', async () => {
      const { onClose } = renderSettings();
      await userEvent.type(screen.getByLabelText('Snapserver host'), '/x');
      await userEvent.keyboard('{Escape}');

      expect(onClose).toHaveBeenCalledWith(false);
      expect(config.baseUrl).toBe('ws://old:1780');
    });

    it('renders nothing while closed', () => {
      renderSettings({ open: false });
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('offers to log out only while logged in', async () => {
      const onLogout = vi.fn();
      const { rerender } = renderSettings({ onLogout });
      expect(screen.queryByRole('button', { name: 'Log out' })).not.toBeInTheDocument();

      rerender(
        <SettingsDialog
          open
          loggedIn
          onClose={vi.fn()}
          onLogout={onLogout}
          server={control.server}
          snapcontrol={control}
          deletedClientIds={[]}
          onClientDelete={onClientDelete}
        />,
      );
      await userEvent.click(screen.getByRole('button', { name: 'Log out' }));
      expect(onLogout).toHaveBeenCalledOnce();
    });

    it('disables the group and client tabs without a server', () => {
      control = new SnapControl();
      renderSettings();
      expect(screen.getByRole('tab', { name: 'Groups' })).toHaveAttribute('aria-disabled', 'true');
      expect(screen.getByRole('tab', { name: 'Clients' })).toHaveAttribute('aria-disabled', 'true');
    });
  });

  describe('groups', () => {
    async function openGroups() {
      renderSettings();
      await userEvent.click(screen.getByRole('tab', { name: 'Groups' }));
    }

    function group(name: string) {
      return within(screen.getByRole('group', { name: name }));
    }

    it('lists every group with its stream and clients', async () => {
      await openGroups();

      expect(group('Group 1').getByRole('combobox', { name: 'Stream' })).toHaveValue('s1');
      expect(group('Group 1').getByRole('checkbox', { name: 'Kitchen' })).toBeChecked();
      expect(group('Group 1').getByRole('checkbox', { name: 'livingroom' })).toBeChecked();
      expect(group('Group 1').getByRole('checkbox', { name: 'host-c3' })).not.toBeChecked();
      expect(group('Office').getByRole('combobox', { name: 'Stream' })).toHaveValue('s2');
      expect(group('Office').getByRole('checkbox', { name: 'host-c3' })).toBeChecked();
    });

    it('moves a client between groups', async () => {
      await openGroups();
      await userEvent.click(group('Group 1').getByRole('checkbox', { name: 'host-c3' }));

      // A client is in one group at a time
      expect(group('Office').getByRole('checkbox', { name: 'host-c3' })).not.toBeChecked();
      await ok();
      expect(requests(ws, 'Group.SetClients')).toEqual([
        expect.objectContaining({ params: { id: 'g1', clients: ['c1', 'c2', 'c3'] } }),
      ]);
      expect(requests(ws, 'Group.SetStream')).toHaveLength(0);
    });

    it('takes a client out of its group', async () => {
      await openGroups();
      await userEvent.click(group('Group 1').getByRole('checkbox', { name: 'livingroom' }));
      await ok();

      expect(requests(ws, 'Group.SetClients')).toEqual([
        expect.objectContaining({ params: { id: 'g1', clients: ['c1'] } }),
      ]);
    });

    it('adds to groups before taking clients out of others', async () => {
      await openGroups();
      await userEvent.click(group('Group 1').getByRole('checkbox', { name: 'livingroom' }));
      await userEvent.click(group('Office').getByRole('checkbox', { name: 'Kitchen' }));
      await ok();

      expect(requests(ws, 'Group.SetClients').map((request) => request.params)).toEqual([
        { id: 'g2', clients: ['c1', 'c3'] },
        { id: 'g1', clients: [] },
      ]);
    });

    it('changes the stream on OK', async () => {
      await openGroups();
      await userEvent.selectOptions(group('Office').getByRole('combobox', { name: 'Stream' }), 's1');
      await ok();

      expect(requests(ws, 'Group.SetStream')).toEqual([
        expect.objectContaining({ params: { id: 'g2', stream_id: 's1' } }),
      ]);
      expect(requests(ws, 'Group.SetClients')).toHaveLength(0);
    });

    it('does not send anything when nothing changed', async () => {
      await openGroups();
      await ok();
      expect(ws.sent).toHaveLength(0);
    });

    it('discards changes on Cancel', async () => {
      await openGroups();
      await userEvent.click(group('Group 1').getByRole('checkbox', { name: 'host-c3' }));
      await userEvent.selectOptions(group('Office').getByRole('combobox', { name: 'Stream' }), 's1');
      await cancel();

      expect(ws.sent).toHaveLength(0);
    });
  });

  describe('clients', () => {
    async function openClient(name: string, deletedClientIds: string[] = []) {
      renderSettings({}, deletedClientIds);
      await userEvent.click(screen.getByRole('tab', { name: 'Clients' }));
      await userEvent.click(screen.getByRole('button', { name: name }));
      return within(screen.getByRole('group', { name: name }));
    }

    it('shows the client details read-only', async () => {
      const client = await openClient('Kitchen');

      expect(client.getByLabelText('Name')).toHaveValue('Kitchen');
      expect(client.getByLabelText('Client')).toHaveValue('Snapclient 0.30.0');
      expect(client.getByLabelText('ID')).toHaveValue('c1');
      expect(client.getByLabelText('Host')).toHaveValue('host-c1');
      for (const field of ['Client', 'MAC', 'ID', 'IP', 'Host', 'OS'])
        expect(client.getByLabelText(field)).toHaveAttribute('readonly');
    });

    it('renames the client on OK', async () => {
      const client = await openClient('Kitchen');
      const name = client.getByLabelText('Name');
      await userEvent.clear(name);
      await userEvent.type(name, 'Dining');
      expect(requests(ws, 'Client.SetName')).toHaveLength(0);

      await ok();
      expect(requests(ws, 'Client.SetName')).toEqual([
        expect.objectContaining({ params: { id: 'c1', name: 'Dining' } }),
      ]);
      expect(control.getClient('c1').getName()).toBe('Dining');
    });

    it('does not rename clients without a name on OK', async () => {
      await openClient('host-c3');
      await ok();
      expect(ws.sent).toHaveLength(0);
    });

    it('applies latency live and keeps it on OK', async () => {
      const client = await openClient('Kitchen');
      fireEvent.change(client.getByLabelText('Latency'), { target: { value: '25' } });

      expect(requests(ws, 'Client.SetLatency').slice(-1)[0].params).toEqual({ id: 'c1', latency: 25 });
      await ok();
      expect(control.getClient('c1').config.latency).toBe(25);
      expect(requests(ws, 'Client.SetName')).toHaveLength(0);
    });

    it('reverts latency and name on Cancel', async () => {
      const client = await openClient('Kitchen');
      fireEvent.change(client.getByLabelText('Latency'), { target: { value: '25' } });
      fireEvent.change(client.getByLabelText('Name'), { target: { value: 'Other' } });
      await cancel();

      expect(requests(ws, 'Client.SetLatency').slice(-1)[0].params).toEqual({ id: 'c1', latency: 0 });
      expect(control.getClient('c1').config.latency).toBe(0);
      expect(requests(ws, 'Client.SetName')).toHaveLength(0);
      expect(control.getClient('c1').getName()).toBe('Kitchen');
    });

    it('lets the latency field be cleared without sending anything', async () => {
      control.getClient('c1').config.latency = 10;
      const client = await openClient('Kitchen');
      const field = client.getByLabelText('Latency');
      fireEvent.change(field, { target: { value: '' } });

      expect(field).toHaveValue(null);
      expect(requests(ws, 'Client.SetLatency')).toHaveLength(0);

      fireEvent.change(field, { target: { value: '-20' } });
      expect(requests(ws, 'Client.SetLatency').slice(-1)[0].params).toEqual({ id: 'c1', latency: -20 });
    });

    it('keeps the last valid latency on OK', async () => {
      control.getClient('c1').config.latency = 10;
      const client = await openClient('Kitchen');
      const field = client.getByLabelText('Latency');
      fireEvent.change(field, { target: { value: '30' } });
      fireEvent.change(field, { target: { value: '' } });
      await ok();

      expect(control.getClient('c1').config.latency).toBe(30);
    });

    it('only offers Delete for offline clients', async () => {
      const client = await openClient('Kitchen');
      expect(client.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
    });

    it('reports a delete of an offline client', async () => {
      const client = await openClient('host-c3');
      await userEvent.click(client.getByRole('button', { name: 'Delete' }));

      expect(onClientDelete).toHaveBeenCalledWith(control.getClient('c3'));
      expect(requests(ws, 'Server.DeleteClient')).toHaveLength(0);
    });

    it('hides clients waiting to be deleted', async () => {
      renderSettings({}, ['c3']);
      await userEvent.click(screen.getByRole('tab', { name: 'Clients' }));
      expect(screen.queryByRole('button', { name: 'host-c3' })).not.toBeInTheDocument();
      await userEvent.click(screen.getByRole('tab', { name: 'Groups' }));
      expect(screen.queryByRole('checkbox', { name: 'host-c3' })).not.toBeInTheDocument();
    });
  });
});
