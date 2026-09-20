import { useEffect, useState } from 'react';
import { byId } from './search';

export type JevStatus = 'idle' | 'loading' | 'ready' | 'error';
type SearchState = {
  key: string; status: JevStatus; ids: string[]; elapsedMs?: number; cached?: boolean; error?: string;
};
const empty: SearchState = { key: '', status: 'idle', ids: [] };
export function useJevSearch(query: string, category: string, variants: boolean, enabled: boolean, composing: boolean) {
  const [state, setState] = useState<SearchState>(empty);
  const input = { query: query.trim(), category, variants };
  const requestKey = JSON.stringify(input);
  const length = [...input.query].length;
  const eligible = enabled && !composing && length >= 2 && length <= 160;
  useEffect(() => {
    if (!eligible) return;
    const controller = new AbortController();
    let disposed = false;
    setState({ key: requestKey, status: 'loading', ids: [] });
    const timeout = window.setTimeout(async () => {
      const started = performance.now();
      try {
        const response = await fetch('/api/palette/jev', {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Fanmark-Palette': '1' },
          body: requestKey, signal: controller.signal,
        });
        const result = await response.json();
        if (!response.ok) throw new Error(typeof result?.error === 'string' ? result.error : 'provider_error');
        if (!Array.isArray(result.ids) || !result.ids.every((id: unknown) => typeof id === 'string' && byId.has(id))) throw new Error('invalid_response');
        if (!disposed) setState({ key: requestKey, status: 'ready', ids: result.ids, elapsedMs: Math.round(performance.now() - started), cached: result.cached === true });
      } catch (error) {
        if (!disposed) setState({ key: requestKey, status: 'error', ids: [], error: error instanceof Error ? error.message : 'provider_error' });
      }
    }, 350);
    return () => { disposed = true; clearTimeout(timeout); controller.abort(); };
  }, [requestKey, eligible]);
  if (!eligible) return empty;
  return state.key === requestKey ? state : { ...empty, key: requestKey, status: 'loading' as const };
}
