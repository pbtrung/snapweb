import { authToken } from './config';

// JSON shapes of the Snapcast control API (Server.GetStatus and notifications)
interface HostJson {
  arch: string;
  ip: string;
  mac: string;
  name: string;
  os: string;
}

interface VolumeJson {
  muted: boolean;
  percent: number;
}

interface ClientJson {
  id: string;
  host: HostJson;
  snapclient: { name: string; protocolVersion: number; version: string };
  config: { instance: number; latency: number; name: string; volume: VolumeJson };
  lastSeen: { sec: number; usec: number };
  connected: boolean;
}

interface GroupJson {
  id: string;
  name: string;
  stream_id: string;
  muted: boolean;
  clients: ClientJson[];
}

interface MetadataJson {
  title?: string;
  artist?: string[];
  album?: string;
  artUrl?: string;
  duration?: number;
  url?: string;
}

interface PropertiesJson {
  loopStatus?: string;
  shuffle?: boolean;
  volume?: number;
  rate?: number;
  playbackStatus?: 'stopped' | 'paused' | 'playing';
  position?: number;
  minimumRate?: number;
  maximumRate?: number;
  canGoNext?: boolean;
  canGoPrevious?: boolean;
  canPlay?: boolean;
  canPause?: boolean;
  canSeek?: boolean;
  canControl?: boolean;
  metadata?: MetadataJson;
}

interface StreamJson {
  id: string;
  status: string;
  uri: { raw: string; scheme: string; host: string; path: string; fragment: string; query: Record<string, string> };
  properties?: PropertiesJson;
}

interface ServerJson {
  groups: GroupJson[];
  server: {
    host: HostJson;
    snapserver: { controlProtocolVersion: number; name: string; protocolVersion: number; version: string };
  };
  streams: StreamJson[];
}

interface Notification {
  method: string;
  params: any;
}

interface RpcError {
  code: number;
  message: string;
  data?: unknown;
}

interface Credentials {
  scheme: 'Basic' | 'Bearer';
  param: string;
}

// An error reply to a request made with SnapControl.call
class RequestError extends Error {
  readonly error: RpcError;

  constructor(error: RpcError) {
    super(error.message);
    this.error = error;
  }
}

// Snapserver answers 401 until the connection is authenticated; older
// servers used -32000 with an "Unauthorized" message
function needsLogin(error: RpcError | undefined): boolean {
  if (!error) return false;
  return error.code === 401 || (error.code === -32000 && /nauthorized/.test(String(error.message)));
}

