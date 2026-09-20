#!/usr/bin/env node

/** Explicit local Miniflare D1 proof; excluded from the default Vitest glob. */

import { runLocalD1Integration } from "../../../scripts/migration/test-d1-import.mjs";

runLocalD1Integration()
  .then(() => console.log("Miniflare D1 integration passed: synthetic parent/child import and readback."))
  .catch((error) => {
    console.error(`Miniflare D1 integration failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });

