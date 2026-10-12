import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import Dashboard from './dashboard';

test('SQLite health displays the engine and downloads the native SQLite backup', async () => {
  const originalFetch = global.fetch;
  const originalCreate = URL.createObjectURL;
  const originalRevoke = URL.revokeObjectURL;
  global.fetch = jest.fn(url => Promise.resolve(url === '/api/health'
    ? { ok: true, json: async () => ({ db: true, engine: 'sqlite' }) }
    : url === '/api/backup/download-sqlite'
      ? { ok: true, blob: async () => new Blob(['SQLite backup']), headers: { get: () => 'attachment; filename="market-test.sqlite"' } }
      : { ok: true, json: async () => [] }));
  URL.createObjectURL = jest.fn(() => 'blob:test');
  URL.revokeObjectURL = jest.fn();
  const click = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  try {
    render(<Dashboard />);
    expect(await screen.findByText('SQLite connected')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Download SQLite file' }));
    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith('/api/backup/download-sqlite'));
    expect(await screen.findByText('Backup downloaded as market-test.sqlite.')).toBeInTheDocument();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:test');
  } finally {
    global.fetch = originalFetch;
    URL.createObjectURL = originalCreate;
    URL.revokeObjectURL = originalRevoke;
    click.mockRestore();
  }
});
