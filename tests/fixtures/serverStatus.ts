// Synthetic Server.GetStatus result modelled on the Snapcast JSON-RPC API

export function makeClient(id: string, overrides: { name?: string; hostName?: string; percent?: number; muted?: boolean; connected?: boolean; latency?: number } = {}) {
  return {
    config: {
      instance: 1,
      latency: overrides.latency ?? 0,
      name: overrides.name ?? '',
      volume: { muted: overrides.muted ?? false, percent: overrides.percent ?? 50 },
    },
    connected: overrides.connected ?? true,
    host: { arch: 'x86_64', ip: '192.0.2.10', mac: '00:00:5e:00:53:01', name: overrides.hostName ?? 'host-' + id, os: 'Linux' },
    id: id,
    lastSeen: { sec: 1700000000, usec: 0 },
    snapclient: { name: 'Snapclient', protocolVersion: 2, version: '0.30.0' },
  };
}

export function makeStream(id: string, properties?: Record<string, unknown>) {
  return {
    id: id,
    status: 'playing',
    uri: { fragment: '', host: '', path: '/tmp/' + id, query: { name: id }, raw: 'pipe:///tmp/' + id + '?name=' + id, scheme: 'pipe' },
    ...(properties !== undefined ? { properties } : {}),
  };
}

export function makeServerStatus() {
  return {
    groups: [
      {
        clients: [
          makeClient('c1', { name: 'Kitchen', percent: 40 }),
          makeClient('c2', { hostName: 'livingroom', percent: 80 }),
        ],
        id: 'g1',
        muted: false,
        name: '',
        stream_id: 's1',
      },
      {
        clients: [makeClient('c3', { percent: 20, connected: false })],
        id: 'g2',
        muted: true,
        name: 'Office',
        stream_id: 's2',
      },
    ],
    server: {
      host: { arch: 'x86_64', ip: '', mac: '', name: 'snapserver', os: 'Linux' },
      snapserver: { controlProtocolVersion: 1, name: 'Snapserver', protocolVersion: 1, version: '0.30.0' },
    },
    streams: [
      makeStream('s1', {
        canControl: true, canGoNext: true, canGoPrevious: false, canPause: true, canPlay: true, canSeek: false,
        playbackStatus: 'playing',
        metadata: { title: 'Song', artist: ['Artist A', 'Artist B'], album: 'Album', artUrl: 'http://example.com/art.png', duration: 180 },
      }),
      makeStream('s2'),
    ],
  };
}
