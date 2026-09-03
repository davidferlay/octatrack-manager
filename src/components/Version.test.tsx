import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Version } from './Version';

const { getVersionMock } = vi.hoisted(() => ({
  getVersionMock: vi.fn<() => Promise<string>>(),
}));

vi.mock('@tauri-apps/api/app', () => ({
  getVersion: getVersionMock,
}));

describe('Version', () => {
  beforeEach(() => {
    getVersionMock.mockReset();
    getVersionMock.mockResolvedValue('0.1.0');
  });

  it('renders the app version as a static display', async () => {
    render(<Version />);

    const version = await screen.findByText('v0.1.0');
    expect(version).toHaveClass('app-version');
    expect(version).not.toHaveAttribute('title');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Masta-Octa version 0.1.0')).toBeInTheDocument();

    fireEvent.click(version);
    expect(getVersionMock).toHaveBeenCalledTimes(1);
  });
});
