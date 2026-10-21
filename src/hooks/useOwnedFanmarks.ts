import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { ownerQueryKey } from '@/lib/owner-query';
import { loadOwnedFanmarks, type OwnedFanmark } from '@/lib/owned-fanmarks-api';

const EMPTY: OwnedFanmark[] = [];
export function useOwnedFanmarks() {
  const { user } = useAuth();
  const query = useQuery({
    queryKey: ownerQueryKey('fanmarks', user?.id),
    enabled: Boolean(user),
    staleTime: 30_000,
    retry: false,
    queryFn: async ({ signal }) => {
      const rows = await loadOwnedFanmarks();
      if (signal.aborted) throw new Error('Owned fanmark request cancelled');
      return rows;
    },
  });
  const { refetch } = query;
  const reload = useCallback(async () => !(await refetch()).isError, [refetch]);
  return { fanmarks: user ? query.data ?? EMPTY : EMPTY, loading: Boolean(user) && query.isPending, error: query.error, refetch: reload };
}

export function useInvalidateOwnedFanmarks() {
  const { user } = useAuth();
  const client = useQueryClient();
  return useCallback(() => client.invalidateQueries({ queryKey: ownerQueryKey('fanmarks', user?.id) }), [client, user?.id]);
}
