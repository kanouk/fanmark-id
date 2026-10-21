/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_FANMARK_API_BASE_URL?: string;
  readonly VITE_BROADCAST_SEND_BACKEND?: string;
  readonly VITE_BROADCAST_TEST_SEND_BACKEND?: string;
  readonly VITE_ADMIN_DATA_RESET_BACKEND?: string;
  readonly VITE_AUTH_API_BASE_URL?: string;
  readonly VITE_EMOJI_CATALOG_VERSION?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module 'virtual:pwa-register' {
  export interface RegisterSWOptions {
    immediate?: boolean;
    onNeedRefresh?: () => void;
    onOfflineReady?: () => void;
    onRegistered?: (registration: ServiceWorkerRegistration | undefined) => void;
    onRegisterError?: (error: unknown) => void;
  }

  export function registerSW(options?: RegisterSWOptions): (reloadPage?: boolean) => Promise<void>;
}
