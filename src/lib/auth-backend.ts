import { createBetterAuthClient } from '@/lib/better-auth-client';

const configuredAuthApiUrl = import.meta.env.VITE_AUTH_API_BASE_URL?.trim();

export const betterAuthClient = createBetterAuthClient({
  baseUrl: configuredAuthApiUrl || (typeof window === 'undefined' ? '' : window.location.origin),
});
