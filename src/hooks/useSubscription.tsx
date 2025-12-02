import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';

export interface SubscriptionStatus {
  subscribed: boolean;
  product_id: string | null;
  subscription_start: string | null;
  subscription_end: string | null;
  amount: number | null;
  currency: string | null;
  interval: string | null;
  interval_count: number | null;
  cancel_at_period_end: boolean;
  loading: boolean;
  error: string | null;
}

export function useSubscription() {
  const { user } = useAuth();
  const [status, setStatus] = useState<SubscriptionStatus>({
    subscribed: false,
    product_id: null,
    subscription_start: null,
    subscription_end: null,
    amount: null,
    currency: null,
    interval: null,
    interval_count: null,
    cancel_at_period_end: false,
    loading: true,
    error: null,
  });

  useEffect(() => {
    if (!user) {
      setStatus({
        subscribed: false,
        product_id: null,
        subscription_start: null,
        subscription_end: null,
        amount: null,
        currency: null,
        interval: null,
        interval_count: null,
        cancel_at_period_end: false,
        loading: false,
        error: null,
      });
      return;
    }

    const fetchSubscription = async () => {
      try {
        setStatus(prev => ({ ...prev, loading: true, error: null }));

        // Step 1: Call check-subscription Edge Function to sync with Stripe
        const { data: session } = await supabase.auth.getSession();
        if (session?.session) {
          console.log('[useSubscription] Calling check-subscription to sync with Stripe...');
          const { error: syncError } = await supabase.functions.invoke('check-subscription', {
            headers: {
              Authorization: `Bearer ${session.session.access_token}`
            }
          });
          if (syncError) {
            console.warn('[useSubscription] Subscription sync warning:', syncError);
          } else {
            console.log('[useSubscription] Stripe sync completed');
          }
        }

        // Step 2: Fetch from database after sync
        const { data, error } = await supabase
          .from('user_subscriptions')
          .select('*')
          .eq('user_id', user.id)
          .eq('status', 'active')
          .maybeSingle();

        if (error) {
          console.error('[useSubscription] Error fetching subscription:', error);
          setStatus(prev => ({
            ...prev,
            loading: false,
            error: error.message,
          }));
          return;
        }

        console.log('[useSubscription] Subscription data from DB:', data);

        setStatus({
          subscribed: !!data,
          product_id: data?.product_id || null,
          subscription_start: data?.current_period_start || null,
          subscription_end: data?.current_period_end || null,
          amount: data?.amount ?? null,
          currency: data?.currency ?? null,
          interval: data?.interval ?? null,
          interval_count: data?.interval_count ?? null,
          cancel_at_period_end: data?.cancel_at_period_end ?? false,
          loading: false,
          error: null,
        });
      } catch (err) {
        console.error('[useSubscription] Unexpected error:', err);
        setStatus(prev => ({
          ...prev,
          loading: false,
          subscription_start: null,
          amount: null,
          currency: null,
          interval: null,
          interval_count: null,
          cancel_at_period_end: false,
          error: err instanceof Error ? err.message : 'Unknown error occurred',
        }));
      }
    };

    fetchSubscription();

    // Subscribe to real-time updates
    const channel = supabase
      .channel('user-subscription-updates')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'user_subscriptions',
          filter: `user_id=eq.${user.id}`,
        },
        () => {
          fetchSubscription();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user]);

  const refetch = async () => {
    if (!user) return;

    try {
      const { data, error } = await supabase
        .from('user_subscriptions')
        .select('*')
        .eq('user_id', user.id)
        .eq('status', 'active')
        .maybeSingle();

      if (error) throw error;

      setStatus({
        subscribed: !!data,
        product_id: data?.product_id || null,
        subscription_start: data?.current_period_start || null,
        subscription_end: data?.current_period_end || null,
        amount: data?.amount ?? null,
        currency: data?.currency ?? null,
        interval: data?.interval ?? null,
        interval_count: data?.interval_count ?? null,
        cancel_at_period_end: data?.cancel_at_period_end ?? false,
        loading: false,
        error: null,
      });
    } catch (err) {
      console.error('Error refetching subscription:', err);
    }
  };

  return {
    ...status,
    refetch,
  };
}