// btoa only takes Latin-1, so encode the text as UTF-8 first
function base64(text: string): string {
  let binary = '';
  for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

namespace Snapcast {
  export class Host {
    constructor(json: HostJson) {
      this.fromJson(json);
    }

    fromJson(json: HostJson) {
      this.arch = json.arch;
      this.ip = json.ip;
      this.mac = json.mac;
      this.name = json.name;
      this.os = json.os;
    }

    arch: string = '';
    ip: string = '';
    mac: string = '';
    name: string = '';
    os: string = '';
  }

  export class Client {
    constructor(json: ClientJson) {
      this.fromJson(json);
    }

    fromJson(json: ClientJson) {
      this.id = json.id;
      this.host = new Host(json.host);
      const jsnapclient = json.snapclient;
      this.snapclient = {
        name: jsnapclient.name,
        protocolVersion: jsnapclient.protocolVersion,
        version: jsnapclient.version,
      };
      const jconfig = json.config;
      this.config = {
        instance: jconfig.instance,
        latency: jconfig.latency,
        name: jconfig.name,
        volume: { muted: jconfig.volume.muted, percent: jconfig.volume.percent },
      };
      this.lastSeen = { sec: json.lastSeen.sec, usec: json.lastSeen.usec };
      this.connected = Boolean(json.connected);
    }

    id: string = '';
    host!: Host;
    snapclient!: {
      name: string;
      protocolVersion: number;
      version: string;
    };
    config!: {
      instance: number;
      latency: number;
      name: string;
      volume: {
        muted: boolean;
        percent: number;
      };
    };
    lastSeen!: {
      sec: number;
      usec: number;
    };
    connected: boolean = false;

    getName(): string {
      return this.config.name.length === 0 ? this.host.name : this.config.name;
    }
  }

  export class Group {
    constructor(json: GroupJson) {
      this.fromJson(json);
    }

    fromJson(json: GroupJson) {
      this.name = json.name;
      this.id = json.id;
      this.stream_id = json.stream_id;
      this.muted = Boolean(json.muted);
      this.clients = json.clients.map((client) => new Client(client));
    }

    name: string = '';
    id: string = '';
    stream_id: string = '';
    muted: boolean = false;
    clients: Client[] = [];

    getClient(id: string): Client | null {
      for (const client of this.clients) {
        if (client.id === id) return client;
      }
      return null;
    }
  }

  export class Metadata {
    constructor(json: MetadataJson) {
      this.fromJson(json);
    }

    fromJson(json: MetadataJson) {
      this.title = json.title;
      this.artist = json.artist;
      this.album = json.album;
      this.artUrl = json.artUrl;
      this.duration = json.duration;
      this.url = json.url;
    }

    title?: string;
    artist?: string[];
    album?: string;
    artUrl?: string;
    duration?: number;
    url?: string;
  }

  export class Properties {
    constructor(json: PropertiesJson) {
      this.fromJson(json);
    }

    fromJson(json: PropertiesJson) {
      this.loopStatus = json.loopStatus;
      this.shuffle = json.shuffle;
      this.volume = json.volume;
      this.rate = json.rate;
      this.playbackStatus = json.playbackStatus;
      this.position = json.position;
      this.minimumRate = json.minimumRate;
      this.maximumRate = json.maximumRate;
      this.canGoNext = Boolean(json.canGoNext);
      this.canGoPrevious = Boolean(json.canGoPrevious);
      this.canPlay = Boolean(json.canPlay);
      this.canPause = Boolean(json.canPause);
      this.canSeek = Boolean(json.canSeek);
      this.canControl = Boolean(json.canControl);
      if (json.metadata !== undefined) {
        this.metadata = new Metadata(json.metadata);
      } else {
        this.metadata = undefined;
      }
    }

    loopStatus?: string;
    shuffle?: boolean;
    volume?: number;
    rate?: number;
    playbackStatus?: PropertiesJson['playbackStatus'];
    position?: number;
    minimumRate?: number;
    maximumRate?: number;
    canGoNext: boolean = false;
    canGoPrevious: boolean = false;
    canPlay: boolean = false;
    canPause: boolean = false;
    canSeek: boolean = false;
    canControl: boolean = false;
    metadata?: Metadata;
  }

  export class Stream {
    constructor(json: StreamJson) {
      this.fromJson(json);
    }

    fromJson(json: StreamJson) {
      this.id = json.id;
      this.status = json.status;
      this.properties = new Properties(json.properties ?? {});
      const juri = json.uri;
      this.uri = {
        raw: juri.raw,
        scheme: juri.scheme,
        host: juri.host,
        path: juri.path,
        fragment: juri.fragment,
        query: juri.query,
      };
    }

    id: string = '';
    status: string = '';
    uri!: {
      raw: string;
      scheme: string;
      host: string;
      path: string;
      fragment: string;
      query: Record<string, string>;
    };

    properties!: Properties;
  }

  export class Server {
    constructor(json?: ServerJson) {
      if (json) this.fromJson(json);
    }

    fromJson(json: ServerJson) {
      this.groups = json.groups.map((group) => new Group(group));
      const jsnapserver = json.server.snapserver;
      this.server = {
        host: new Host(json.server.host),
        snapserver: {
          controlProtocolVersion: jsnapserver.controlProtocolVersion,
          name: jsnapserver.name,
          protocolVersion: jsnapserver.protocolVersion,
          version: jsnapserver.version,
        },
      };
      this.streams = json.streams.map((stream) => new Stream(stream));
    }

    groups: Group[] = [];
    server!: {
      host: Host;
      snapserver: {
        controlProtocolVersion: number;
        name: string;
        protocolVersion: number;
        version: string;
      };
    };
    streams: Stream[] = [];

    getClient(id: string): Client | null {
      for (const group of this.groups) {
        const client = group.getClient(id);
        if (client) return client;
      }
      return null;
    }

    getGroup(id: string): Group | null {
      for (const group of this.groups) {
        if (group.id === id) return group;
      }
      return null;
    }

    getStream(id: string): Stream | null {
      for (const stream of this.streams) {
        if (stream.id === id) return stream;
      }
      return null;
    }
  }
}

// Time to wait before reconnecting after the control connection is lost
const RECONNECT_DELAY_MS = 1000;
// The control connection is often idle for long stretches, and some proxies
// and tunnels (e.g. Cloudflare) close idle WebSockets after 20-30 s
const KEEPALIVE_INTERVAL_MS = 10000;
const KEEPALIVE_TIMEOUT_MS = 3 * KEEPALIVE_INTERVAL_MS;
// After a failed request the status is refetched after this delay, doubled
// for every further failure up to the maximum, so a server that keeps
// failing isn't flooded with requests
const STATUS_RETRY_MIN_MS = 1000;
const STATUS_RETRY_MAX_MS = 30000;
// Methods Snapserver answers before the connection is authenticated
const UNAUTHENTICATED_METHODS = new Set(['Server.Authenticate', 'Server.GetToken', 'Server.GetRPCVersion']);

class SnapControl {
  onChange: ((_this: SnapControl, _server: Snapcast.Server) => void) | null = null;
  onConnectionChanged: ((_this: SnapControl, _connected: boolean, _error?: string) => void) | null = null;
  // Called when the server starts or stops asking for a login
  onAuthRequired: ((_this: SnapControl, _required: boolean) => void) | null = null;
  connection?: WebSocket;
  server: Snapcast.Server = new Snapcast.Server();
  msg_id: number = 0;
  status_req_id: number = -1;
  timer: ReturnType<typeof setTimeout> | null = null;
  keepalive: ReturnType<typeof setInterval> | null = null;
  lastMessage: number = 0;
  // The login used on every (re)connect: a token from Server.GetToken, or
  // the Basic param when the server can't issue tokens (kept in memory only)
  token?: string;
  basic?: string;
  authRequired: boolean = false;
  private baseUrl: string = '';
  // Requests waiting for their response
  private requests = new Map<
    number,
    { method: string; resolve?: (result: any) => void; reject?: (reason: Error) => void }
  >();
  // Requests held back while Server.Authenticate is answered, so they don't
  // reach the server before it
  private queue: { id: number; message: string }[] | null = null;
  private refetchTimer: ReturnType<typeof setTimeout> | null = null;
  private refetchDelay: number = STATUS_RETRY_MIN_MS;

  public connect(baseUrl: string) {
    this.disconnect();
    this.baseUrl = baseUrl;
    this.token ??= authToken.get();
    try {
      const connection = new WebSocket(baseUrl + '/jsonrpc');
      this.connection = connection;
      connection.onmessage = (msg: MessageEvent) => this.onMessage(msg.data);
      connection.onopen = () => {
        console.info('Control connected to ' + baseUrl);
        void this.startSession(connection);
        this.lastMessage = Date.now();
        this.keepalive = setInterval(() => {
          // A half-open connection (NAT timeout, network change) stays OPEN
          // without delivering anything; reconnect when the keepalive replies
          // stop arriving instead of waiting for the browser to notice
          if (Date.now() - this.lastMessage > KEEPALIVE_TIMEOUT_MS) {
            console.warn('Control connection to ' + baseUrl + ' stopped responding, reconnecting');
            this.onConnectionChanged?.(this, false, 'Connection lost, trying to reconnect.');
            this.connect(baseUrl);
            return;
          }
          this.sendRequest('Server.GetRPCVersion');
        }, KEEPALIVE_INTERVAL_MS);
        this.onConnectionChanged?.(this, true);
      };
      connection.onerror = (ev: Event) => {
        console.error('Control connection error:', ev);
      };
      connection.onclose = (ev?: CloseEvent) => {
        this.stopKeepalive();
        this.resetRequests();
        console.info(
          'Control disconnected (code ' +
            ev?.code +
            (ev?.reason ? ', ' + ev.reason : '') +
            '), reconnecting in ' +
            RECONNECT_DELAY_MS +
            ' ms',
        );
        this.onConnectionChanged?.(this, false, 'Connection lost, trying to reconnect.');
        this.timer = setTimeout(() => this.connect(baseUrl), RECONNECT_DELAY_MS);
      };
    } catch (e) {
      this.onConnectionChanged?.(this, false, 'Exception while connecting: "' + e + '", trying to reconnect.');
      this.timer = setTimeout(() => this.connect(baseUrl), RECONNECT_DELAY_MS);
    }
  }

  public disconnect() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.stopKeepalive();
    this.resetRequests();
    const connection = this.connection;
    if (connection) {
      // Detach first, so nothing the old connection still delivers, including
      // a late onopen while it was connecting, affects the next one
      connection.onopen = null;
      connection.onmessage = null;
      connection.onerror = null;
      connection.onclose = null;
      if (connection.readyState === WebSocket.CONNECTING || connection.readyState === WebSocket.OPEN)
        connection.close();
      this.connection = undefined;
    }
    this.onConnectionChanged?.(this, false);
  }

  // Logs in with a user name and password. Throws an Error with a message for
  // the user when the login is rejected or the server can't be reached.
  public async login(username: string, password: string, remember: boolean) {
    const basic = base64(username + ':' + password);
    const failure = await this.authenticate({ scheme: 'Basic', param: basic }).then(
      () => undefined,
      (e: unknown) => e,
    );
    if (failure instanceof RequestError && needsLogin(failure.error)) throw new Error('Wrong user name or password');
    if (failure instanceof RequestError) throw new Error('Login failed: ' + failure.message);
    if (failure) throw new Error('Not connected to Snapserver');
    this.requestStatus();
    // Prefer a token, so the password needn't be kept. Snapserver versions
    // without Server.GetToken answer "method not found".
    let token: unknown;
    try {
      token = (await this.call('Server.GetToken', { username, password }))?.token;
    } catch (e) {
      console.info('No login token from the server (' + (e as Error).message + '), keeping the login in memory');
    }
    if (typeof token === 'string' && token !== '') {
      this.token = token;
      this.basic = undefined;
      authToken.set(token, remember);
    } else {
      this.token = undefined;
      this.basic = basic;
      authToken.clear();
    }
  }

  get loggedIn(): boolean {
    return this.token !== undefined || this.basic !== undefined;
  }

  // Forgets the login, including a stored token, without reconnecting
  public forgetLogin() {
    this.token = undefined;
    this.basic = undefined;
    authToken.clear();
    this.setAuthRequired(false);
  }

  // Forgets the login and reconnects, which ends the authenticated session
  public logout() {
    this.forgetLogin();
    if (this.connection) this.connect(this.baseUrl);
  }

  // Authenticates a new connection with the login held, if any, and then
  // requests the status. An expired token falls back to the Basic param, or
  // asks for a new login.
  private async startSession(connection: WebSocket) {
    const attempts: Credentials[] = [];
    if (this.token) attempts.push({ scheme: 'Bearer', param: this.token });
    if (this.basic) attempts.push({ scheme: 'Basic', param: this.basic });
    for (const credentials of attempts) {
      try {
        await this.authenticate(credentials);
        break;
      } catch (e) {
        // Closed or replaced while authenticating
        if (!(e instanceof RequestError) || connection !== this.connection) return;
        if (!needsLogin(e.error)) {
          // e.g. a server without authentication; the status request tells
          console.warn('Server.Authenticate failed:', e.error);
          break;
        }
        console.warn(credentials.scheme + ' login rejected');
        if (credentials.scheme === 'Bearer') {
          this.token = undefined;
          authToken.clear();
        } else {
          this.basic = undefined;
        }
        if (!this.loggedIn) {
          this.setAuthRequired(true);
          return;
        }
      }
    }
    this.requestStatus();
  }

  // Sends Server.Authenticate ahead of everything requested meanwhile
  private async authenticate(credentials: Credentials) {
    const queue: { id: number; message: string }[] = [];
    this.queue = queue;
    try {
      await this.call('Server.Authenticate', { scheme: credentials.scheme, param: credentials.param });
    } catch (e) {
      // They would only fail; the status is fetched again after the login
      if (queue.length) console.warn('Dropping ' + queue.length + ' requests sent before the login');
      for (const { id } of queue) this.requests.delete(id);
      throw e;
    } finally {
      if (this.queue === queue) this.queue = null;
    }
    this.setAuthRequired(false);
    for (const { message } of queue) this.connection?.send(message);
  }

  private setAuthRequired(required: boolean) {
    if (this.authRequired === required) return;
    this.authRequired = required;
    if (required) this.cancelRefetch();
    this.onAuthRequired?.(this, required);
  }

  private requestStatus() {
    this.status_req_id = this.sendRequest('Server.GetStatus');
  }

  // Refetches the status after a failed request. Failures while a refetch is
  // pending share it, and the delay grows until a status arrives.
  private scheduleRefetch() {
    if (this.refetchTimer) return;
    console.info('Refetching the status in ' + this.refetchDelay + ' ms');
    this.refetchTimer = setTimeout(() => {
      this.refetchTimer = null;
      this.requestStatus();
    }, this.refetchDelay);
    this.refetchDelay = Math.min(2 * this.refetchDelay, STATUS_RETRY_MAX_MS);
  }

  private cancelRefetch() {
    if (this.refetchTimer) clearTimeout(this.refetchTimer);
    this.refetchTimer = null;
  }

  // Fails the requests still waiting for a response, and forgets the rest
  private resetRequests() {
    this.cancelRefetch();
    this.refetchDelay = STATUS_RETRY_MIN_MS;
    this.queue = null;
    const requests = [...this.requests.values()];
    this.requests.clear();
    for (const request of requests) request.reject?.(new Error('Connection closed'));
  }

  private stopKeepalive() {
    if (this.keepalive) clearInterval(this.keepalive);
    this.keepalive = null;
  }

  private onNotification(notification: Notification) {
    const params = notification.params;
    switch (notification.method) {
      case 'Client.OnVolumeChanged':
        this.getClient(params.id).config.volume = params.volume;
        break;
      case 'Client.OnLatencyChanged':
        this.getClient(params.id).config.latency = params.latency;
        break;
      case 'Client.OnNameChanged':
        this.getClient(params.id).config.name = params.name;
        break;
      case 'Client.OnConnect':
      case 'Client.OnDisconnect':
        this.getClient(params.client.id).fromJson(params.client);
        break;
      case 'Group.OnMute':
        this.getGroup(params.id).muted = Boolean(params.mute);
        break;
      case 'Group.OnStreamChanged':
        this.getGroup(params.id).stream_id = params.stream_id;
        break;
      case 'Group.OnNameChanged':
        this.getGroup(params.id).name = params.name;
        break;
      case 'Stream.OnUpdate':
        this.getStream(params.id).fromJson(params.stream);
        break;
      case 'Stream.OnProperties':
        console.info('Stream ' + params.id + ' metadata:', params.properties?.metadata);
        this.getStream(params.id).properties.fromJson(params.properties);
        break;
      case 'Server.OnUpdate':
        this.server.fromJson(params.server);
        break;
    }
  }

  public getClient(client_id: string): Snapcast.Client {
    const client = this.server.getClient(client_id);
    if (client == null) {
      throw new Error(`client ${client_id} was null`);
    }
    return client;
  }

  public getGroup(group_id: string): Snapcast.Group {
    const group = this.server.getGroup(group_id);
    if (group == null) {
      throw new Error(`group ${group_id} was null`);
    }
    return group;
  }

  public getGroupVolume(group: Snapcast.Group, online: boolean): number {
    const clients = group.clients.filter((client) => !online || client.connected);
    if (clients.length === 0) return 0;
    return clients.reduce((sum, client) => sum + client.config.volume.percent, 0) / clients.length;
  }

  public getGroupFromClient(client_id: string): Snapcast.Group {
    for (const group of this.server.groups)
      for (const client of group.clients) if (client.id === client_id) return group;
    throw new Error(`group for client ${client_id} was null`);
  }

  public getStreamFromClient(client_id: string): Snapcast.Stream {
    const group: Snapcast.Group = this.getGroupFromClient(client_id);
    return this.getStream(group.stream_id);
  }

  public getStream(stream_id: string): Snapcast.Stream {
    const stream = this.server.getStream(stream_id);
    if (stream == null) {
      throw new Error(`stream ${stream_id} was null`);
    }
    return stream;
  }

  public setVolume(client_id: string, percent: number, mute?: boolean) {
    // Snapserver stores whole percents
    percent = Math.round(Math.max(0, Math.min(100, percent)));
    const client = this.getClient(client_id);
    client.config.volume.percent = percent;
    if (mute !== undefined) client.config.volume.muted = mute;
    this.sendRequest('Client.SetVolume', {
      id: client_id,
      volume: { muted: client.config.volume.muted, percent: client.config.volume.percent },
    });
  }

  public setClientName(client_id: string, name: string) {
    const client = this.getClient(client_id);
    if (name !== client.getName()) {
      this.sendRequest('Client.SetName', { id: client_id, name: name });
      client.config.name = name;
    }
  }

  public setClientLatency(client_id: string, latency: number) {
    const client = this.getClient(client_id);
    if (latency !== client.config.latency) {
      this.sendRequest('Client.SetLatency', { id: client_id, latency: latency });
      client.config.latency = latency;
    }
  }

  public deleteClient(client_id: string) {
    this.sendRequest('Server.DeleteClient', { id: client_id });
    for (const group of this.server.groups) group.clients = group.clients.filter((client) => client.id !== client_id);
    this.server.groups = this.server.groups.filter((group) => group.clients.length > 0);
  }

  public setStream(group_id: string, stream_id: string) {
    this.getGroup(group_id).stream_id = stream_id;
    this.sendRequest('Group.SetStream', { id: group_id, stream_id: stream_id });
  }

  public setClients(group_id: string, clients: string[]) {
    // The response carries the new server status
    this.status_req_id = this.sendRequest('Group.SetClients', { id: group_id, clients: clients });
  }

  public muteGroup(group_id: string, mute: boolean) {
    this.getGroup(group_id).muted = mute;
    this.sendRequest('Group.SetMute', { id: group_id, mute: mute });
  }

  public control(stream_id: string, command: string, params?: Record<string, unknown>) {
    this.sendRequest('Stream.Control', params ? { id: stream_id, command, params } : { id: stream_id, command });
  }

  // Returns the request id. While not connected nothing is sent; the next
  // Server.GetStatus after reconnecting brings the model back in line.
  private sendRequest(method: string, params?: Record<string, unknown>): number {
    const id = ++this.msg_id;
    if (this.connection?.readyState !== WebSocket.OPEN) {
      console.warn('Not connected, dropping ' + method);
      return id;
    }
    const message = JSON.stringify(params ? { id, jsonrpc: '2.0', method, params } : { id, jsonrpc: '2.0', method });
    this.requests.set(id, { method });
    if (this.queue && !UNAUTHENTICATED_METHODS.has(method)) this.queue.push({ id, message });
    else this.connection.send(message);
    return id;
  }

  // Sends a request and resolves with its result, or rejects with a
  // RequestError for an error reply and an Error when not connected
  private call(method: string, params?: Record<string, unknown>): Promise<any> {
    return new Promise((resolve, reject) => {
      if (this.connection?.readyState !== WebSocket.OPEN) {
        reject(new Error('Not connected'));
        return;
      }
      const id = this.sendRequest(method, params);
      this.requests.set(id, { method, resolve, reject });
    });
  }

  private onRequestError(id: number, method: string | undefined, error: RpcError) {
    if (needsLogin(error)) {
      // Refetching would only fail again until someone logs in
      console.warn((method ?? 'Request ' + id) + ' needs a login');
      this.setAuthRequired(true);
      return;
    }
    console.warn('Request ' + id + ' (' + (method ?? 'unknown') + ') failed:', error);
    // Stream.Control doesn't change the model, e.g. "Stream can not be
    // controlled", so there is nothing to bring back in line
    if (method === 'Stream.Control') return;
    // Requests change the model before the server answers, so a failed one
    // (or a failed status request) leaves it out of line: refetch it
    this.scheduleRefetch();
  }

  private onMessage(msg: string) {
    this.lastMessage = Date.now();
    let json_msg;
    try {
      json_msg = JSON.parse(msg);
    } catch (e) {
      console.warn('Ignoring malformed control message: ' + e);
      return;
    }
    if (json_msg.id !== undefined) {
      const request = this.requests.get(json_msg.id);
      this.requests.delete(json_msg.id);
      if (request?.resolve) {
        if (json_msg.error) request.reject?.(new RequestError(json_msg.error));
        else request.resolve(json_msg.result);
        return;
      }
      if (json_msg.error) {
        this.onRequestError(json_msg.id, request?.method, json_msg.error);
        return;
      }
      // Responses only matter when they carry the server status
      if (json_msg.id !== this.status_req_id) return;
      this.server = new Snapcast.Server(json_msg.result.server);
      this.refetchDelay = STATUS_RETRY_MIN_MS;
      this.setAuthRequired(false);
      for (const stream of this.server.streams)
        console.info('Stream ' + stream.id + ' metadata:', stream.properties.metadata);
    } else {
      for (const notification of Array.isArray(json_msg) ? json_msg : [json_msg]) {
        try {
          this.onNotification(notification);
        } catch (e) {
          // e.g. a client or group this model doesn't know (yet)
          console.warn('Failed to apply ' + notification.method + ': ' + e);
        }
      }
    }
    this.onChange?.(this, this.server);
  }
}

export { SnapControl, base64, needsLogin };
export { Snapcast };
