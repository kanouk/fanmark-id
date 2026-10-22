import { useSyncExternalStore } from 'react';
import { emojiCatalog } from '@/lib/emoji-catalog-state';

export function useEmojiCatalog() {
  const state = useSyncExternalStore(emojiCatalog.subscribe, emojiCatalog.getSnapshot, emojiCatalog.getSnapshot);
  return { ...state, ready: state.phase === 'ready' };
}
