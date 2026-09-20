import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useTranslation } from '@/hooks/useTranslation';
import { toast } from '@/hooks/use-toast';
import {
  loadRecentFanmarks,
  mapRecentFanmarkRpcRows,
  type RecentFanmark,
} from '@/lib/recent-fanmarks';

export function RecentFanmarksScroll() {
  const [fanmarks, setFanmarks] = useState<RecentFanmark[]>([]);
  const { t } = useTranslation();

  useEffect(() => {
    const controller = new AbortController();
    let isMounted = true;

    const fetchFanmarks = async () => {
      try {
        const formattedFanmarks = await loadRecentFanmarks({
          signal: controller.signal,
          fallback: async () => {
            // Keep the current public RPC until the Worker is explicitly configured.
            const { data, error } = await supabase
              .rpc('list_recent_fanmarks', { p_limit: 20 })
              .abortSignal(controller.signal);

            if (error) throw error;
            return mapRecentFanmarkRpcRows(data);
          },
        });

        if (!isMounted || controller.signal.aborted) return;
        // 2セット用意してシームレスにループさせる
        setFanmarks([...formattedFanmarks, ...formattedFanmarks]);
      } catch (error) {
        if (controller.signal.aborted) return;
        console.error('Error fetching recent fanmarks:', error);
      }
    };

    void fetchFanmarks();

    return () => {
      isMounted = false;
      controller.abort();
    };
  }, []);

  if (fanmarks.length === 0) return null;

  return (
    <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-r from-primary/20 via-accent/15 to-secondary/20 backdrop-blur-md border-t border-primary/30 shadow-[0_-10px_30px_rgba(0,0,0,0.1)] overflow-hidden">
      <div className="fanmark-scroll py-4">
        {fanmarks.map((fanmark, index) => (
          <button
            type="button"
            key={`${fanmark.id}-${index}`}
            className="flex-shrink-0 mx-3 px-5 py-2.5 bg-background/90 rounded-full shadow-md hover:shadow-lg hover:scale-105 transition-all duration-200 cursor-pointer"
            onClick={() => {
              navigator.clipboard.writeText(fanmark.emoji);
              toast({
                title: t('dashboard.emojiCopiedTitle'),
                description: fanmark.emoji,
              });
            }}
            title={t('dashboard.clickToCopyEmoji')}
            aria-label={t('dashboard.clickToCopyEmoji')}
          >
            <span className="text-2xl leading-none select-none" style={{ letterSpacing: '0.15em' }}>{fanmark.emoji}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
