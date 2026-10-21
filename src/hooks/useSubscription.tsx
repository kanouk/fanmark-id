import { useCallback, useEffect, useState } from 'react';

import { useAuth } from './useAuth';
import { loadOwnSubscription, type SubscriptionRecord } from '@/lib/subscription-api';

export interface SubscriptionStatus {
  subscribed: boolean;
  status: string | null;
  product_id: string | null;
  subscription_start: string | null;
  subscription_end: string | null;
  amount: number | null;
  currency: string | null;
  interval: string | null;
  interval_count: number | null;
  cancel_at_period_end: boolean;
  paymentFailureAt: string | null;
  nextPaymentAttempt: string | null;
  paymentFailureType: string | null;
  loading: boolean;
  error: string | null;
}

type SubscriptionSource = {
  status?: string | null;
  product_id?: string | null;
  current_period_start?: string | null;
  current_period_end?: string | null;
  amount?: number | null;
  currency?: string | null;
  interval?: string | null;
  interval_count?: number | null;
  cancel_at_period_end?: boolean | null;
  payment_failure_at?: string | null;
  next_payment_attempt?: string | null;
  payment_failure_type?: string | null;
};

function statusFromSubscription(data: SubscriptionSource | null): SubscriptionStatus {
  return {
    subscribed: data?.status === 'active',
    status: data?.status ?? null,
    product_id: data?.product_id ?? null,
    subscription_start: data?.current_period_start ?? null,
    subscription_end: data?.current_period_end ?? null,
    amount: data?.amount ?? null,
    currency: data?.currency ?? null,
    interval: data?.interval ?? null,
    interval_count: data?.interval_count ?? null,
    cancel_at_period_end: data?.cancel_at_period_end ?? false,
    paymentFailureAt: data?.payment_failure_at ?? null,
    nextPaymentAttempt: data?.next_payment_attempt ?? null,
    paymentFailureType: data?.payment_failure_type ?? null,
    loading: false,
    error: null,
  };
}

const EMPTY_STATUS = statusFromSubscription(null);

export function useSubscription() {
  const { user } = useAuth();
    const [status, setStatus] = useState<SubscriptionStatus>({ ...EMPTY_STATUS, loading: true });

  const fetchSubscription = useCallback(async (synchronizePlan = false, silent = false) => {
    if (!user) {
      setStatus({ ...EMPTY_STATUS });
      return;
    }

    if (!silent) {
      setStatus((previous) => ({ ...previous, loading: true, error: null }));
    }
    try {
      {
        // The Cloudflare read is intentionally read-only. Stripe state is projected by the Worker webhook path.
        const data = await loadOwnSubscription();
        setStatus(statusFromSubscription(data as SubscriptionRecord | null));
        return;
      }

    } catch (error) {
      if (silent) {
        console.warn('[useSubscription] Background refresh failed:', error);
      } else {
        console.error('[useSubscription] Error fetching subscription:', error);
        setStatus((previous) => ({
          ...previous,
          loading: false,
          error: error instanceof Error ? error.message : 'Unknown error occurred',
        }));
      }
    }
  }, [user]);

  useEffect(() => {
    if (!user) {
      setStatus({ ...EMPTY_STATUS });
      return;
    }

    let refreshPending = true;
    void fetchSubscription(false).finally(() => { refreshPending = false; });
    const refreshWhenVisible = () => {
      if (document.visibilityState !== 'visible' || refreshPending) return;
      refreshPending = true;
      void fetchSubscription(false, true).finally(() => { refreshPending = false; });
    };
    window.addEventListener('focus', refreshWhenVisible);
    document.addEventListener('visibilitychange', refreshWhenVisible);
    const intervalId = window.setInterval(refreshWhenVisible, 30_000);
    return () => {
      window.removeEventListener('focus', refreshWhenVisible);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
      window.clearInterval(intervalId);
    };
  }, [fetchSubscription, user]);

  const refetch = useCallback(async () => {
    if (!user) return;
    await fetchSubscription(false);
  }, [fetchSubscription, user]);

  return { ...status, refetch };
}
