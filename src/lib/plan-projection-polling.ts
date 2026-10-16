/** Wait across the one-minute webhook dispatch schedule, without repeating billing commands. */
export const PLAN_PROJECTION_TIMEOUT_MS = 90_000;

export function startPlanProjectionPolling(refresh: () => Promise<unknown>, onTimeout: () => void): () => void {
  let stopped = false;
  let nextRead: ReturnType<typeof setTimeout>;
  const deadline = setTimeout(() => {
    stopped = true;
    clearTimeout(nextRead);
    onTimeout();
  }, PLAN_PROJECTION_TIMEOUT_MS);
  const read = async () => {
    if (stopped) return;
    try {
      await refresh();
    } catch (error) {
      console.warn('[PlanSelection] Projection read failed', error);
    } finally {
      // Schedule only after both reads settle; slow reads must not overlap.
      if (!stopped) nextRead = setTimeout(() => void read(), 2_000);
    }
  };
  nextRead = setTimeout(() => void read(), 1_000);
  return () => {
    stopped = true;
    clearTimeout(nextRead);
    clearTimeout(deadline);
  };
}
