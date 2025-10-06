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

        const record = Array.isArray(data) ? data[0] : null;

        if (isMounted) {
          if (record && typeof record === 'object') {
            const row = record as Record<string, unknown>;
            const safeString = (value: unknown, fallback = ''): string =>
              typeof value === 'string' && value.length > 0 ? value : fallback;
            const safeNullableString = (value: unknown): string | null =>
              typeof value === 'string' && value.length > 0 ? value : null;
            const safeBoolean = (value: unknown): boolean =>
              typeof value === 'boolean' ? value : false;
            const safeNullableBoolean = (value: unknown): boolean | null =>
              typeof value === 'boolean' ? value : null;

            const idValue = safeNullableString(row.id);
            const emojiValue = safeNullableString(row.emoji_combination);

            if (!idValue || !emojiValue) {
              setData(null);
              return;
            }

            const safeRecord: FanmarkByShortId = {
              id: idValue,
              emoji_combination: emojiValue,
              short_id: safeString(row.short_id, shortId),
              fanmark_name: safeNullableString(row.fanmark_name) ?? emojiValue,
              access_type: safeString(row.access_type, 'inactive'),
              target_url: safeNullableString(row.target_url),
              text_content: safeNullableString(row.text_content),
              is_password_protected: safeBoolean(row.is_password_protected),
              status: safeString(row.status, 'unknown'),
              license_id: safeNullableString(row.license_id),
              license_status: safeNullableString(row.license_status),
              license_end: safeNullableString(row.license_end),
              grace_expires_at: safeNullableString(row.grace_expires_at),
              is_returned: safeNullableBoolean(row.is_returned),
            };

            setData(safeRecord);
          } else {
            setData(null);
          }
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
