import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import Server from '../../src/components/Server';
import { connectedControl, quietConsole } from '../helpers/snapControl';

describe('Server', () => {
  it('renders a card per group with online clients', () => {
    quietConsole();
    const { control } = connectedControl();
    render(<Server server={control.server} snapcontrol={control} showOffline={false} />);

    expect(screen.getByText('Kitchen')).toBeInTheDocument();
    expect(screen.queryByText('host-c3')).not.toBeInTheDocument();
  });

  it('includes offline clients when asked to', () => {
    quietConsole();
    const { control } = connectedControl();
    render(<Server server={control.server} snapcontrol={control} showOffline />);

    expect(screen.getByText('host-c3')).toBeInTheDocument();
  });
});
