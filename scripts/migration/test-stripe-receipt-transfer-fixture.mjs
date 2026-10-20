import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { sha256Hex } from './snapshot-format.mjs';
import { buildReceiptPersistenceInput } from '../../supabase/functions/_shared/stripe-receipt-ingress/index.ts';

export async function syntheticStripeReceiptExport(runId,count=2) {
 const source={format:'fanmark-source-stripe-receipts-v1',projectRef:'ppqgtbjykitqtiaisyji',runId,
  foundationSha256:sha256Hex(await readFile(new URL('../../supabase/migrations/20260921090000_add_stripe_receipt_foundation.sql',import.meta.url))),
  originalFunctionSha256:'a'.repeat(64),sealedAt:'2026-10-19T00:10:00.123456Z',receiptCount:count,deliveryCount:count*2,receipts:[],dispatches:[]};
 const at='2026-10-19T00:00:00.123456Z';
 for(let i=0;i<count;i++){
  const event={id:'evt_transfer_'+i,object:'event',created:1792368000,api_version:'2025-08-27.basil',livemode:i%2===0,type:'checkout.session.completed',
   data:{object:{id:'cs_transfer_'+i,object:'checkout.session',mode:'payment',status:'complete',payment_status:'paid',amount_total:1200,currency:'jpy',metadata:{type:'license_extension',months:'3'}}}};
  const input=await buildReceiptPersistenceInput(event,new TextEncoder().encode(JSON.stringify(event)));
  const id=randomUUID();source.receipts.push({id,stripe_event_id:input.stripeEventId,livemode:input.livemode,event_type:input.eventType,
   object_type:input.objectType,object_id:input.objectId,api_version:input.apiVersion,normalized_schema_version:input.normalizedSchemaVersion,
   normalized_payload:input.normalizedPayload,normalized_payload_sha256:input.normalizedPayloadSha256,raw_payload_sha256:input.rawPayloadSha256,
   status:'received',delivery_count:2,first_received_at:at,last_received_at:at,terminal_at:null,last_error_code:null,last_error_message:null,created_at:at,updated_at:at});
  source.dispatches.push({id:randomUUID(),receipt_id:id,stripe_event_id:input.stripeEventId,livemode:input.livemode,status:'pending',attempt_count:0,
   available_at:at,claimed_at:null,lease_token:null,completed_at:null,last_error_code:null,last_error_message:null,created_at:at,updated_at:at});
 }
 return source;
}
