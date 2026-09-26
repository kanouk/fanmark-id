import assert from "node:assert/strict";
import test from "node:test";
import { webcrypto } from "node:crypto";
import {
  createLicenseLotterySeed,
  LicenseLotterySelectionError,
  selectLicenseLotteryOutcome,
} from "../src/license-lottery-selection.mjs";

const ZERO_SEED = "0".repeat(64);
const REROLL_SEED = `${"0".repeat(63)}1`;

function entry(entryId, userId, lotteryProbability, options = {}) {
  const { planType = "free", activeCount = 0, limit = 3 } = options;
  return { entryId, userId, lotteryProbability, capacity: { planType, activeCount, limit } };
}

test("replays a weighted draw from an exact decimal snapshot and fixed seed", async () => {
  const entries = [
    entry("entry-a", "user-a", "0.125"),
    entry("entry-b", "user-b", "0.875"),
  ];
  const first = await selectLicenseLotteryOutcome({ entries, seed: ZERO_SEED, cryptoApi: webcrypto });
  const retry = await selectLicenseLotteryOutcome({ entries, seed: ZERO_SEED, cryptoApi: webcrypto });

  assert.deepEqual(first, retry);
  assert.equal(first.winnerEntryId, "entry-b");
  assert.deepEqual(first.draws, [{
    drawIndex: 0,
    totalWeight: "1000",
    selectedEntryId: "entry-b",
    result: "won",
  }]);
  assert.deepEqual(first.entries.map(({ entryId, lotteryProbability, status }) => ({
    entryId, lotteryProbability, status,
  })), [
    { entryId: "entry-a", lotteryProbability: "0.125", status: "lost" },
    { entryId: "entry-b", lotteryProbability: "0.875", status: "won" },
  ]);
});

test("canonical entry ordering makes a stored seed independent of query row order", async () => {
  const entries = [
    entry("entry-z", "user-z", "2.50"),
    entry("entry-a", "user-a", "1.250"),
    entry("entry-m", "user-m", "0.25"),
  ];
  const forward = await selectLicenseLotteryOutcome({ entries, seed: ZERO_SEED, cryptoApi: webcrypto });
  const reversed = await selectLicenseLotteryOutcome({ entries: [...entries].reverse(), seed: ZERO_SEED, cryptoApi: webcrypto });

  assert.deepEqual(forward, reversed);
  assert.equal(forward.weightScale, 3);
  assert.deepEqual(forward.entries.map((candidate) => candidate.entryId), ["entry-a", "entry-m", "entry-z"]);
});

test("a capacity-rejected draw is journaled and the stored seed selects the next candidate", async () => {
  const result = await selectLicenseLotteryOutcome({
    entries: [
      entry("entry-a", "user-a", "1", { activeCount: 3 }),
      entry("entry-b", "user-b", "1"),
    ],
    seed: REROLL_SEED,
    cryptoApi: webcrypto,
  });

  assert.equal(result.winnerEntryId, "entry-b");
  assert.deepEqual(result.draws.map(({ selectedEntryId, result: outcome }) => ({ selectedEntryId, outcome })), [
    { selectedEntryId: "entry-a", outcome: "limit_exceeded" },
    { selectedEntryId: "entry-b", outcome: "won" },
  ]);
  assert.deepEqual(result.entries.map(({ entryId, status }) => ({ entryId, status })), [
    { entryId: "entry-a", status: "limit_exceeded" },
    { entryId: "entry-b", status: "won" },
  ]);
});

test("all candidates at capacity produce a durable no-winner result", async () => {
  const result = await selectLicenseLotteryOutcome({
    entries: [
      entry("entry-a", "user-a", "1", { activeCount: 3 }),
      entry("entry-b", "user-b", "2", { activeCount: 5, limit: 5 }),
    ],
    seed: ZERO_SEED,
    cryptoApi: webcrypto,
  });
  assert.equal(result.winnerEntryId, null);
  assert.equal(result.draws.length, 2);
  assert.ok(result.entries.every((candidate) => candidate.status === "limit_exceeded"));
});

