// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act, waitFor } from '@testing-library/react';
import { openUrl } from '@tauri-apps/plugin-opener';
import { fetchLatestRelease } from '@/lib/checkForUpdate';
import { check, type Update, type DownloadEvent } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { UpdateChecker } from '@/components/UpdateChecker';

vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: vi.fn(() => Promise.resolve()) }));
vi.mock('@tauri-apps/plugin-updater', () => ({ check: vi.fn() }));
vi.mock('@tauri-apps/plugin-process', () => ({ relaunch: vi.fn(() => Promise.resolve()) }));

vi.mock('@tauri-apps/api/app', () => ({ getVersion: vi.fn(() => Promise.resolve('1.0.0')) }));

vi.mock('@/lib/checkForUpdate', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/checkForUpdate')>();
  return { ...actual, fetchLatestRelease: vi.fn() };
});

const storeGet = vi.fn((_key?: string) => Promise.resolve<string | undefined>(undefined));
const storeSet = vi.fn((_key: string, _value: string) => Promise.resolve(undefined));
vi.mock('@tauri-apps/plugin-store', () => ({
  LazyStore: class {
    get(key: string) {
      return storeGet(key);
    }
    set(key: string, value: string) {
      return storeSet(key, value);
    }
    save() {
      return Promise.resolve(undefined);
    }
  },
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  storeGet.mockImplementation(() => Promise.resolve(undefined));
});

/** An Update whose download() replays the given events, optionally held open
 * so a test can observe the downloading state before the ready state. */
function makeUpdate(version: string, events: DownloadEvent[] = [], hold: Promise<void> = Promise.resolve()) {
  return {
    version,
    body: '',
    download: vi.fn(async (onEvent: (event: DownloadEvent) => void) => {
      for (const event of events) onEvent(event);
      await hold;
    }),
    install: vi.fn(async () => {}),
  } as unknown as Update;
}

describe('UpdateChecker', () => {
  it('UC-01: updater finds an update, downloads in the background and prompts to restart', async () => {
    vi.mocked(check).mockResolvedValue(
      makeUpdate('1.1.0', [
        { event: 'Started', data: { contentLength: 200 } },
        { event: 'Progress', data: { chunkLength: 200 } },
        { event: 'Finished' },
      ]),
    );
    render(<UpdateChecker />);
    expect(await screen.findByText(/v1\.1\.0 is downloaded/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /restart now/i })).toBeInTheDocument();
  });

  it('UC-02: shows download progress while the bundle is being fetched', async () => {
    let release!: () => void;
    const hold = new Promise<void>((resolve) => { release = resolve; });
    vi.mocked(check).mockResolvedValue(
      makeUpdate('1.1.0', [
        { event: 'Started', data: { contentLength: 200 } },
        { event: 'Progress', data: { chunkLength: 50 } },
      ], hold),
    );
    render(<UpdateChecker />);
    expect(await screen.findByText(/downloading v1\.1\.0/i)).toBeInTheDocument();
    expect(screen.getByText(/25%/)).toBeInTheDocument();
    await act(async () => {
      release();
    });
    expect(await screen.findByRole('button', { name: /restart now/i })).toBeInTheDocument();
  });

  it('UC-03: renders nothing when the updater reports the app is current', async () => {
    vi.mocked(check).mockResolvedValue(null);
    const { container } = render(<UpdateChecker />);
    await waitFor(() => expect(check).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
    expect(fetchLatestRelease).not.toHaveBeenCalled();
  });

  it('UC-04: a version matching the dismissed one is not re-offered', async () => {
    storeGet.mockResolvedValue('1.1.0');
    vi.mocked(check).mockResolvedValue(makeUpdate('1.1.0'));
    const { container } = render(<UpdateChecker />);
    await waitFor(() => expect(check).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('UC-05: restart now installs and relaunches', async () => {
    const update = makeUpdate('1.1.0', [{ event: 'Started', data: { contentLength: 1 } }, { event: 'Finished' }]);
    vi.mocked(check).mockResolvedValue(update);
    render(<UpdateChecker />);
    fireEvent.click(await screen.findByRole('button', { name: /restart now/i }));
    await waitFor(() => expect(update.install).toHaveBeenCalled());
    expect(relaunch).toHaveBeenCalled();
  });

  it('UC-06: later persists the version and hides the banner', async () => {
    vi.mocked(check).mockResolvedValue(makeUpdate('1.1.0', [{ event: 'Finished' }]));
    render(<UpdateChecker />);
    fireEvent.click(await screen.findByRole('button', { name: /^later$/i }));
    expect(screen.queryByText(/v1\.1\.0 is downloaded/i)).not.toBeInTheDocument();
    await waitFor(() => expect(storeSet).toHaveBeenCalledWith('update-dismissed-version', '1.1.0'));
  });

  it('UC-07: falls back to the release page when the updater cannot run', async () => {
    vi.mocked(check).mockRejectedValue(new Error('endpoint unreachable'));
    vi.mocked(fetchLatestRelease).mockResolvedValue({
      version: '1.1.0',
      notes: '',
      url: 'https://github.com/latiefahmad/PaperNinja/releases/tag/v1.1.0',
    });
    render(<UpdateChecker />);
    expect(await screen.findByText(/paperninja v1\.1\.0 is available/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /download/i }));
    expect(openUrl).toHaveBeenCalledWith('https://github.com/latiefahmad/PaperNinja/releases/tag/v1.1.0');
  });

  it('UC-08: renders nothing when both the updater and the fallback fail', async () => {
    vi.mocked(check).mockRejectedValue(new Error('endpoint unreachable'));
    vi.mocked(fetchLatestRelease).mockResolvedValue(null);
    const { container } = render(<UpdateChecker />);
    await waitFor(() => expect(fetchLatestRelease).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });
});
