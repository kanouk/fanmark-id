import test from 'node:test';
import assert from 'node:assert/strict';
import { QueryClient, isCancelledError } from '@tanstack/react-query';
import { ownerQueryKey } from '../../src/lib/owner-query.ts';

test('concurrent profile consumers share one read, while another owner and resource stay isolated', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity, staleTime: 30_000 } } });
  let settle, reads = 0;
  const read = new Promise(resolve => { settle = resolve; });
  const options = { queryKey: ownerQueryKey('profile', 'owner-a'), queryFn: () => { reads++; return read; } };
  const first = client.fetchQuery(options), second = client.fetchQuery(options);
  settle({ user_id: 'owner-a', display_name: 'Saved' });
  assert.deepEqual(await first, await second); assert.equal(reads, 1);
  assert.equal(client.getQueryData(ownerQueryKey('profile', 'owner-b')), undefined);
  assert.equal(client.getQueryData(ownerQueryKey('favorites', 'owner-a')), undefined);
  client.clear();
});

test('clearing a session cancels late reads and cannot repopulate the next owner cache', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  let settle;
  const read = new Promise(resolve => { settle = resolve; });
  const pending = client.fetchQuery({ queryKey: ownerQueryKey('profile', 'old'), queryFn: async ({ signal }) => {
    const result = await read;
    if (signal.aborted) throw new Error('cancelled');
    return result;
  } });
  const rejected = assert.rejects(pending, isCancelledError);
  client.clear();
  client.setQueryData(ownerQueryKey('profile', 'new'), { user_id: 'new' });
  settle({ user_id: 'old' }); await rejected;
  assert.equal(client.getQueryData(ownerQueryKey('profile', 'old')), undefined);
  assert.deepEqual(client.getQueryData(ownerQueryKey('profile', 'new')), { user_id: 'new' });
  client.clear();
});
