import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ordered = `ARRAY['${A}','${B}']::uuid[]`;
const row = (table, owner, ids, display) =>
  `('${table}'::text,${owner}::text,${ids},'${display}'::text)`;

export function buildIdentityReadinessOracle(sql, scenario) {
  if (!["blocked", "valid"].includes(scenario)) throw new Error("identity_oracle_scenario_invalid");
  const marker = /-- BEGIN SOURCE ROWS[\s\S]*?-- END SOURCE ROWS/gu;
  if ([...sql.matchAll(marker)].length !== 1) throw new Error("identity_oracle_source_marker_invalid");
  const valid = [
    row("fanmarks", "NULL", ordered, "ordered"),
    row("fanmarks", "NULL", `ARRAY['${B}','${A}']::uuid[]`, "reversed"),
    row("fanmark_discoveries", "NULL", `ARRAY['${A}','${A}']::uuid[]`, "repetition"),
    row("fanmark_discoveries", "NULL", `array_fill('${A}'::uuid,ARRAY[6])`, "historical-length"),
    row("fanmark_favorites", "'owner-a'", ordered, "first"),
    row("fanmark_favorites", "'owner-b'", ordered, "other-owner"),
    row("fanmark_events", "NULL", ordered, "repeated-event-one"),
    row("fanmark_events", "NULL", ordered, "repeated-event-two"),
  ];
  const blocked = [
    row("fanmarks", "NULL", ordered, "same-display"),
    row("fanmarks", "NULL", `ARRAY['${B}','${A}']::uuid[]`, "same-display"),
    row("fanmarks", "NULL", "NULL::uuid[]", "null-fixture"),
    row("fanmark_discoveries", "NULL", `ARRAY['${A}',NULL,'${B}']::uuid[]`, "null-element"),
    row("fanmark_discoveries", "NULL", "ARRAY[]::uuid[]", "empty"),
    row("fanmark_discoveries", "NULL", `'{{${A}},{${B}}}'::uuid[]`, "dimensions"),
    row("fanmark_discoveries", "NULL", `'[0:1]={${A},${B}}'::uuid[]`, "lower-bound"),
    ...valid.filter(value => value.includes("'fanmark_discoveries'")),
    row("fanmark_favorites", "'owner-a'", ordered, "first"),
    row("fanmark_favorites", "'owner-a'", `ARRAY['${A.toUpperCase()}','${B.toUpperCase()}']::uuid[]`, "duplicate"),
    row("fanmark_favorites", "'owner-b'", ordered, "other-owner"),
    ...valid.filter(value => value.includes("'fanmark_events'")),
    row("fanmark_events", "NULL", "ARRAY[]::uuid[]", "empty-event"),
    row("fanmark_events", "NULL", `ARRAY['${A}',NULL]::uuid[]`, "null-event-element"),
  ];
  const result = sql.replace(marker,
    `-- BEGIN SOURCE ROWS\n  VALUES ${(scenario === "valid" ? valid : blocked).join(",\n    ")}\n-- END SOURCE ROWS`);
  if (/\bpublic\s*\./iu.test(result)) throw new Error("identity_oracle_source_read_remaining");
  const code = result.replace(/--[^\n]*/gu, "");
  if (!/^\s*BEGIN READ ONLY;/u.test(code) ||
      /\b(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|TRUNCATE|CALL|DO|COPY)\b/iu.test(code)) {
    throw new Error("identity_oracle_read_only_required");
  }
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [flag, scenario, ...extra] = process.argv.slice(2);
  if (flag !== "--scenario" || extra.length) throw new Error("identity_oracle_usage");
  const sql = await readFile(new URL("./identity-readiness.sql", import.meta.url), "utf8");
  process.stdout.write(buildIdentityReadinessOracle(sql, scenario));
}
