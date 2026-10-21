import assert from 'node:assert/strict';
import test from 'node:test';
import { frontendViolations } from './check-frontend-architecture.mjs';

test('legacy SDK, alias imports and dynamic catalog fallbacks cannot re-enter the frontend', () => {
  for (const source of [
    'import {createClient} from "@supabase/supabase-js";',
    'import {supabase as client} from "@/integrations/supabase/client";',
    'const client = import("../integrations/supabase/client");',
    'export {emojiCatalogEntries} from "@/data/emojiCatalog";',
    'const backend = import.meta.env.VITE_PROFILE_BACKEND;',
  ]) assert.ok(frontendViolations(source).length > 0, source);
});

test('ordinary text and the explicit send/reset capability controls remain valid', () => {
  for (const source of [
    '// Old Supabase data is retained outside the frontend.',
    'const label = "supabase";',
    'import {loadOwnProfile} from "./profile-api";',
    'const send = import.meta.env.VITE_BROADCAST_SEND_BACKEND;',
    'const reset = import.meta.env.VITE_ADMIN_DATA_RESET_BACKEND;',
  ]) assert.deepEqual(frontendViolations(source), []);
});
