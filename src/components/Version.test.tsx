import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const check = vi.fn();

vi.mock('@tauri-apps/api/app', () => ({
  getVersion: () => Promise.resolve('0.44.0'),
}));
vi.mock('@tauri-apps/plugin-updater', () => ({
  check: () => check(),
}));
vi.mock('@tauri-apps/plugin-process', () => ({
  relaunch: vi.fn(),
  exit: vi.fn(),
}));

import { Version } from './Version';

// A realistic updater failure: long enough that rendering it inline stretched the
// header and pushed the version label off its row.
const LONG_ERROR =
  'error sending request for url (https://localhost/disabled): error trying to connect';

describe('Version', () => {
  beforeEach(() => {
    check.mockReset();
  });

  it('shows the version', async () => {
    render(<Version />);
    expect(await screen.findByText('v0.44.0')).toBeInTheDocument();
  });

  it('reports an update failure as a compact marker, not inline text', async () => {
    check.mockRejectedValue(new Error(LONG_ERROR));
    render(<Version />);

    await userEvent.click(await screen.findByText('v0.44.0'));

    const marker = await screen.findByRole('img', { name: /update failed/i });
    // The visible text is a single character - this is what keeps the header intact.
    expect(marker).toHaveTextContent(/^!$/);
    expect(screen.queryByText(new RegExp(LONG_ERROR))).not.toBeInTheDocument();
  });

  it('keeps the whole message in the tooltip so it can be reported', async () => {
    check.mockRejectedValue(new Error(LONG_ERROR));
    render(<Version />);

    await userEvent.click(await screen.findByText('v0.44.0'));

    const marker = await screen.findByRole('img', { name: /update failed/i });
    expect(marker).toHaveAttribute('title', expect.stringContaining(LONG_ERROR));
  });

  it('shows no marker when the check succeeds', async () => {
    check.mockResolvedValue({ available: false });
    render(<Version />);

    await userEvent.click(await screen.findByText('v0.44.0'));

    await waitFor(() => expect(check).toHaveBeenCalled());
    expect(screen.queryByRole('img', { name: /update failed/i })).not.toBeInTheDocument();
  });
});
