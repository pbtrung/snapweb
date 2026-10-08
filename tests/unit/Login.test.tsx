import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import LoginDialog from '../../src/components/Login';
import { quietConsole } from '../helpers/snapControl';

describe('LoginDialog', () => {
  beforeEach(() => {
    quietConsole();
  });

  it('asks for the user name and password, not remembering by default', () => {
    render(<LoginDialog open onLogin={vi.fn()} onCancel={vi.fn()} />);

    expect(screen.getByRole('dialog', { name: 'Log in' })).toBeInTheDocument();
    expect(screen.getByLabelText('User name')).toHaveFocus();
    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'password');
    expect(screen.getByRole('checkbox', { name: 'Remember me' })).not.toBeChecked();
  });

  it('logs in with the entered values', async () => {
    const onLogin = vi.fn().mockResolvedValue(undefined);
    render(<LoginDialog open onLogin={onLogin} onCancel={vi.fn()} />);
    await userEvent.type(screen.getByLabelText('User name'), 'admin');
    await userEvent.type(screen.getByLabelText('Password'), 'pässwort');
    await userEvent.click(screen.getByRole('checkbox', { name: 'Remember me' }));
    await userEvent.click(screen.getByRole('button', { name: 'Log in' }));

    expect(onLogin).toHaveBeenCalledExactlyOnceWith('admin', 'pässwort', true);
  });

  it('submits on Enter', async () => {
    const onLogin = vi.fn().mockResolvedValue(undefined);
    render(<LoginDialog open onLogin={onLogin} onCancel={vi.fn()} />);
    await userEvent.type(screen.getByLabelText('User name'), 'admin');
    await userEvent.type(screen.getByLabelText('Password'), 'secret{Enter}');

    expect(onLogin).toHaveBeenCalledExactlyOnceWith('admin', 'secret', false);
  });

  it('shows why the login failed, and lets it be tried again', async () => {
    const onLogin = vi.fn().mockRejectedValueOnce(new Error('Wrong user name or password'));
    render(<LoginDialog open onLogin={onLogin} onCancel={vi.fn()} />);
    await userEvent.type(screen.getByLabelText('Password'), 'wrong{Enter}');

    expect(await screen.findByText('Wrong user name or password')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Log in' })).toBeEnabled();
    await userEvent.click(screen.getByRole('button', { name: 'Log in' }));
    expect(onLogin).toHaveBeenCalledTimes(2);
  });

  it('cancels', async () => {
    const onLogin = vi.fn();
    const onCancel = vi.fn();
    render(<LoginDialog open onLogin={onLogin} onCancel={onCancel} />);
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onCancel).toHaveBeenCalledOnce();
    expect(onLogin).not.toHaveBeenCalled();
  });
});
