import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  authToken,
  config,
  getClientId,
  getPersistentValue,
  normalizeBaseUrl,
  setPersistentValue,
  Theme,
  uuidv4,
} from '../../src/config';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('config', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('stores and reads persistent values', () => {
    setPersistentValue('k', 'v');
    expect(getPersistentValue('k')).toBe('v');
  });

  it('writes back the default for missing values', () => {
    expect(getPersistentValue('missing', 'fallback')).toBe('fallback');
    expect(window.localStorage.getItem('missing')).toBe('fallback');
    expect(getPersistentValue('other')).toBe('');
  });

  it('defaults the server url to the page host', () => {
    expect(config.baseUrl).toBe('ws://' + window.location.host);
  });

  it('round-trips the server url', () => {
    config.baseUrl = 'ws://10.0.0.1:1780';
    expect(config.baseUrl).toBe('ws://10.0.0.1:1780');
  });

  it('defaults to the system theme and round-trips it', () => {
    expect(config.theme).toBe(Theme.System);
    config.theme = Theme.Dark;
    expect(config.theme).toBe(Theme.Dark);
  });

  it('defaults to hiding offline clients and round-trips it', () => {
    expect(config.showOffline).toBe(false);
    config.showOffline = true;
    expect(config.showOffline).toBe(true);
    expect(window.localStorage.getItem('showoffline')).toBe('true');
  });

  it('creates the client id once and keeps it', () => {
    const id = getClientId();
    expect(id).toMatch(uuidPattern);
    expect(getClientId()).toBe(id);
    expect(window.localStorage.getItem('uniqueId')).toBe(id);
  });

  it('falls back to the system theme for unknown stored values', () => {
    window.localStorage.setItem('theme', 'purple');
    expect(config.theme).toBe(Theme.System);
  });

  it('keeps working when storage throws', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });

    expect(config.showOffline).toBe(false);
    expect(() => (config.showOffline = true)).not.toThrow();
    const id = getClientId();
    expect(getClientId()).toBe(id);
  });

  it('generates UUIDs without crypto.randomUUID', () => {
    vi.stubGlobal('crypto', {});
    expect(uuidv4()).toMatch(uuidPattern);
  });
});

describe('normalizeBaseUrl', () => {
  it.each([
    ['ws://host:1780', 'ws://host:1780'],
    ['wss://host:1780', 'wss://host:1780'],
    ['ws://host:1780/', 'ws://host:1780'],
    ['  ws://host:1780//  ', 'ws://host:1780'],
    ['host:1780', 'ws://host:1780'],
    ['http://host:1780', 'ws://host:1780'],
    ['HTTPS://host:1780', 'wss://host:1780'],
    ['ws://host:1780/jsonrpc', 'ws://host:1780'],
    ['http://host:1780/stream/', 'ws://host:1780'],
  ])('turns %j into %j', (input, expected) => {
    expect(normalizeBaseUrl(input)).toBe(expected);
  });

  it('uses the default for an empty value', () => {
    expect(normalizeBaseUrl('  ')).toBe('ws://' + window.location.host);
  });

  it('stores the normalized url', () => {
    config.baseUrl = 'host:1780/';
    expect(window.localStorage.getItem('snapserver.host')).toBe('ws://host:1780');
  });

  it('stores the default as empty, so it follows the page host', () => {
    window.localStorage.clear();
    expect(config.baseUrl).toBe('ws://' + window.location.host);
    expect(window.localStorage.getItem('snapserver.host')).toBeNull();

    config.baseUrl = window.location.host;
    expect(window.localStorage.getItem('snapserver.host')).toBe('');
    config.baseUrl = '';
    expect(window.localStorage.getItem('snapserver.host')).toBe('');
    expect(config.baseUrl).toBe('ws://' + window.location.host);
  });

  it('keeps the login token for the session, or in localStorage when remembered', () => {
    window.sessionStorage.clear();
    authToken.set('session', false);
    expect(window.sessionStorage.getItem('auth.token')).toBe('session');
    expect(authToken.get()).toBe('session');

    authToken.set('remembered', true);
    expect(window.localStorage.getItem('auth.token')).toBe('remembered');
    expect(window.sessionStorage.getItem('auth.token')).toBeNull();
    expect(authToken.get()).toBe('remembered');

    authToken.clear();
    expect(authToken.get()).toBeUndefined();
  });
});
