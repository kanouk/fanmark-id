type CatalogState = { phase: 'idle' | 'loading' | 'ready' | 'error'; demanded: boolean };

/** One validated release, shared by background loading and all waiting controls. */
export function createEmojiCatalogResource(loader: () => Promise<void>) {
  let state: CatalogState = { phase: 'idle', demanded: false };
  let pending: Promise<boolean> | undefined;
  const listeners = new Set<() => void>();
  const publish = (next: CatalogState) => {
    state = next;
    listeners.forEach(listener => listener());
  };
  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    load(demanded = false): Promise<boolean> {
      if (state.phase === 'ready') return Promise.resolve(true);
      if (demanded && !state.demanded) publish({ ...state, demanded: true });
      if (pending) return pending;
      publish({ phase: 'loading', demanded: state.demanded });
      pending = Promise.resolve().then(loader).then(() => {
        publish({ phase: 'ready', demanded: false });
        return true;
      }, () => {
        publish({ phase: 'error', demanded: state.demanded });
        return false;
      }).finally(() => { pending = undefined; });
      return pending;
    },
  };
}

let selectedLoader: (() => Promise<void>) | undefined;
export const emojiCatalog = createEmojiCatalogResource(async () => {
  if (!selectedLoader) throw new Error('Emoji catalog loader is not configured');
  await selectedLoader();
});
export function startEmojiCatalog(loader: () => Promise<void>): Promise<boolean> {
  selectedLoader = loader;
  return emojiCatalog.load();
}
export const requireEmojiCatalog = () => emojiCatalog.load(true);
