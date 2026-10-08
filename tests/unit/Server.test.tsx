import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import Server from '../../src/components/Server';
import { connectedControl, quietConsole } from '../helpers/snapControl';

describe('Server', () => {
  it('renders a card per group with online clients', () => {
    quietConsole();
    const { control } = connectedControl();
    render(
      <Server
        server={control.server}
        snapcontrol={control}
        showOffline={false}
        deletedClientIds={[]}
        onClientDelete={() => {}}
      />,
    );

    expect(screen.getByText('Kitchen')).toBeInTheDocument();
    expect(screen.queryByText('host-c3')).not.toBeInTheDocument();
  });

  it('includes offline clients when asked to', () => {
    quietConsole();
    const { control } = connectedControl();
    render(
      <Server
        server={control.server}
        snapcontrol={control}
        showOffline
        deletedClientIds={[]}
        onClientDelete={() => {}}
      />,
    );

    expect(screen.getByText('host-c3')).toBeInTheDocument();
  });

  it('hides clients waiting to be deleted', () => {
    quietConsole();
    const { control } = connectedControl();
    render(
      <Server
        server={control.server}
        snapcontrol={control}
        showOffline
        deletedClientIds={['c3']}
        onClientDelete={() => {}}
      />,
    );

    expect(screen.queryByText('host-c3')).not.toBeInTheDocument();
    expect(screen.getByText('Kitchen')).toBeInTheDocument();
  });
});
