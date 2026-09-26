/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_FANMARK_API_BASE_URL?: string;
  readonly VITE_PUBLIC_ACCESS_READ_BACKEND?: string;
  readonly VITE_VERIFIED_ACCESS_BACKEND?: string;
  readonly VITE_STORAGE_BACKEND?: string;
  readonly VITE_OWNED_FANMARKS_BACKEND?: string;
  readonly VITE_PROFILE_BACKEND?: string;
  readonly VITE_ACCOUNT_DELETION_BACKEND?: string;
  readonly VITE_FANMARK_PROFILE_BACKEND?: string;
  readonly VITE_FANMARK_SETTINGS_BACKEND?: string;
  readonly VITE_FANMARK_RETURN_BACKEND?: string;
  readonly VITE_FANMARK_REGISTRATION_BACKEND?: string;
  readonly VITE_FANMARK_LOTTERY_BACKEND?: string;
  readonly VITE_FANMARK_TRANSFER_BACKEND?: string;
  readonly VITE_FANMARK_SEARCH_BACKEND?: string;
  readonly VITE_FANMARK_DETAILS_BACKEND?: string;
  readonly VITE_FANMARK_ACCESS_ANALYTICS_BACKEND?: string;
  readonly VITE_FANMARK_ANALYTICS_BACKEND?: string;
  readonly VITE_NOTIFICATIONS_BACKEND?: string;
  readonly VITE_NOTIFICATION_MASTER_BACKEND?: string;
  readonly VITE_EMAIL_TEMPLATES_BACKEND?: string;
  readonly VITE_INVITATION_ADMIN_BACKEND?: string;
  readonly VITE_WAITLIST_ADMIN_BACKEND?: string;
  readonly VITE_MAINTENANCE_SETTINGS_BACKEND?: string;
  readonly VITE_LIFECYCLE_SETTINGS_BACKEND?: string;
  readonly VITE_SYSTEM_SETTINGS_BACKEND?: string;
  readonly VITE_SUBSCRIPTION_BACKEND?: string;
  readonly VITE_FAVORITES_BACKEND?: string;
  readonly VITE_LANGUAGE_READ_BACKEND?: string;
  readonly VITE_REFERENCE_MASTER_READ_BACKEND?: string;
  readonly VITE_REFERENCE_MASTER_ADMIN_BACKEND?: string;
  readonly VITE_STRIPE_EXTENSION_CHECKOUT_BACKEND?: string;
  readonly VITE_EXTENSION_COUPON_BACKEND?: string;
  readonly VITE_EXTENSION_COUPON_ADMIN_BACKEND?: string;
  readonly VITE_STRIPE_CUSTOMER_PORTAL_BACKEND?: string;
  readonly VITE_STRIPE_PLAN_CHECKOUT_BACKEND?: string;
  readonly VITE_STRIPE_PLAN_CHANGE_BACKEND?: string;
  readonly VITE_AUTH_API_BASE_URL?: string;
  readonly VITE_EMOJI_CATALOG_BACKEND?: string;
  readonly VITE_EMOJI_CATALOG_VERSION?: string;
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
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
