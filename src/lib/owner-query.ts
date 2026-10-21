/** An authenticated cache entry always includes its owner. */
export const ownerQueryKey = (resource: 'profile' | 'favorites' | 'fanmarks', userId: string | null | undefined) =>
  ['owner', userId ?? null, resource] as const;
