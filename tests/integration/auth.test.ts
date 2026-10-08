import { afterEach, describe, expect, it } from 'vitest';
import { SnapControl } from '../../src/snapcontrol';
import { password, serverUrl, username, waitFor } from './helpers';

// Needs a server that requires a login, and its user name and password
describe.skipIf(!serverUrl || !username)('Authentication against ' + (serverUrl || 'a real Snapserver'), () => {
  const controls: SnapControl[] = [];

  afterEach(() => {
    for (const control of controls.splice(0)) control.disconnect();
  });

  // A connection whose status request was refused for a missing login
  async function needingLogin(setup?: (control: SnapControl) => void): Promise<SnapControl> {
    const control = new SnapControl();
    controls.push(control);
    setup?.(control);
    control.connect(serverUrl);
    await waitFor(() => control.authRequired, 'the server to ask for a login');
    return control;
  }

  it('asks for a login and refuses a wrong password', async () => {
    const control = await needingLogin();
    await expect(control.login(username, password + '-wrong', false)).rejects.toThrow('Wrong user name or password');
    expect(control.server.server).toBeUndefined();
  });

  it('logs in and loads the status and notifications', async () => {
    const control = await needingLogin();
    await control.login(username, password, false);
    await waitFor(() => control.server.server !== undefined, 'the server status');

    expect(control.authRequired).toBe(false);
    expect(control.loggedIn).toBe(true);
    expect(control.server.groups.length).toBeGreaterThan(0);
  });

  it('logs in again on a new connection with what the login kept', async () => {
    const first = await needingLogin();
    await first.login(username, password, false);

    // A token when the server issues them, otherwise the Basic login
    const control = new SnapControl();
    controls.push(control);
    control.token = first.token;
    control.basic = first.basic;
    control.connect(serverUrl);
    await waitFor(() => control.server.server !== undefined, 'the server status');
    expect(control.authRequired).toBe(false);
  });

  it('asks for a login again when the token is not valid', async () => {
    await needingLogin((control) => {
      control.token = 'not-a-valid-token';
    });
  });
});
