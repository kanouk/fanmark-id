import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';

export interface SubscriptionStatus {
  subscribed: boolean;
  product_id: string | null;
  subscription_end: string | null;
  loading: boolean;
  error: string | null;
}

export function useSubscription() {
  const { user } = useAuth();
  const [status, setStatus] = useState<SubscriptionStatus>({
    subscribed: false,
    product_id: null,
    subscription_end: null,
    loading: true,
    error: null,
  });

  useEffect(() => {
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

    const fetchSubscription = async () => {
      try {
        setStatus(prev => ({ ...prev, loading: true, error: null }));

        const { data, error } = await supabase
          .from('user_subscriptions')
          .select('*')
          .eq('user_id', user.id)
          .eq('status', 'active')
          .maybeSingle();

        if (error) {
          console.error('Error fetching subscription:', error);
          setStatus(prev => ({
            ...prev,
            loading: false,
            error: error.message,
          }));
          return;
        }

        setStatus({
          subscribed: !!data,
          product_id: data?.product_id || null,
          subscription_end: data?.current_period_end || null,
          loading: false,
          error: null,
        });
      } catch (err) {
        console.error('Unexpected error fetching subscription:', err);
        setStatus(prev => ({
          ...prev,
          loading: false,
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
        subscription_end: data?.current_period_end || null,
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
