import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SnapWeb from '../../src/components/SnapWeb';
import { config } from '../../src/config';
import { FakeWebSocket } from '../helpers/fakeWebSocket';
import { makeServerStatus } from '../fixtures/serverStatus';
import { quietConsole } from '../helpers/snapControl';

// The audio stream needs Web Audio, which jsdom lacks
const snapStream = vi.hoisted(() => ({
  created: [] as string[],
  stop: vi.fn(),
}));
vi.mock('../../src/snapstream', () => ({
  SnapStream: class {
    constructor(baseUrl: string) {
      snapStream.created.push(baseUrl);
    }
    stop = snapStream.stop;
  },
}));

type MediaQueryListener = (event: { matches: boolean }) => void;

describe('SnapWeb', () => {
  let listeners: Set<MediaQueryListener>;

  beforeEach(() => {
    quietConsole();
    window.localStorage.clear();
    config.baseUrl = 'ws://snapserver:1780';
    FakeWebSocket.reset();
    vi.stubGlobal('WebSocket', FakeWebSocket);
    snapStream.created = [];
    snapStream.stop.mockClear();

    listeners = new Set();
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: false,
      media: query,
      addEventListener: (_: string, l: MediaQueryListener) => listeners.add(l),
      removeEventListener: (_: string, l: MediaQueryListener) => listeners.delete(l),
      addListener: () => {},
      removeListener: () => {},
    }));
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function socket(url = 'ws://snapserver:1780/jsonrpc') {
    return FakeWebSocket.instances.filter((ws) => ws.url === url).slice(-1)[0];
  }

  function connect(ws = socket()) {
    act(() => {
      ws.open();
      ws.receive({ id: ws.lastSent().id, jsonrpc: '2.0', result: { server: makeServerStatus() } });
    });
    return ws;
  }

  it('connects to the configured server on start', () => {
    render(<SnapWeb />);
    expect(socket()).toBeDefined();
    expect(screen.getByRole('alert')).toHaveTextContent('Snapserver host: ws://snapserver:1780');
  });

  it('says it is connecting until connected', () => {
    render(<SnapWeb />);
    expect(screen.getByRole('alert')).toHaveTextContent('Connecting...');
    expect(screen.queryByRole('button', { name: 'Play on this device' })).not.toBeInTheDocument();
  });

  it('shows the groups once connected', () => {
    render(<SnapWeb />);
    connect();

    expect(screen.getByText('Kitchen')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('updates on server notifications', () => {
    render(<SnapWeb />);
    const ws = connect();
    act(() => ws.receive({ jsonrpc: '2.0', method: 'Client.OnNameChanged', params: { id: 'c1', name: 'Dining' } }));

    expect(screen.getByText('Dining')).toBeInTheDocument();
  });

  it('reports a lost connection and clears the groups', () => {
    vi.useFakeTimers();
    render(<SnapWeb />);
    const ws = connect();
    act(() => ws.drop());

    expect(screen.getByRole('alert')).toHaveTextContent('Connection lost, trying to reconnect.');
    expect(screen.queryByText('Kitchen')).not.toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    connect(FakeWebSocket.latest());
    expect(screen.getByText('Kitchen')).toBeInTheDocument();
  });

  it('opens the settings from the connection error', async () => {
    render(<SnapWeb />);
    await userEvent.click(within(screen.getByRole('alert')).getByRole('button', { name: 'Settings' }));
    expect(screen.getByRole('dialog', { name: 'Settings' })).toBeInTheDocument();
  });

  async function openSettings() {
    await userEvent.click(screen.getByRole('button', { name: 'Open settings' }));
  }

  it('reconnects when the server url changes in the settings', async () => {
    render(<SnapWeb />);
    const old = connect();
    await openSettings();
    const host = screen.getByLabelText('Snapserver host');
    await userEvent.clear(host);
    await userEvent.type(host, 'ws://other:1780');
    await userEvent.click(screen.getByRole('button', { name: 'OK' }));

    expect(old.readyState).toBe(FakeWebSocket.CLOSED);
    expect(socket('ws://other:1780/jsonrpc')).toBeDefined();
    expect(screen.queryByText('Kitchen')).not.toBeInTheDocument();
  });

  it('keeps the connection when the settings keep the url', async () => {
    render(<SnapWeb />);
    connect();
    await openSettings();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Show offline clients' }));
    await userEvent.click(screen.getByRole('button', { name: 'OK' }));

    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(screen.getByText('Kitchen')).toBeInTheDocument();
    expect(screen.getByText('host-c3')).toBeInTheDocument();
  });

  it('drops cancelled settings edits the next time the dialog opens', async () => {
    render(<SnapWeb />);
    await openSettings();
    await userEvent.type(screen.getByLabelText('Snapserver host'), '/typo');
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await openSettings();

    expect(screen.getByLabelText('Snapserver host')).toHaveValue('ws://snapserver:1780');
  });

  it('starts and stops local playback', async () => {
    render(<SnapWeb />);
    connect();
    await userEvent.click(screen.getByRole('button', { name: 'Play on this device' }));
    await waitFor(() => expect(snapStream.created).toEqual(['ws://snapserver:1780']));

    await userEvent.click(screen.getByRole('button', { name: 'Stop playing' }));
    expect(snapStream.stop).toHaveBeenCalledTimes(1);
  });

  describe('media session', () => {
    let session: { metadata: any; playbackState: string; handlers: Map<string, any>; position: any };

    beforeEach(() => {
      session = { metadata: null, playbackState: 'none', handlers: new Map(), position: null };
      vi.stubGlobal(
        'MediaMetadata',
        class {
          constructor(init: object) {
            Object.assign(this, init);
          }
        },
      );
      Object.defineProperty(navigator, 'mediaSession', {
        configurable: true,
        value: {
          set metadata(value: unknown) {
            session.metadata = value;
          },
          get metadata() {
            return session.metadata;
          },
          set playbackState(value: string) {
            session.playbackState = value;
          },
          get playbackState() {
            return session.playbackState;
          },
          setActionHandler: (action: string, handler: unknown) => session.handlers.set(action, handler),
          setPositionState: (state: unknown) => {
            session.position = state;
          },
        },
      });
    });

    afterEach(() => {
      delete (navigator as any).mediaSession;
    });

    // Make this browser the client c1 of group g1, which plays stream s1
    function statusWithThisBrowser() {
      window.localStorage.setItem('uniqueId', 'this-browser');
      const status = makeServerStatus();
      status.groups[0].clients[0].id = 'this-browser';
      return status;
    }

    async function startPlayback() {
      render(<SnapWeb />);
      const ws = socket();
      act(() => {
        ws.open();
        ws.receive({ id: ws.lastSent().id, jsonrpc: '2.0', result: { server: statusWithThisBrowser() } });
      });
      await userEvent.click(screen.getByRole('button', { name: 'Play on this device' }));
      await waitFor(() => expect(snapStream.created).toHaveLength(1));
      // The media session is refreshed on the next server update
      act(() => ws.receive({ jsonrpc: '2.0', method: 'Group.OnMute', params: { id: 'g1', mute: false } }));
      ws.sent = [];
      return ws;
    }

    it('publishes the metadata of the stream this browser plays', async () => {
      await startPlayback();

      expect(session.metadata).toMatchObject({ title: 'Song', artist: 'Artist A, Artist B', album: 'Album' });
      expect(session.metadata.artwork[0].src).toBe('http://example.com/art.png');
      expect(session.playbackState).toBe('playing');
      // Without a known position there's no progress to report
      expect(session.position).toEqual({ duration: 0, playbackRate: 1, position: 0 });
    });

    it('wires the supported actions to stream control', async () => {
      const ws = await startPlayback();

      // s1 can pause and go next, but not go previous or seek
      expect(session.handlers.get('previoustrack')).toBeNull();
      expect(session.handlers.get('seekforward')).toBeNull();
      session.handlers.get('pause')();
      session.handlers.get('nexttrack')();
      session.handlers.get('stop')();

      expect(ws.sent.map((m) => m.params.command)).toEqual(['pause', 'next', 'stop']);
    });

    it('seeks when the stream supports it', async () => {
      const status = statusWithThisBrowser();
      (status.streams[0] as any).properties.canSeek = true;
      (status.streams[0] as any).properties.position = 30;
      render(<SnapWeb />);
      const ws = socket();
      act(() => {
        ws.open();
        ws.receive({ id: ws.lastSent().id, jsonrpc: '2.0', result: { server: status } });
      });
      await userEvent.click(screen.getByRole('button', { name: 'Play on this device' }));
      await waitFor(() => expect(snapStream.created).toHaveLength(1));
      act(() => ws.receive({ jsonrpc: '2.0', method: 'Group.OnMute', params: { id: 'g1', mute: false } }));
      ws.sent = [];

      session.handlers.get('seekbackward')({});
      session.handlers.get('seekforward')({ seekOffset: 5 });
      session.handlers.get('seekto')({ seekTime: 42 });

      expect(ws.sent.map((m) => m.params)).toEqual([
        { id: 's1', command: 'seek', params: { offset: -10 } },
        { id: 's1', command: 'seek', params: { offset: 5 } },
        { id: 's1', command: 'setPosition', params: { position: 42 } },
      ]);
      expect(session.position).toEqual({ duration: 180, playbackRate: 1, position: 30 });
    });

    it('pauses the keep-alive audio when the stream pauses', async () => {
      const ws = await startPlayback();
      act(() =>
        ws.receive({
          jsonrpc: '2.0',
          method: 'Stream.OnProperties',
          params: { id: 's1', properties: { playbackStatus: 'paused', canPlay: true } },
        }),
      );

      expect(session.playbackState).toBe('paused');
      expect(session.metadata.title).toBe('Unknown Title');
      expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled();
    });

    it('does nothing while not playing locally', () => {
      render(<SnapWeb />);
      connect();
      expect(session.metadata).toBeNull();
    });
  });

  it('keeps playing while the control connection reconnects', async () => {
    render(<SnapWeb />);
    const ws = connect();
    await userEvent.click(screen.getByRole('button', { name: 'Play on this device' }));
    await waitFor(() => expect(snapStream.created).toHaveLength(1));

    vi.useFakeTimers();
    act(() => ws.drop());
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    connect(FakeWebSocket.latest());

    expect(snapStream.stop).not.toHaveBeenCalled();
    expect(snapStream.created).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Stop playing' })).toBeInTheDocument();
  });

  it('stops playing when the server url changes in the settings', async () => {
    render(<SnapWeb />);
    connect();
    await userEvent.click(screen.getByRole('button', { name: 'Play on this device' }));
    await waitFor(() => expect(snapStream.created).toHaveLength(1));
    await openSettings();
    const host = screen.getByLabelText('Snapserver host');
    await userEvent.clear(host);
    await userEvent.type(host, 'ws://other:1780');
    await userEvent.click(screen.getByRole('button', { name: 'OK' }));

    expect(snapStream.stop).toHaveBeenCalled();
  });

  it('offers playback again when the browser refuses to play', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.mocked(HTMLMediaElement.prototype.play).mockRejectedValue(new Error('NotAllowedError'));
    render(<SnapWeb />);
    connect();
    await userEvent.click(screen.getByRole('button', { name: 'Play on this device' }));

    await waitFor(() => expect(screen.getByRole('button', { name: 'Play on this device' })).toBeInTheDocument());
    expect(snapStream.created).toEqual([]);
  });

  it('does not start the stream when stopped before the audio code loaded', async () => {
    let resolvePlay!: () => void;
    vi.mocked(HTMLMediaElement.prototype.play).mockReturnValue(
      new Promise<void>((resolve) => {
        resolvePlay = resolve;
      }),
    );
    render(<SnapWeb />);
    connect();
    await userEvent.click(screen.getByRole('button', { name: 'Play on this device' }));
    await userEvent.click(screen.getByRole('button', { name: 'Stop playing' }));
    await act(async () => {
      resolvePlay();
    });

    expect(snapStream.created).toEqual([]);
  });

  it('does not add color scheme listeners on re-render and removes them on unmount', () => {
    const { unmount } = render(<SnapWeb />);
    const initial = listeners.size;
    const ws = connect();
    for (let i = 0; i < 5; ++i)
      act(() => ws.receive({ jsonrpc: '2.0', method: 'Group.OnMute', params: { id: 'g1', mute: i % 2 === 0 } }));

    expect(listeners.size).toBe(initial);
    unmount();
    expect(listeners.size).toBe(0);
  });

  it('disconnects on unmount', () => {
    vi.useFakeTimers();
    const { unmount } = render(<SnapWeb />);
    const ws = connect();
    unmount();

    expect(ws.readyState).toBe(FakeWebSocket.CLOSED);
    vi.advanceTimersByTime(5000);
    expect(FakeWebSocket.instances).toHaveLength(1);
  });
});
