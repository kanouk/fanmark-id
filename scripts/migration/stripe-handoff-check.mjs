// Compares two offline, canonical projections of ONE CLOSED handoff boundary.
// This neither exports/imports rows nor attests that the boundary exists remotely.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const digest = (value) => typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
function requireCondition(condition, code) { if (!condition) throw new Error(code); }
function fields(value, expected) {
  requireCondition(value && typeof value === "object" && !Array.isArray(value) &&
    JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort()), "projection_fields_invalid");
}
function mode(value) { requireCondition(typeof value === "boolean", "livemode_invalid"); }
const scopedKey = (row, key) => JSON.stringify([row.livemode, row[key]]);
const effectKeyValid = (key) => typeof key === "string" && /^[a-z][a-z0-9_]*:[A-Za-z0-9_:-]{1,220}$/.test(key);

function validateProjection(projection) {
  fields(projection, ["format", "boundaryId", "captureComplete", "dispatcherPaused", "inFlight", "receipts", "effects"]);
  requireCondition(projection.format === "fanmark-stripe-handoff-v1" && digest(projection.boundaryId), "projection_header_invalid");
  requireCondition(projection.captureComplete === true && projection.dispatcherPaused === true &&
    projection.inFlight === 0, "boundary_not_quiescent");
  requireCondition(Array.isArray(projection.receipts) && Array.isArray(projection.effects), "projection_rows_invalid");
  const effects = new Map();
  for (const row of projection.effects) {
    fields(row, ["livemode", "effectKey", "state", "proofSha256"]);
    mode(row.livemode);
    requireCondition(effectKeyValid(row.effectKey), "effect_key_invalid");
    requireCondition(["pending", "applied"].includes(row.state), "effect_state_unresolved");
    requireCondition(row.state === "applied" ? digest(row.proofSha256) : row.proofSha256 === null, "effect_proof_invalid");
    const key = scopedKey(row, "effectKey");
    requireCondition(!effects.has(key), "duplicate_effect_key");
    effects.set(key, { state: row.state, proofSha256: row.proofSha256 });
  }
  const receipts = new Map();
  const referenced = new Set();
  for (const row of projection.receipts) {
    fields(row, ["livemode", "eventId", "payloadSha256", "state", "effectKeys", "proofSha256"]);
    mode(row.livemode);
    requireCondition(typeof row.eventId === "string" && /^evt_[A-Za-z0-9_]{1,200}$/.test(row.eventId) && digest(row.payloadSha256), "receipt_identity_invalid");
    requireCondition(["pending", "applied", "ignored"].includes(row.state), "receipt_state_unresolved");
    requireCondition(Array.isArray(row.effectKeys) && row.effectKeys.every(effectKeyValid) &&
      new Set(row.effectKeys).size === row.effectKeys.length, "receipt_effect_keys_invalid");
    requireCondition(row.state === "pending" ? row.proofSha256 === null : digest(row.proofSha256), "receipt_proof_invalid");
    requireCondition(row.state !== "applied" || row.effectKeys.length > 0, "applied_receipt_without_effect");
    requireCondition(row.state !== "ignored" || row.effectKeys.length === 0, "ignored_receipt_has_effect");
    for (const effectKey of row.effectKeys) {
      const key = scopedKey({ livemode: row.livemode, effectKey }, "effectKey");
      requireCondition(effects.has(key), "receipt_effect_missing");
      requireCondition(row.state !== "applied" || effects.get(key).state === "applied", "applied_receipt_pending_effect");
      referenced.add(key);
    }
    const key = scopedKey(row, "eventId");
    requireCondition(!receipts.has(key), "duplicate_event_key");
    receipts.set(key, { payloadSha256: row.payloadSha256, state: row.state,
      effectKeys: [...row.effectKeys].sort(), proofSha256: row.proofSha256 });
  }
  requireCondition([...effects.keys()].every((key) => referenced.has(key)), "unreferenced_effect");
  return { receipts, effects };
}

function compareMaps(source, destination) {
  let missing = 0, extra = 0, conflicts = 0;
  for (const [key, row] of source) {
    if (!destination.has(key)) missing++;
    else if (JSON.stringify(row) !== JSON.stringify(destination.get(key))) conflicts++;
  }
  for (const key of destination.keys()) if (!source.has(key)) extra++;
  return { sourceCount: source.size, destinationCount: destination.size, missing, extra, conflicts };
}

export function checkStripeHandoff(source, destination) {
  const from = validateProjection(source), to = validateProjection(destination);
  requireCondition(source.boundaryId === destination.boundaryId, "handoff_boundary_mismatch");
  const receipts = compareMaps(from.receipts, to.receipts);
  const effects = compareMaps(from.effects, to.effects);
  return { scope: "offline-projection-comparison-only", productionReady: false,
    projectionMatches: [receipts, effects].every((row) => row.missing + row.extra + row.conflicts === 0),
    receipts, effects };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length !== 4 || args[0] !== "--source" || args[2] !== "--destination") {
    console.error("usage: stripe-handoff-check.mjs --source PRIVATE.json --destination PRIVATE.json");
    process.exitCode = 1;
  } else {
    try {
      const result = checkStripeHandoff(JSON.parse(readFileSync(args[1], "utf8")), JSON.parse(readFileSync(args[3], "utf8")));
      console.log(JSON.stringify(result, null, 2));
      if (!result.projectionMatches) process.exitCode = 1;
    } catch {
      // Native JSON errors can include raw private payloads: never print them.
      console.error("stripe_handoff_projection_invalid_or_unresolved");
      process.exitCode = 1;
    }
  }
}
