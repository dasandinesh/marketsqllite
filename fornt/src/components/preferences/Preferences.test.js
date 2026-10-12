import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import Preferences from './Preferences';
import { fetchJson } from '../../api';
jest.mock('../../api', () => ({ fetchJson: jest.fn() }));
jest.mock('react-router-dom', () => ({ Link: ({ to, children }) => <a href={to}>{children}</a> }));
const base = { repository: 'https://github.com/vendor/market', engine: 'sqlite', installedVersion: '1.2.0', managed: true,
  canInstall: true, updateAvailable: true, latest: { name: 'Market 2', manifest: { version: '2.0.0' }, commit: 'revision', url: 'https://github.com/vendor/market/releases/v2' }, job: null };
beforeEach(() => { fetchJson.mockReset(); fetchJson.mockResolvedValue(base); });

test('saves a GitHub source and checks before preparing a pinned update', async () => {
  render(<Preferences />);
  await screen.findByDisplayValue(base.repository);
  fireEvent.change(screen.getByLabelText('GitHub repository link'), { target: { value: 'https://github.com/customer/market' } });
  expect(screen.getByRole('button', { name: 'Check for Updates' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Save Repository' }));
  await waitFor(() => expect(fetchJson).toHaveBeenCalledWith('/api/preferences/repository', expect.objectContaining({ method: 'PUT', body: JSON.stringify({ repository: 'https://github.com/customer/market' }) })));
});

test('installation requires confirmation and sends the prepared job revision', async () => {
  fetchJson.mockResolvedValue({ ...base, job: { id: 'job', phase: 'prepared', version: '2.0.0', commit: 'prepared-revision', message: 'Ready' } });
  const confirm = jest.spyOn(window, 'confirm').mockReturnValue(false);
  render(<Preferences />);
  fireEvent.click(await screen.findByRole('button', { name: 'Install and Restart' }));
  expect(fetchJson.mock.calls.some(([url]) => url.endsWith('/install'))).toBe(false);
  confirm.mockReturnValue(true);
  fireEvent.click(screen.getByRole('button', { name: 'Install and Restart' }));
  await waitFor(() => expect(fetchJson).toHaveBeenCalledWith('/api/preferences/install', expect.objectContaining({ method: 'POST', body: JSON.stringify({ id: 'job', commit: 'prepared-revision' }) })));
  confirm.mockRestore();
});

test('unmanaged desktop instances explain how to enable installation', async () => {
  fetchJson.mockResolvedValue({ ...base, managed: false, canInstall: false });
  render(<Preferences />);
  expect(await screen.findByText(/managed SQLite desktop edition/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Prepare Update' })).toBeDisabled();
});
