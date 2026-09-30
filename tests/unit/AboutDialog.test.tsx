import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AboutDialog from '../../src/components/AboutDialog';

describe('AboutDialog', () => {
  it('shows the version and closes', async () => {
    // The dialog nests a <table> inside a <p>, which React warns about
    vi.spyOn(console, 'error').mockImplementation(() => { });
    const onClose = vi.fn();
    render(<AboutDialog open onClose={onClose} />);

    expect(screen.getByRole('dialog', { name: 'About Snapweb' })).toBeInTheDocument();
    expect(screen.getByText(/Snapweb version/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'https://github.com/snapcast/snapweb' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('renders nothing while closed', () => {
    render(<AboutDialog open={false} onClose={vi.fn()} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
