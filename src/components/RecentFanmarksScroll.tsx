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
        .from('fanmark_licenses')
        .select(`
          id,
          created_at,
          fanmark_id,
          fanmarks (
            user_input_fanmark
          )
        `)
        .eq('status', 'active')
        .order('created_at', { ascending: false })
        .limit(20);

      if (error) throw error;

      if (data) {
        const formattedFanmarks = data
          .filter(item => item.fanmarks)
          .map(item => ({
            id: item.id,
            emoji: (item.fanmarks as any).user_input_fanmark || '❓',
            created_at: item.created_at
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
    <div className="absolute bottom-0 left-0 right-0 bg-white/60 backdrop-blur-sm border-t border-white/40 overflow-hidden">
      <div className="fanmark-scroll py-3">
        {fanmarks.map((fanmark, index) => (
          <div
            key={`${fanmark.id}-${index}`}
            className="flex-shrink-0 mx-3 px-4 py-2 bg-white/80 rounded-full shadow-sm hover:shadow-md transition-shadow"
          >
            <span className="text-2xl">{fanmark.emoji}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
