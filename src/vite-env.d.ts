/// <reference types="vite/client" />

interface ImportMetaEnv {
  // From package.json, see define in vite.config.ts
  readonly VITE_APP_NAME: string;
  readonly VITE_APP_VERSION: string;
  // Optional default Snapserver host, e.g. from .env.local
  readonly VITE_APP_SNAPSERVER_HOST?: string;
}
