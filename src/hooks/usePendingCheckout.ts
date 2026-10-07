import { useCallback } from 'react';

/**
 * Hook to track pending Stripe Checkout sessions for license extensions.
 * Stores fanmarkId in localStorage with a 30-minute expiry to warn users
 * if they attempt to return a fanmark while a checkout is in progress.
 */
const STORAGE_KEY = 'fanmark_pending_checkout';
const EXPIRY_MS = 30 * 60 * 1000; // 30 minutes

export const usePendingCheckout = () => {

  const setPendingCheckout = useCallback((fanmarkId: string, requestId?: string, userId?: string) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      fanmarkId,
      requestId,
      userId,
      timestamp: Date.now()
    }));
  }, []);

  const clearPendingCheckout = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
  }, []);

  const getPendingCheckout = useCallback((): { fanmarkId: string; requestId?: string; userId?: string } | null => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return null;
    
    try {
      const { fanmarkId, timestamp, requestId, userId } = JSON.parse(stored);
      if (typeof fanmarkId !== 'string' || typeof timestamp !== 'number' || Date.now() - timestamp > EXPIRY_MS) {
        clearPendingCheckout();
        return null;
      }
      return { fanmarkId, requestId, userId };
    } catch {
      clearPendingCheckout();
      return null;
    }
  }, [clearPendingCheckout]);

  return { setPendingCheckout, clearPendingCheckout, getPendingCheckout };
};
