import type { Env } from "./repository";

export class ScheduledLicenseExpiryError extends Error {
  readonly code: string;
  constructor(code: string, cause?: unknown);
}

export type ScheduledLicenseExpirySummary = {
  runId: string;
  capturedNow: string;
  gracePeriodDays: number;
  candidateCount: number;
  processed: number;
  conflicts: number;
  status: "running" | "completed";
  pagesProcessed: number;
  pagesLimit: number;
  graceFinalization:
    | {
        runId: string;
        capturedNow: string;
        candidateCount: number;
        processed: number;
        conflicts: number;
        status: "running" | "completed";
        pagesProcessed: number;
        results: unknown[];
      }
    | { status: "deferred_active_to_grace_running" | "deferred_page_budget" };
};

export function runScheduledLicenseExpiry(options: {
  scheduledTime: number;
  env: Env;
  database?: D1Database;
}): Promise<{ status: "disabled" } | ScheduledLicenseExpirySummary>;
