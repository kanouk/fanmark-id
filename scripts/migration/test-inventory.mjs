#!/usr/bin/env node

import assert from "node:assert/strict";
import { analyzeSupabaseCallsites, extractSupabaseCallsites } from "./inventory.mjs";

const root = "/fixture-repo";
const file = "/fixture-repo/src/Example.tsx";
const source = [
  "import { supabase as dataClient } from '../integrations/supabase/client';",
  "const rows = await supabase",
  "  .from(",
  "    'fanmarks',",
  "  )",
  "  .select('*');",
  "// supabase.from('commented_out').select('*');",
  "const fake = \"supabase.rpc('inside_a_string')\";",
  "const sameLine = supabase.from('one').select('*'); supabase.rpc('two', {});",
  "const rpcResult = await supabase.rpc(",
  "  resolveRpcName(),",
  "  { input: true },",
  ");",
  "await supabase.functions.invoke(",
  "  resolveFunctionName(),",
  "  { body: {} },",
  ");",
  "await supabase.storage.from('avatars').upload('file', body);",
  "await supabase.auth.signInWithPassword({ email, password });",
  "await supabase.auth.mfa.verify({ factorId });",
  "await supabase.channel('room');",
  "await supabase.removeChannel(channel);",
  "function subscribeToNotifications() { const channel = supabase.channel(`notifications-preview-${user.id}`).on('postgres_changes', { event: '*', schema: 'public', table: 'notifications' }).subscribe(); return () => supabase.removeChannel(channel); }",
  "const unfinished = supabase.from('unfinished');",
  "const aliasRows = dataClient.from('alias_table').select('*');",
  "const unresolvedAlias = otherClient.from('other').select('*');",
].join("\n");

const analysis = analyzeSupabaseCallsites(source, file, root);
const calls = analysis.calls;
assert.equal(calls.length, 14, "multiline, same-line, alias, auth, realtime, and dynamic calls should all be retained");
assert.equal(extractSupabaseCallsites(source, file, root).length, calls.length);

const tableCall = calls.find((call) => call.kind === "table");
assert.deepEqual(
  { target: tableCall.target, operation: tableCall.operation, location: tableCall.location },
  { target: "fanmarks", operation: "table.select", location: "src/Example.tsx:2" },
);

const dynamicRpc = calls.find((call) => call.kind === "rpc" && call.target === "<unresolved>");
assert.equal(dynamicRpc.target, "<unresolved>");
assert.equal(dynamicRpc.expression, "resolveRpcName()");
assert.equal(dynamicRpc.location, "src/Example.tsx:10");

const dynamicEdge = calls.find((call) => call.kind === "edge");
assert.equal(dynamicEdge.target, "<unresolved>");
assert.equal(dynamicEdge.expression, "resolveFunctionName()");
assert.equal(dynamicEdge.location, "src/Example.tsx:14");

const storage = calls.find((call) => call.kind === "storage");
assert.deepEqual(
  { target: storage.target, operation: storage.operation },
  { target: "avatars", operation: "storage.upload" },
);

const auth = calls.find((call) => call.kind === "auth");
assert.equal(auth.operation, "auth.signInWithPassword");
assert.notEqual(auth.target, "<unresolved>", "auth method calls do not have a resource argument");

assert.equal(calls.filter((call) => call.line === 9).length, 2, "same-line calls must not be deduplicated");
assert.equal(calls.find((call) => call.target === "two").operation, "rpc");
assert.equal(calls.find((call) => call.target === "unfinished").operation, "table.from");
assert.equal(calls.find((call) => call.target === "alias_table").operation, "table.select");
assert.equal(calls.find((call) => call.operation === "auth.mfa.verify").target, "auth");
assert.equal(calls.find((call) => call.operation === "realtime.channel").target, "room");
assert.equal(calls.find((call) => call.operation === "realtime.removeChannel").target, "<unresolved>");
const tableChannel = calls.find((call) => call.operation === "realtime.channel" && call.target === "notifications");
assert.equal(tableChannel.expression, "`notifications-preview-${user.id}`");
const tableChannelCleanup = calls.find((call) => call.operation === "realtime.removeChannel" && call.target === "notifications");
assert.ok(tableChannelCleanup, "cleanup through a local alias should resolve to its statically subscribed table");
assert.equal(tableChannelCleanup.expression, undefined);
const shadowedChannels = analyzeSupabaseCallsites([
  "function notifications() { const channel = supabase.channel('notifications').on('postgres_changes', { table: 'notifications' }).subscribe(); return () => supabase.removeChannel(channel); }",
  "function profile() { const channel = supabase.channel('profile').on('postgres_changes', { table: 'user_settings' }).subscribe(); return () => supabase.removeChannel(channel); }",
].join("\n"), file, root).calls.filter((call) => call.operation === "realtime.removeChannel");
assert.deepEqual(shadowedChannels.map((call) => call.target), ["notifications", "user_settings"]);
assert.equal(calls.filter((call) => call.target === "commented_out" || call.target === "inside_a_string").length, 0);
assert.deepEqual(analysis.unsupportedAliases, [
  { receiver: "otherClient", operation: "table.from", location: "src/Example.tsx:26" },
]);

console.log("inventory extraction tests passed");
