import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';

export interface SubscriptionStatus {
  subscribed: boolean;
  product_id: string | null;
  subscription_end: string | null;
  loading: boolean;
  error: string | null;
}

const POLLING_INTERVAL = 60000; // 1 minute

export function useSubscription() {
  const { user } = useAuth();
  const [status, setStatus] = useState<SubscriptionStatus>({
    subscribed: false,
    product_id: null,
    subscription_end: null,
    loading: true,
    error: null,
  });

  const checkSubscription = useCallback(async () => {
    if (!user) {
      setStatus({
        subscribed: false,
        product_id: null,
        subscription_end: null,
        loading: false,
        error: null,
      });
      return;
    }

    try {
      setStatus(prev => ({ ...prev, loading: true, error: null }));

      const { data, error } = await supabase.functions.invoke('check-subscription', {
        headers: {
          Authorization: `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`,
        },
      });

      if (error) {
        console.error('Error checking subscription:', error);
        setStatus(prev => ({
          ...prev,
          loading: false,
          error: error.message || 'Failed to check subscription',
        }));
        return;
      }

      setStatus({
        subscribed: data.subscribed || false,
        product_id: data.product_id || null,
        subscription_end: data.subscription_end || null,
        loading: false,
        error: null,
      });
    } catch (err) {
      console.error('Unexpected error checking subscription:', err);
      setStatus(prev => ({
        ...prev,
        loading: false,
        error: err instanceof Error ? err.message : 'Unknown error occurred',
      }));
    }
  }, [user]);

  // Initial check on mount and when user changes
  useEffect(() => {
    checkSubscription();
  }, [checkSubscription]);

  // Polling every minute
  useEffect(() => {
    if (!user) return;

    const intervalId = setInterval(() => {
      checkSubscription();
    }, POLLING_INTERVAL);

    return () => clearInterval(intervalId);
  }, [user, checkSubscription]);

  // Listen for checkout success via URL params
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('checkout') === 'success') {
      // Wait a bit for Stripe to process, then check
      const timeoutId = setTimeout(() => {
        checkSubscription();
      }, 2000);
      
      return () => clearTimeout(timeoutId);
    }
  }, [checkSubscription]);

  return {
    ...status,
    refetch: checkSubscription,
  };
}
