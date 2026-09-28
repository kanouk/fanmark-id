import type { SupabaseClient } from "@supabase/supabase-js";
import Stripe from "stripe";
import {
  createStripeInvoiceProjectionProvider,
  createSupabaseInvoiceDispatchClaimer,
  createSupabaseInvoiceProjectionRuntime,
  type StripeInvoiceApiClient,
} from "../../../supabase/functions/_shared/stripe-invoice-projection/index.ts";

declare const serviceClient: SupabaseClient;
const runtime = createSupabaseInvoiceProjectionRuntime(serviceClient);
const claimDispatch = createSupabaseInvoiceDispatchClaimer(serviceClient);
void runtime;
void claimDispatch;

declare const stripe: Stripe;
const apiClient: StripeInvoiceApiClient = stripe;
const provider = createStripeInvoiceProjectionProvider(apiClient);
void provider;
