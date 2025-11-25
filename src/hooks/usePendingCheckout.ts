/**
 * Hook to track pending Stripe Checkout sessions for license extensions.
 * Stores fanmarkId in localStorage with a 30-minute expiry to warn users
 * if they attempt to return a fanmark while a checkout is in progress.
 */
export const usePendingCheckout = () => {
  const STORAGE_KEY = 'fanmark_pending_checkout';
  const EXPIRY_MS = 30 * 60 * 1000; // 30 minutes

  const setPendingCheckout = (fanmarkId: string) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      fanmarkId,
      timestamp: Date.now()
    }));
  };

  const clearPendingCheckout = () => {
    localStorage.removeItem(STORAGE_KEY);
  };

  const getPendingCheckout = (): { fanmarkId: string } | null => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return null;
    
    try {
      const { fanmarkId, timestamp } = JSON.parse(stored);
      if (Date.now() - timestamp > EXPIRY_MS) {
        clearPendingCheckout();
        return null;
      }
      return { fanmarkId };
    } catch {
      clearPendingCheckout();
      return null;
    }
  };

  return { setPendingCheckout, clearPendingCheckout, getPendingCheckout };
};
