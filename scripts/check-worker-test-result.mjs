import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function assertWorkerTestResult(result) {
  if (result !== 'success') throw new Error('Worker contract groups did not all succeed: ' + (result ?? 'missing'));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assertWorkerTestResult(process.env.WORKER_CONTRACTS_RESULT);
}
