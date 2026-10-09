import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const account = 'bfc2890741f0b3fb236e2d755b6c9adc';
const worker = 'fanmark-app-staging';
const businessDatabase = 'c99c9f7e-b234-400e-aa89-8d15a168abcc';
const apiOrigin = 'https://api.cloudflare.com/client/v4';

/** Fixed read-only operations; no arbitrary endpoint or SQL supplied by the caller. */
export function createStagingMonitorApi({ token, fetchImpl = fetch }) {
  assert.ok(typeof token === 'string' && token.trim().length > 0 && !/[\r\n]/u.test(token),
    'staging_monitor_token_required');
  async function request(resource, sql) {
    try {
      const response = await fetchImpl(`${apiOrigin}/${resource}`, {
        method: sql ? 'POST' : 'GET', redirect: 'error', signal: AbortSignal.timeout(30000),
        headers: { authorization: `Bearer ${token}`, ...(sql ? { 'content-type': 'application/json' } : {}) },
        ...(sql ? { body: JSON.stringify({ sql, params: [] }) } : {}),
      });
      assert.ok(response.ok);
      const envelope = await response.json();
      assert.equal(envelope.success, true);
      return envelope.result;
    } catch { throw new Error('staging_monitor_api_failed'); }
  }
  async function query(sql) {
    const result = await request(`accounts/${account}/d1/database/${businessDatabase}/query`, sql);
    try {
      assert.equal(result.length, 1);
      assert.equal(result[0].success, true);
      assert.equal(result[0].meta.rows_written, 0);
      assert.equal(result[0].meta.changed_db, false);
      assert.ok(Array.isArray(result[0].results));
      return result;
    } catch { throw new Error('staging_monitor_read_receipt_invalid'); }
  }
  return {
    async verifyToken() {
      const result = await request('user/tokens/verify');
      if (result?.status !== 'active') throw new Error('staging_monitor_token_inactive');
      // Active status is not a permissions audit. Never export its token ID.
    },
    readWorkerSettings: () => request(`accounts/${account}/workers/scripts/${worker}/settings`),
    readWorkerDeployments: () => request(`accounts/${account}/workers/scripts/${worker}/deployments`),
    readBusinessLedger: () => query('SELECT name FROM d1_migrations ORDER BY id'),
    async readBusinessCounts() {
      const sql = (await readFile(new URL('./staging-operations-status.sql', import.meta.url), 'utf8'))
        .replace(/^--[^\n]*$/gmu, '').trim();
      assert.ok(/^SELECT\s/iu.test(sql) && sql.endsWith(';') && !sql.slice(0, -1).includes(';'),
        'staging_monitor_query_invalid');
      return query(sql);
    },
  };
}
