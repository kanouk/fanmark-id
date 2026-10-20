/** Offline cutover candidate; never connects to or modifies the source. */
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const PROJECT = 'ppqgtbjykitqtiaisyji';
const UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/u;
const HASH = /^[0-9a-f]{64}$/u;
const hash = value => createHash('sha256').update(value).digest('hex');
const literal = value => "'" + value.replaceAll("'", "''") + "'";
const types = 'text,boolean,text,text,text,text,integer,jsonb,text,text';
const original = `public.accept_stripe_webhook_receipt(${types})`;
const core = `billing_ingress.accept_stripe_webhook_receipt_core(${types})`;
const wrapper = `public.accept_stripe_webhook_receipt(${types},uuid)`;
const params = `p_stripe_event_id text, p_livemode boolean, p_event_type text,
 p_object_type text, p_object_id text, p_api_version text,
 p_normalized_schema_version integer, p_normalized_payload jsonb,
 p_normalized_payload_sha256 text, p_raw_payload_sha256 text`;
const args = `p_stripe_event_id,p_livemode,p_event_type,p_object_type,p_object_id,p_api_version,
 p_normalized_schema_version,p_normalized_payload,p_normalized_payload_sha256,p_raw_payload_sha256`;

export async function renderSourceStripeReceiptOnly({ projectRef, runId, originalFunction }) {
  if (projectRef !== PROJECT || !UUID.test(runId ?? '') ||
      originalFunction?.slug !== 'handle-stripe-webhook' || !UUID.test(originalFunction.id ?? '') ||
      !Number.isSafeInteger(originalFunction.version) || originalFunction.version < 1 ||
      originalFunction.verify_jwt !== false || !HASH.test(originalFunction.sourceTreeSha256 ?? '')) {
    throw Error('source_stripe_candidate_identity_invalid');
  }
  const foundation = await readFile(new URL('../../supabase/migrations/20260921090000_add_stripe_receipt_foundation.sql', import.meta.url), 'utf8');
  const foundationSha256 = hash(foundation);
  const start = "BEGIN;\nSET LOCAL lock_timeout='5s';\nSET LOCAL statement_timeout='30s';\n";
  const installSql = start + `DO $preflight$ BEGIN
 IF to_regnamespace('billing_ingress') IS NOT NULL OR EXISTS (
   SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='accept_stripe_webhook_receipt'
 ) THEN RAISE EXCEPTION 'source_stripe_existing_ingress'; END IF;
END $preflight$;
${foundation}
ALTER FUNCTION ${original} SET SCHEMA billing_ingress;
ALTER FUNCTION billing_ingress.accept_stripe_webhook_receipt(${types}) RENAME TO accept_stripe_webhook_receipt_core;
REVOKE ALL ON FUNCTION ${core} FROM PUBLIC,anon,authenticated,service_role;
CREATE TABLE billing_ingress.cutover_control (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 run_id uuid NOT NULL, foundation_sha256 text NOT NULL,
 accepting boolean NOT NULL, sealed_at timestamptz,
 sealed_receipts bigint, sealed_deliveries bigint,
 core_definition text NOT NULL, wrapper_definition text NOT NULL,
 CHECK (accepting = (sealed_at IS NULL))
);
ALTER TABLE billing_ingress.cutover_control ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE billing_ingress.cutover_control FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.accept_stripe_webhook_receipt(${params},p_cutover_run_id uuid)
RETURNS TABLE(receipt_id uuid,dispatch_id uuid,outcome text,receipt_status text,dispatch_status text,delivery_count integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,billing_ingress AS $ingress$
DECLARE control billing_ingress.cutover_control%rowtype;
BEGIN
 -- Held until the RPC transaction commits: sealing waits for durable writes.
 SELECT * INTO STRICT control FROM billing_ingress.cutover_control WHERE singleton FOR SHARE;
 IF p_cutover_run_id IS DISTINCT FROM control.run_id OR control.run_id <> ${literal(runId)}::uuid
   OR NOT control.accepting THEN RAISE EXCEPTION 'source_stripe_intake_closed'; END IF;
 RETURN QUERY SELECT * FROM billing_ingress.accept_stripe_webhook_receipt_core(${args});
END $ingress$;
REVOKE ALL ON FUNCTION ${wrapper} FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION ${wrapper} TO service_role;
INSERT INTO billing_ingress.cutover_control(singleton,run_id,foundation_sha256,accepting,core_definition,wrapper_definition)
VALUES(true,${literal(runId)}::uuid,${literal(foundationSha256)},true,
 pg_get_functiondef(${literal(core)}::regprocedure),pg_get_functiondef(${literal(wrapper)}::regprocedure));
NOTIFY pgrst, 'reload schema';
COMMIT;
`;
  const verifyBody = `DO $verify$ DECLARE control billing_ingress.cutover_control%rowtype; BEGIN
 SELECT * INTO STRICT control FROM billing_ingress.cutover_control WHERE singleton;
 IF control.run_id <> ${literal(runId)}::uuid OR control.foundation_sha256 <> ${literal(foundationSha256)}
   OR control.core_definition <> pg_get_functiondef(${literal(core)}::regprocedure)
   OR control.wrapper_definition <> pg_get_functiondef(${literal(wrapper)}::regprocedure)
   THEN RAISE EXCEPTION 'source_stripe_control_changed'; END IF;
 IF EXISTS(SELECT 1 FROM billing_ingress.stripe_webhook_receipts WHERE status <> 'received' OR terminal_at IS NOT NULL)
   OR EXISTS(SELECT 1 FROM billing_ingress.stripe_webhook_dispatches WHERE status <> 'pending' OR attempt_count <> 0
     OR claimed_at IS NOT NULL OR lease_token IS NOT NULL OR completed_at IS NOT NULL)
   OR EXISTS(SELECT 1 FROM billing_ingress.stripe_webhook_receipts r LEFT JOIN billing_ingress.stripe_webhook_dispatches d
     ON d.receipt_id=r.id AND d.stripe_event_id=r.stripe_event_id AND d.livemode=r.livemode WHERE d.id IS NULL)
   OR (SELECT count(*) FROM billing_ingress.stripe_webhook_receipts) <> (SELECT count(*) FROM billing_ingress.stripe_webhook_dispatches)
   THEN RAISE EXCEPTION 'source_stripe_receipt_state_changed'; END IF;
 IF NOT control.accepting AND (
   control.sealed_receipts IS DISTINCT FROM (SELECT count(*) FROM billing_ingress.stripe_webhook_receipts)
   OR control.sealed_deliveries IS DISTINCT FROM (SELECT coalesce(sum(delivery_count),0) FROM billing_ingress.stripe_webhook_receipts)
 ) THEN RAISE EXCEPTION 'source_stripe_sealed_counts_changed'; END IF;
 IF EXISTS(SELECT 1 FROM unnest(ARRAY['anon','authenticated','service_role']) role_name WHERE
   has_schema_privilege(role_name,'billing_ingress','USAGE')
   OR has_function_privilege(role_name,${literal(core)},'EXECUTE')
   OR (role_name <> 'service_role' AND has_function_privilege(role_name,${literal(wrapper)},'EXECUTE'))
   OR has_table_privilege(role_name,'billing_ingress.cutover_control','SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
   OR has_table_privilege(role_name,'billing_ingress.stripe_webhook_receipts','SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
   OR has_table_privilege(role_name,'billing_ingress.stripe_webhook_dispatches','SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
 ) OR NOT has_function_privilege('service_role',${literal(wrapper)},'EXECUTE')
 THEN RAISE EXCEPTION 'source_stripe_privileges_changed'; END IF;
END $verify$;`;
  const summary = `SELECT jsonb_build_object('runId',run_id,'accepting',accepting,'sealedAt',sealed_at,
 'receiptCount',(SELECT count(*) FROM billing_ingress.stripe_webhook_receipts),
 'deliveryCount',(SELECT coalesce(sum(delivery_count),0) FROM billing_ingress.stripe_webhook_receipts))
 FROM billing_ingress.cutover_control WHERE singleton;`;
  const times = (alias, columns) => columns.map(name => `${literal(name)},to_char(${alias}.${name} AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`).join(',');
  const exportSql = 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;\n' + verifyBody + `
DO $sealed$ BEGIN IF (SELECT accepting FROM billing_ingress.cutover_control WHERE singleton)
 THEN RAISE EXCEPTION 'source_stripe_export_requires_seal'; END IF; END $sealed$;
SELECT jsonb_build_object('format','fanmark-source-stripe-receipts-v1','projectRef',${literal(PROJECT)},
 'runId',run_id,'foundationSha256',foundation_sha256,'originalFunctionSha256',${literal(originalFunction.sourceTreeSha256)},
 'sealedAt',to_char(sealed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
 'receiptCount',sealed_receipts,'deliveryCount',sealed_deliveries,
 'receipts',(SELECT coalesce(jsonb_agg(to_jsonb(r)||jsonb_build_object(${times('r',['first_received_at','last_received_at','terminal_at','created_at','updated_at'])}) ORDER BY r.id),'[]'::jsonb) FROM billing_ingress.stripe_webhook_receipts r),
 'dispatches',(SELECT coalesce(jsonb_agg(to_jsonb(d)||jsonb_build_object(${times('d',['available_at','claimed_at','completed_at','created_at','updated_at'])}) ORDER BY d.id),'[]'::jsonb) FROM billing_ingress.stripe_webhook_dispatches d))
 FROM billing_ingress.cutover_control WHERE singleton;
COMMIT;
`;
  const lock = 'SELECT singleton FROM billing_ingress.cutover_control WHERE singleton FOR UPDATE;\n';
  const transition = accepting => start + lock + verifyBody + `
DO $transition$ BEGIN
 IF (SELECT accepting FROM billing_ingress.cutover_control WHERE singleton) = ${accepting}
 THEN RAISE EXCEPTION 'source_stripe_transition_already_applied'; END IF;
END $transition$;
UPDATE billing_ingress.cutover_control SET accepting=${accepting},
 sealed_at=${accepting ? 'NULL' : 'clock_timestamp()'},
 sealed_receipts=${accepting ? 'NULL' : '(SELECT count(*) FROM billing_ingress.stripe_webhook_receipts)'},
 sealed_deliveries=${accepting ? 'NULL' : '(SELECT coalesce(sum(delivery_count),0) FROM billing_ingress.stripe_webhook_receipts)'}
 WHERE singleton;
${verifyBody}
${summary}
COMMIT;
`;
  // Separate candidate entry: do not replace the repository's ordinary handler.
  const entrySource = `import Stripe from "https://esm.sh/stripe@18.5.0?target=denonext";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { createStripeReceiptIngress, createSupabaseReceiptPersister } from "../_shared/stripe-receipt-ingress/index.ts";
const runId = ${JSON.stringify(runId)};
const url = Deno.env.get("SUPABASE_URL");
if (url !== "https://${PROJECT}.supabase.co") throw new Error("source_stripe_project_mismatch");
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
const apiKey = Deno.env.get("STRIPE_SECRET_KEY");
if (!serviceKey || !webhookSecret || !apiKey) throw new Error("source_stripe_config_missing");
const client = createClient(url, serviceKey, {auth:{persistSession:false,autoRefreshToken:false}});
const stripe = new Stripe(apiKey, {apiVersion:"2025-08-27.basil",httpClient:Stripe.createFetchHttpClient()});
const handler = createStripeReceiptIngress({stripe,webhookSecret,cryptoProvider:Stripe.createSubtleCryptoProvider(),
 persistReceipt:createSupabaseReceiptPersister({rpc(name,args){return client.rpc(name,{...args,p_cutover_run_id:runId});}})});
Deno.serve(async request => {
 const response = await handler(request);
 response.headers.set("x-fanmark-cutover",runId);
 response.headers.set("cache-control","no-store");
 return response;
});
`;
  const sharedSource = await readFile(new URL('../../supabase/functions/_shared/stripe-receipt-ingress/index.ts',import.meta.url),'utf8');
  const files = [
    {path:'supabase/functions/handle-stripe-webhook/index.ts',source:entrySource},
    {path:'supabase/functions/_shared/stripe-receipt-ingress/index.ts',source:sharedSource},
  ].map(file=>({...file,sha256:hash(file.source),bytes:Buffer.byteLength(file.source)}));
  return Object.freeze({ format:'fanmark-source-stripe-receipt-only-v1',projectRef,runId,
    originalFunction:{...originalFunction},foundationSha256,installSql,verifyStatements:verifyBody,
    verifySql:'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;\n'+verifyBody+'\n'+summary+'\nCOMMIT;\n',
    sealSql:transition(false),reopenSql:transition(true),exportSql,entrySource,entrySha256:hash(entrySource),
    files,sourceTreeSha256:hash(JSON.stringify(files.map(({source,...file})=>file))),
    sourceDrainVerified:false,productionReady:false });
}
