import { useState } from 'react';

import { useTranslation } from './useTranslation';
import { toast } from '@/hooks/use-toast';
import { useLotteryActionOverlay } from '@/hooks/useLotteryActionOverlay';
import { invokeFanmarkLotteryAction } from '@/lib/fanmark-lottery-api';

interface LotteryActionOptions {
  emoji?: string | null;
  showOverlay?: boolean;
  onSettled?: () => Promise<void> | void;
  optimisticUpdate?: (status: 'applied' | 'cancelled', payload?: { entry_id?: string; total_entries_count?: number }) => void;
}

export function useLotteryEntry() {
  const { t } = useTranslation();
  const { show: showOverlay, hide: hideOverlay } = useLotteryActionOverlay();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const extractErrorInfo = async (
    error: unknown,
    fallback: string,
  ): Promise<{ message: string; code?: string; rawBody?: string }> => {
    let rawBody: string | undefined;

    if (error && typeof error === 'object') {
      const operationError = error as Error & { context?: unknown };
      const context = operationError.context;

      if (context) {
        if (context instanceof Response) {
          try {
            const clone = context.clone ? context.clone() : context;
            rawBody = await clone.text();
            if (rawBody.trim()) {
              try {
                const json = JSON.parse(rawBody);
                if (json) {
                  if (typeof json.error === 'string' && json.error.trim()) {
                    return { message: json.error, code: json.error, rawBody };
                  }
                  if (typeof json.message === 'string' && json.message.trim()) {
                    return { message: json.message, code: typeof json.error === 'string' ? json.error : undefined, rawBody };
                  }
                }
              } catch {
                return { message: rawBody, rawBody };
              }
            }
          } catch (parseError) {
            console.warn('[useLotteryEntry] Failed to parse error response:', parseError);
          }
        }

        if (typeof context === 'string') {
          try {
            const parsed = JSON.parse(context);
            if (parsed && typeof parsed.error === 'string' && parsed.error.trim()) {
              return { message: parsed.error, code: parsed.error, rawBody: context };
            }
            if (parsed && typeof parsed.message === 'string' && parsed.message.trim()) {
              return { message: parsed.message, code: typeof parsed.error === 'string' ? parsed.error : undefined, rawBody: context };
            }
          } catch {
            if (context.trim()) {
              return { message: context, rawBody: context };
            }
          }
        } else if (typeof context === 'object' && context !== null) {
          if ('error' in context && typeof context.error === 'string' && context.error.trim()) {
            return { message: context.error, code: context.error, rawBody: JSON.stringify(context) };
          }
          if ('message' in context && typeof context.message === 'string' && context.message.trim()) {
            return { message: context.message, code: 'error' in context && typeof context.error === 'string' ? context.error : undefined, rawBody: JSON.stringify(context) };
          }

          const response = 'response' in context && context.response instanceof Response ? context.response : undefined;
          if (response) {
            try {
              const clone = response.clone ? response.clone() : response;
              rawBody = await clone.text();

              if (rawBody.trim()) {
                try {
                  const json = JSON.parse(rawBody);
                  if (json) {
                    if (typeof json.error === 'string' && json.error.trim()) {
                      return { message: json.error, code: json.error, rawBody };
                    }
                    if (typeof json.message === 'string' && json.message.trim()) {
                      return { message: json.message, code: typeof json.error === 'string' ? json.error : undefined, rawBody };
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

      if ('message' in operationError && typeof operationError.message === 'string' && operationError.message.trim()) {
        return { message: operationError.message, rawBody };
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
      const { data, error } = await invokeFanmarkLotteryAction('apply', { fanmark_id: fanmarkId });

      if (error) throw error;

      toast({
        title: t('lottery.applySuccess'),
      });
      options?.optimisticUpdate?.('applied', data);

      return data;
    } catch (err: unknown) {
      const { message: errorMessage, code, rawBody } = await extractErrorInfo(err, t('lottery.applyError'));
      const friendlyMessage = code === 'fanmark_limit_reached'
        ? t('lottery.limitReached')
        : errorMessage;
      console.error('[useLotteryEntry] Error applying to lottery:', err, (err && typeof err === 'object' && 'context' in err ? err.context : undefined), rawBody ? { rawBody } : undefined);
      setError(friendlyMessage);
      toast({
        title: t('lottery.applyError'),
        description: friendlyMessage,
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
      const { data, error } = await invokeFanmarkLotteryAction('cancel', { entry_id: entryId });

      if (error) throw error;

      toast({
        title: t('lottery.cancelSuccess'),
      });
      options?.optimisticUpdate?.('cancelled', data);

      return data;
    } catch (err: unknown) {
      const { message: errorMessage, code, rawBody } = await extractErrorInfo(err, t('lottery.cancelError'));
      const friendlyMessage = code === 'fanmark_limit_reached'
        ? t('lottery.limitReached')
        : errorMessage;
      console.error('[useLotteryEntry] Error cancelling lottery entry:', err, (err && typeof err === 'object' && 'context' in err ? err.context : undefined), rawBody ? { rawBody } : undefined);
      setError(friendlyMessage);
      toast({
        title: t('lottery.cancelError'),
        description: friendlyMessage,
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
