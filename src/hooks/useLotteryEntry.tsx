import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useTranslation } from './useTranslation';
import { toast } from '@/hooks/use-toast';
import { useLotteryActionOverlay } from '@/providers/LotteryActionOverlayProvider';
import type { FunctionsHttpError } from '@supabase/supabase-js';

interface LotteryActionOptions {
  emoji?: string | null;
  showOverlay?: boolean;
  onSettled?: () => Promise<void> | void;
  optimisticUpdate?: (status: 'applied' | 'cancelled', payload?: any) => void;
}

export function useLotteryEntry() {
  const { t } = useTranslation();
  const { show: showOverlay, hide: hideOverlay } = useLotteryActionOverlay();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const extractErrorInfo = async (
    error: unknown,
    fallback: string,
  ): Promise<{ message: string; rawBody?: string }> => {
    let rawBody: string | undefined;

    if (error && typeof error === 'object') {
      const supabaseError = error as FunctionsHttpError & { context?: any };
      const context = supabaseError.context;

      if (context) {
        if (typeof context === 'string') {
          try {
            const parsed = JSON.parse(context);
            if (parsed && typeof parsed.error === 'string' && parsed.error.trim()) {
              return { message: parsed.error, rawBody: context };
            }
            if (parsed && typeof parsed.message === 'string' && parsed.message.trim()) {
              return { message: parsed.message, rawBody: context };
            }
          } catch {
            if (context.trim()) {
              return { message: context, rawBody: context };
            }
          }
        } else if (typeof context === 'object') {
          if (typeof context.error === 'string' && context.error.trim()) {
            return { message: context.error, rawBody: JSON.stringify(context) };
          }
          if (typeof context.message === 'string' && context.message.trim()) {
            return { message: context.message, rawBody: JSON.stringify(context) };
          }

          const response: Response | undefined = context.response;
          if (response) {
            try {
              const clone = response.clone ? response.clone() : response;
              rawBody = await clone.text();

              if (rawBody.trim()) {
                try {
                  const json = JSON.parse(rawBody);
                  if (json) {
                    if (typeof json.error === 'string' && json.error.trim()) {
                      return { message: json.error, rawBody };
                    }
                    if (typeof json.message === 'string' && json.message.trim()) {
                      return { message: json.message, rawBody };
                    }
                  }
                } catch {
                  // not JSON; fall through
                }
                return { message: rawBody, rawBody };
              }
            } catch (parseError) {
              console.warn('[useLotteryEntry] Failed to parse error response:', parseError);
            }
          }
        }
      }

      if ('message' in supabaseError && typeof supabaseError.message === 'string' && supabaseError.message.trim()) {
        return { message: supabaseError.message, rawBody };
      }
    }
    return { message: fallback, rawBody };
  };

  const applyToLottery = async (fanmarkId: string, options?: LotteryActionOptions) => {
    const shouldShowOverlay = options?.showOverlay ?? true;
    if (shouldShowOverlay) {
      showOverlay('applying', { emoji: options?.emoji });
    }

    setLoading(true);
    setError(null);
    try {
      const { data, error } = await supabase.functions.invoke('apply-fanmark-lottery', {
        body: { fanmark_id: fanmarkId }
      });
      
      if (error) throw error;
      
      toast({
        title: t('lottery.applySuccess'),
      });
      options?.optimisticUpdate?.('applied', data);
      
      return data;
    } catch (err: any) {
      const { message: errorMessage, rawBody } = await extractErrorInfo(err, t('lottery.applyError'));
      console.error('[useLotteryEntry] Error applying to lottery:', err, err?.context, rawBody ? { rawBody } : undefined);
      setError(errorMessage);
      toast({
        title: t('lottery.applyError'),
        description: errorMessage,
        variant: 'destructive',
      });
      throw err;
    } finally {
      try {
        if (options?.onSettled) {
          await options.onSettled();
        }
      } finally {
        if (shouldShowOverlay) {
          hideOverlay();
        }
        setLoading(false);
      }
    }
  };

  const cancelLotteryEntry = async (entryId: string, options?: LotteryActionOptions) => {
    const shouldShowOverlay = options?.showOverlay ?? true;
    if (shouldShowOverlay) {
      showOverlay('cancelling', { emoji: options?.emoji });
    }

    setLoading(true);
    setError(null);
    try {
      const { data, error } = await supabase.functions.invoke('cancel-lottery-entry', {
        body: { entry_id: entryId }
      });
      
      if (error) throw error;
      
      toast({
        title: t('lottery.cancelSuccess'),
      });
      options?.optimisticUpdate?.('cancelled', data);
      
      return data;
    } catch (err: any) {
      const { message: errorMessage, rawBody } = await extractErrorInfo(err, t('lottery.cancelError'));
      console.error('[useLotteryEntry] Error cancelling lottery entry:', err, err?.context, rawBody ? { rawBody } : undefined);
      setError(errorMessage);
      toast({
        title: t('lottery.cancelError'),
        description: errorMessage,
        variant: 'destructive',
      });
      throw err;
    } finally {
      try {
        if (options?.onSettled) {
          await options.onSettled();
        }
      } finally {
        if (shouldShowOverlay) {
          hideOverlay();
        }
        setLoading(false);
      }
    }
  };

  return { applyToLottery, cancelLotteryEntry, loading, error };
}
