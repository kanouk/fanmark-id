import { useEffect, useState } from 'react';

import { fetchPublicFanmarkByShortId } from '@/lib/public-access-api';
export interface FanmarkByShortId {
  id: string;
  user_input_fanmark: string;
  display_fanmark: string;
  emoji_ids: string[];
  fanmark: string;
  short_id: string;
  fanmark_name: string;
  access_type: string;
  target_url: string | null;
  text_content: string | null;
  is_password_protected: boolean;
  status: string;
  license_id: string | null;
  license_status: string | null;
  license_end: string | null;
  grace_expires_at: string | null;
  is_returned: boolean | null;
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
    const controller = new AbortController();

    const fetchData = async () => {
      setLoading(true);
      setError(null);

      try {
        {
          const record = await fetchPublicFanmarkByShortId(shortId, { signal: controller.signal });
          if (isMounted) setData(record);
          return;
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
      controller.abort();
    };
  }, [shortId]);

  return { data, loading, error };
};