test("zero candidates and automatic single-candidate outcomes are deterministic", async () => {
  const empty = await selectLicenseLotteryOutcome({ entries: [], seed: ZERO_SEED, cryptoApi: webcrypto });
  const eligible = await selectLicenseLotteryOutcome({
    entries: [entry("entry-a", "user-a", "1.0000000000000000000000000000000000000001")],
    seed: ZERO_SEED,
    cryptoApi: webcrypto,
  });
  const atLimit = await selectLicenseLotteryOutcome({
    entries: [entry("entry-a", "user-a", "1", { activeCount: 3 })], seed: ZERO_SEED, cryptoApi: webcrypto,
  });

  assert.equal(empty.winnerEntryId, null);
  assert.deepEqual(empty.entries, []);
  assert.equal(eligible.winnerEntryId, "entry-a");
  assert.deepEqual(eligible.draws, [{
    drawIndex: 0,
    totalWeight: "10000000000000000000000000000000000000001",
    selectedEntryId: "entry-a",
    result: "won",
  }]);
  assert.equal(atLimit.winnerEntryId, null);
  assert.deepEqual(atLimit.draws, [{
    drawIndex: 0,
    totalWeight: "1",
    selectedEntryId: "entry-a",
    result: "limit_exceeded",
  }]);
});

test("an unlimited plan remains eligible above any finite count", async () => {
  const result = await selectLicenseLotteryOutcome({
    entries: [entry("entry-admin", "user-admin", "1", {
      planType: "admin", activeCount: Number.MAX_SAFE_INTEGER, limit: null,
    })],
    seed: ZERO_SEED,
    cryptoApi: webcrypto,
  });
  assert.equal(result.winnerEntryId, "entry-admin");
  assert.deepEqual(result.entries[0].capacity, {
    planType: "admin", activeCount: Number.MAX_SAFE_INTEGER, limit: null,
  });
});

test("uses HMAC-SHA-256 blocks for exact weights wider than one digest", async () => {
  const hugeWeight = "9".repeat(256);
  const result = await selectLicenseLotteryOutcome({
    entries: [entry("entry-a", "user-a", hugeWeight), entry("entry-b", "user-b", hugeWeight)],
    seed: ZERO_SEED,
    cryptoApi: webcrypto,
  });
  assert.ok(["entry-a", "entry-b"].includes(result.winnerEntryId));
  assert.equal(result.draws[0].totalWeight, (BigInt(hugeWeight) * 2n).toString());
});

test("seed generation uses the cryptographic API and returns canonical hex", () => {
  const seed = createLicenseLotterySeed(webcrypto);
  assert.match(seed, /^[0-9a-f]{64}$/u);
});

test("rejects invalid weights, duplicate applicants, and incomplete capacity snapshots", async () => {
  const invalidCases = [
    [entry("entry-a", "user-a", "0")],
    [entry("entry-a", "user-a", "-0.1")],
    [entry("entry-a", "user-a", "1e-4")],
    [entry("entry-a", "user-a", 0.1)],
    [entry("entry-a", "user-a", "01.0")],
    { entryId: "entry-a", userId: "user-a", lotteryProbability: "1" },
    [entry("entry-a", "user-a", "1"), entry("entry-a", "user-b", "2")],
    [entry("entry-a", "user-a", "1"), entry("entry-b", "user-a", "2")],
    [entry("entry-a", "user-a", "1".repeat(257))],
  ];

  for (const entries of invalidCases) {
    await assert.rejects(
      selectLicenseLotteryOutcome({ entries, seed: ZERO_SEED, cryptoApi: webcrypto }),
      LicenseLotterySelectionError,
    );
  }
});

test("rejects malformed stored seeds and unavailable crypto primitives", async () => {
  await assert.rejects(
    selectLicenseLotteryOutcome({ entries: [], seed: "abc", cryptoApi: webcrypto }),
    /invalid_lottery_seed/u,
  );
  await assert.rejects(
    selectLicenseLotteryOutcome({ entries: [entry("entry-a", "user-a", "1" )], seed: ZERO_SEED, cryptoApi: {} }),
    /lottery_draw_unavailable/u,
  );
});
