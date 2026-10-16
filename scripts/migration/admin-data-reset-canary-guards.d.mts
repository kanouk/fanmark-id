export const RESET_TABLES: readonly string[];
export function buildResetCanaryDeleteGuards(runId: string, fixtureIds: Record<string, string>): {
  triggerNames: string[]; createSql: string; dropSql: string;
};
export function assertResetCanaryEmptyCounts(counts: Record<string, number>): void;
