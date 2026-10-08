const keys = {
  snapserver_host: 'snapserver.host',
  theme: 'theme',
  showoffline: 'showoffline',
  clientId: 'uniqueId',
};

enum Theme {
  System = 'system',
  Light = 'light',
  Dark = 'dark',
}

// Storage may be missing, or throw when site data is blocked or full; the
// app then keeps working with defaults for this page load
function storage(): Storage | undefined {
  try {
    return window.localStorage ?? undefined;
  } catch {
    return undefined;
  }
}

function setPersistentValue(key: string, value: string) {
  try {
    storage()?.setItem(key, value);
  } catch (e) {
    console.warn('Failed to store ' + key + ': ' + e);
  }
}

function readPersistentValue(key: string): string | undefined {
  try {
    return storage()?.getItem(key) ?? undefined;
  } catch (e) {
    console.warn('Failed to read ' + key + ': ' + e);
    return undefined;
  }
}

function getPersistentValue(key: string, defaultValue: string = ''): string {
  const value = readPersistentValue(key);
  if (value !== undefined) return value;
  setPersistentValue(key, defaultValue);
  return defaultValue;
}

function uuidv4(): string {
  // crypto.randomUUID is only available in secure contexts (https/localhost)
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    try {
      return crypto.randomUUID();
    } catch {
      // fall through to the Math.random based implementation
    }
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0,
      v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// Generated once per page load, so the audio stream and the media session
// agree on the id even when it can't be stored
let generatedClientId: string | undefined;

// The id this browser registers with on the audio stream, created once
function getClientId(): string {
  const stored = readPersistentValue(keys.clientId);
  if (stored) return stored;
  generatedClientId ??= uuidv4();
  setPersistentValue(keys.clientId, generatedClientId);
  return generatedClientId;
}

function defaultBaseUrl(): string {
  const host = import.meta.env.VITE_APP_SNAPSERVER_HOST || window.location.host;
  return (window.location.protocol === 'https:' ? 'wss://' : 'ws://') + host;
}

// Accepts "host:1780", "http(s)://host:1780", "ws(s)://host:1780/" or
// "ws(s)://host:1780/jsonrpc" and returns "ws(s)://host:1780", which the
// /jsonrpc and /stream paths are appended to. An empty value means the default.
function normalizeBaseUrl(value: string): string {
  let url = value
    .trim()
    .replace(/\/+$/, '')
    .replace(/\/(jsonrpc|stream)$/i, '');
  if (url === '') return defaultBaseUrl();
  url = url.replace(/^http(s?):\/\//i, (_, secure: string) => (secure ? 'wss://' : 'ws://'));
  if (!/^wss?:\/\//i.test(url)) url = (window.location.protocol === 'https:' ? 'wss://' : 'ws://') + url;
  return url;
}

const config = {
  // The default is stored as '' rather than as a url, so it follows the page
  // location and VITE_APP_SNAPSERVER_HOST instead of being frozen
  get baseUrl() {
    return normalizeBaseUrl(readPersistentValue(keys.snapserver_host) ?? '');
  },
  set baseUrl(value) {
    const url = normalizeBaseUrl(value);
    setPersistentValue(keys.snapserver_host, url === defaultBaseUrl() ? '' : url);
  },
  get theme() {
    const theme = getPersistentValue(keys.theme, Theme.System);
    return Object.values(Theme).includes(theme as Theme) ? (theme as Theme) : Theme.System;
  },
  set theme(value: Theme) {
    setPersistentValue(keys.theme, value);
  },
  get showOffline() {
    return getPersistentValue(keys.showoffline, String(false)) === String(true);
  },
  set showOffline(value: boolean) {
    setPersistentValue(keys.showoffline, String(value));
  },
};

export { config, getClientId, getPersistentValue, normalizeBaseUrl, setPersistentValue, Theme, uuidv4 };
