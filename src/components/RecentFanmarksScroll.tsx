import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

interface RecentFanmark {
  id: string;
  emoji: string;
  created_at: string;
}

export function RecentFanmarksScroll() {
  const [fanmarks, setFanmarks] = useState<RecentFanmark[]>([]);

  useEffect(() => {
    fetchRecentFanmarks();
  }, []);

  const fetchRecentFanmarks = async () => {
    try {
      const { data, error } = await supabase
        .from('recent_active_fanmarks' as any)
        .select('*')
        .order('license_created_at', { ascending: false })
        .limit(20);

      if (error) throw error;

      if (data) {
        const formattedFanmarks = data.map((item: any) => ({
          id: item.license_id || item.fanmark_id,
          emoji: item.display_emoji || '❓',
          created_at: item.license_created_at
        }));
        
        // 2セット用意してシームレスにループさせる
        setFanmarks([...formattedFanmarks, ...formattedFanmarks]);
      }
    } catch (error) {
      console.error('Error fetching recent fanmarks:', error);
    }
  };

  if (fanmarks.length === 0) return null;

  return (
    <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-r from-primary/20 via-accent/15 to-secondary/20 backdrop-blur-md border-t border-primary/30 shadow-[0_-10px_30px_rgba(0,0,0,0.1)] overflow-hidden">
      <div className="fanmark-scroll py-4">
        {fanmarks.map((fanmark, index) => (
          <div
            key={`${fanmark.id}-${index}`}
            className="flex-shrink-0 mx-3 px-5 py-2.5 bg-background/90 rounded-full shadow-md hover:shadow-lg hover:scale-105 transition-all duration-200"
          >
            <span className="text-2xl">{fanmark.emoji}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
