import { spawnSync } from "node:child_process";

function sqlLiteral(value) {
  if (value === null) return "NULL";
  if (typeof value === "string") {
    if (value.includes("\0")) throw new Error("d1_sql_nul_value");
    return "'" + value.replaceAll("'", "''") + "'";
  }
  if (typeof value === "number" && Number.isSafeInteger(value)) return String(value);
  throw new Error("d1_sql_unsupported_value");
}

export function renderWranglerD1Sql(sql, bindings = []) {
  if (typeof sql !== "string" || sql.length === 0 || sql.includes(";")) {
    throw new Error("d1_sql_statement_invalid");
  }
  const parts = sql.split("?");
  if (parts.length !== bindings.length + 1) throw new Error("d1_sql_binding_count_mismatch");
  return parts.slice(0, -1).map((part, index) => part + sqlLiteral(bindings[index])).join("") + parts.at(-1);
}

function wranglerCommand(wranglerPath, configPath, binding, sql) {
  const result = spawnSync(wranglerPath, [
    "d1", "execute", binding, "--remote", "--json", "--command", sql, "--config", configPath,
  ], {
    cwd: process.cwd(),
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    timeout: 120_000,
  });
  if (result.error || result.status !== 0) throw new Error("wrangler_d1_execute_failed");
  let decoded;
  try {
    decoded = JSON.parse(result.stdout.trim());
  } catch {
    throw new Error("wrangler_d1_response_invalid");
  }
  if (!Array.isArray(decoded) || decoded.some((entry) => !entry || typeof entry.success !== "boolean")) {
    throw new Error("wrangler_d1_response_invalid");
  }
  return decoded;
}

class WranglerD1Statement {
  constructor(database, sql, bindings = []) {
    this.database = database;
    this.sql = sql;
    this.bindings = bindings;
  }

  bind(...bindings) {
    return new WranglerD1Statement(this.database, this.sql, bindings);
  }

  async all() {
    const [result] = this.database.execute(renderWranglerD1Sql(this.sql, this.bindings));
    if (!result || !result.success || !Array.isArray(result.results)) throw new Error("wrangler_d1_read_failed");
    return result;
  }

  async first(column) {
    const result = await this.all();
    const row = result.results[0] ?? null;
    return column && row ? row[column] ?? null : row;
  }

  async run() {
    const rendered = renderWranglerD1Sql(this.sql, this.bindings);
    const results = this.database.execute(rendered + "; SELECT changes() AS change_count");
    const write = results[0];
    const changeCount = results[1]?.results?.[0]?.change_count;
    if (!write?.success || !results[1]?.success || !Number.isSafeInteger(changeCount)) {
      throw new Error("wrangler_d1_write_failed");
    }
    return { success: true, meta: { changes: changeCount } };
  }
}

export function createWranglerD1Database({ wranglerPath, configPath, binding = "FANMARK_DB", execute }) {
  if (typeof wranglerPath !== "string" || wranglerPath.length === 0 ||
      typeof configPath !== "string" || configPath.length === 0 ||
      typeof binding !== "string" || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(binding)) {
    throw new Error("wrangler_d1_configuration_invalid");
  }
  const run = execute ?? ((sql) => wranglerCommand(wranglerPath, configPath, binding, sql));
  return {
    execute: run,
    prepare(sql) {
      return new WranglerD1Statement(this, sql);
    },
    async batch(statements) {
      if (!Array.isArray(statements) || statements.length === 0 ||
          statements.some((statement) => !(statement instanceof WranglerD1Statement) || statement.database !== this)) {
        throw new Error("wrangler_d1_batch_invalid");
      }
      const sql = statements.map((statement) =>
        renderWranglerD1Sql(statement.sql, statement.bindings),
      ).join("; ");
      const results = this.execute(sql);
      if (results.length !== statements.length) throw new Error("wrangler_d1_batch_result_mismatch");
      return results;
    },
  };
}
