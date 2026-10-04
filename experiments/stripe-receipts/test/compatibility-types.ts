import type { SupabaseClient } from "@supabase/supabase-js";
import Stripe from "stripe";
import {
  createSupabaseReceiptPersister,
  type StripeWebhookVerifier,
  type ReceiptPersistenceInput,
} from "../../../supabase/functions/_shared/stripe-receipt-ingress/index.ts";

declare const serviceClient: SupabaseClient;

// Supabase's rpc() returns a thenable PostgrestFilterBuilder rather than a
// native Promise. This assignment is a compile-time compatibility check for
// the adapter's PromiseLike boundary.
const persist = createSupabaseReceiptPersister(serviceClient);
declare const input: ReceiptPersistenceInput;
void persist(input);

declare const stripe: Stripe;
// The Node package and the Deno-compatible 18.5.0 build expose the same
// constructEventAsync call used by the future Edge adapter. This assignment
// intentionally makes any signature drift visible during typecheck.
const verifier: StripeWebhookVerifier = stripe;
void verifier;
