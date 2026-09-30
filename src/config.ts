const host = import.meta.env.VITE_APP_SNAPSERVER_HOST || window.location.host;

const keys = {
  snapserver_host: "snapserver.host",
  theme: "theme",
  showoffline: "showoffline"
}

enum Theme {
  System = "system",
  Light = "light",
  Dark = "dark",
}

function setPersistentValue(key: string, value: string) {
  if (window.localStorage) {
    window.localStorage.setItem(key, value);
  }
}

function getPersistentValue(key: string, defaultValue: string = ""): string {
  if (window.localStorage) {
    const value = window.localStorage.getItem(key);
    if (value !== null) {
      return value;
    }
    window.localStorage.setItem(key, defaultValue);
    return defaultValue;
  }
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
    const r = Math.random() * 16 | 0, v = c === 'x' ? r : ((r & 0x3) | 0x8);
    return v.toString(16);
  });
}

// The id this browser registers with on the audio stream, created once
function getClientId(): string {
  return getPersistentValue("uniqueId", uuidv4());
}

const config = {
  get baseUrl() {
    return getPersistentValue(keys.snapserver_host, (window.location.protocol === "https:" ? "wss://" : "ws://") + host);
  },
  set baseUrl(value) {
    setPersistentValue(keys.snapserver_host, value);
  },
  get theme() {
    return getPersistentValue(keys.theme, Theme.System.toString()) as Theme;
  },
  set theme(value: Theme) {
    setPersistentValue(keys.theme, value);
  },
  get showOffline() {
    return getPersistentValue(keys.showoffline, String(false)) === String(true);
  },
  set showOffline(value: boolean) {
    setPersistentValue(keys.showoffline, String(value));
  }
};


export { config, getClientId, getPersistentValue, setPersistentValue, Theme };
