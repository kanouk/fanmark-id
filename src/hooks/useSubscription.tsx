import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';
import { getSubscriptionBackend, loadOwnSubscription, type SubscriptionRecord } from '@/lib/subscription-api';

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
  const backend = getSubscriptionBackend();
  const [status, setStatus] = useState<SubscriptionStatus>({ ...EMPTY_STATUS, loading: true });

  const fetchSubscription = useCallback(async (syncSupabase = false) => {
    if (!user) {
      setStatus({ ...EMPTY_STATUS });
      return;
    }

    setStatus((previous) => ({ ...previous, loading: true, error: null }));
    try {
      if (backend === 'worker') {
        // The Cloudflare read is intentionally read-only. Stripe state is projected by the Worker webhook path.
        const data = await loadOwnSubscription();
        setStatus(statusFromSubscription(data as SubscriptionRecord | null));
        return;
      }

      if (syncSupabase) {
        const { data: session } = await supabase.auth.getSession();
        if (session?.session) {
          const { error: syncError } = await supabase.functions.invoke('check-subscription', {
            headers: { Authorization: `Bearer ${session.session.access_token}` },
          });
          if (syncError) console.warn('[useSubscription] Subscription sync warning:', syncError);
        }
      }

      const { data, error } = await supabase
        .from('user_subscriptions')
        .select('*')
        .eq('user_id', user.id)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      setStatus(statusFromSubscription(data));
    } catch (error) {
      console.error('[useSubscription] Error fetching subscription:', error);
      setStatus((previous) => ({
        ...previous,
        loading: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      }));
    }
  }, [backend, user]);

  useEffect(() => {
    if (!user) {
      setStatus({ ...EMPTY_STATUS });
      return;
    }

    void fetchSubscription(backend === 'supabase');
    if (backend === 'supabase') {
      const channel = supabase
        .channel('user-subscription-updates')
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'user_subscriptions', filter: `user_id=eq.${user.id}` },
          () => { void fetchSubscription(false); },
        )
        .subscribe();
      return () => { void supabase.removeChannel(channel); };
    }

    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') void fetchSubscription(false);
    };
    window.addEventListener('focus', refreshWhenVisible);
    document.addEventListener('visibilitychange', refreshWhenVisible);
    return () => {
      window.removeEventListener('focus', refreshWhenVisible);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
    };
  }, [backend, fetchSubscription, user]);

  const refetch = useCallback(async () => {
    if (!user) return;
    await fetchSubscription(false);
  }, [fetchSubscription, user]);

  return { ...status, refetch };
}
