import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface FanmarkByShortId {
  id: string;
  emoji_combination: string;
  short_id: string;
  fanmark_name: string;
  access_type: string;
  target_url: string | null;
  text_content: string | null;
  is_password_protected: boolean;
}

interface UseFanmarkByShortIdResult {
  data: FanmarkByShortId | null;
  loading: boolean;
  error: string | null;
}

export const useFanmarkByShortId = (shortId: string | undefined): UseFanmarkByShortIdResult => {
  const [data, setData] = useState<FanmarkByShortId | null>(null);
  const [loading, setLoading] = useState<boolean>(!!shortId);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!shortId) {
      setLoading(false);
      setData(null);
      setError('missing-short-id');
      return;
    }

    let isMounted = true;

    const fetchData = async () => {
      setLoading(true);
      setError(null);

      try {
        const { data, error } = await supabase.rpc('get_fanmark_by_short_id', {
          shortid_param: shortId,
        });

        if (error) {
          throw error;
        }

        const record = data?.[0] ?? null;
        if (isMounted) {
          setData(record as FanmarkByShortId | null);
        }
      } catch (fetchError) {
        console.error('Failed to fetch fanmark by short id:', fetchError);
        if (isMounted) {
          setError(fetchError instanceof Error ? fetchError.message : 'unknown-error');
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    fetchData();

    return () => {
      isMounted = false;
    };
  }, [shortId]);

  return { data, loading, error };
};
