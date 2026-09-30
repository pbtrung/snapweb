import { beforeEach, describe, expect, it } from 'vitest';
import { config, getPersistentValue, setPersistentValue, Theme } from '../../src/config';

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
});
