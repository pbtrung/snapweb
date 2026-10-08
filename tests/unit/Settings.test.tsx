import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SettingsDialog from '../../src/components/Settings';
import { config, Theme } from '../../src/config';
import { quietConsole } from '../helpers/snapControl';

describe('SettingsDialog', () => {
  beforeEach(() => {
    window.localStorage.clear();
    config.baseUrl = 'ws://old:1780';
    config.theme = Theme.Light;
    config.showOffline = false;
    quietConsole();
  });

  it('shows the current settings', () => {
    render(<SettingsDialog open onClose={vi.fn()} />);
    expect(screen.getByLabelText('Snapserver host')).toHaveValue('ws://old:1780');
    expect(screen.getByRole('radio', { name: 'Light' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Show offline clients' })).not.toBeChecked();
  });

  it('saves the settings on OK', async () => {
    const onClose = vi.fn();
    render(<SettingsDialog open onClose={onClose} />);
    const host = screen.getByLabelText('Snapserver host');
    await userEvent.clear(host);
    await userEvent.type(host, 'ws://new:1780');
    await userEvent.click(screen.getByRole('radio', { name: 'Dark' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Show offline clients' }));
    await userEvent.click(screen.getByRole('button', { name: 'OK' }));

    expect(onClose).toHaveBeenCalledWith(true);
    expect(config.baseUrl).toBe('ws://new:1780');
    expect(config.theme).toBe(Theme.Dark);
    expect(config.showOffline).toBe(true);
  });

  it('keeps the settings on Cancel', async () => {
    const onClose = vi.fn();
    render(<SettingsDialog open onClose={onClose} />);
    await userEvent.type(screen.getByLabelText('Snapserver host'), '/x');
    await userEvent.click(screen.getByRole('checkbox', { name: 'Show offline clients' }));
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onClose).toHaveBeenCalledWith(false);
    expect(config.baseUrl).toBe('ws://old:1780');
    expect(config.showOffline).toBe(false);
  });

  it('closes without saving on Escape', async () => {
    const onClose = vi.fn();
    render(<SettingsDialog open onClose={onClose} />);
    await userEvent.type(screen.getByLabelText('Snapserver host'), '/x');
    await userEvent.keyboard('{Escape}');

    expect(onClose).toHaveBeenCalledWith(false);
    expect(config.baseUrl).toBe('ws://old:1780');
  });

  it('renders nothing while closed', () => {
    render(<SettingsDialog open={false} onClose={vi.fn()} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('offers to log out only while logged in', async () => {
    const onLogout = vi.fn();
    const { rerender } = render(<SettingsDialog open onClose={vi.fn()} onLogout={onLogout} />);
    expect(screen.queryByRole('button', { name: 'Log out' })).not.toBeInTheDocument();

    rerender(<SettingsDialog open loggedIn onClose={vi.fn()} onLogout={onLogout} />);
    await userEvent.click(screen.getByRole('button', { name: 'Log out' }));
    expect(onLogout).toHaveBeenCalledOnce();
  });
});
