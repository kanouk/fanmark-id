import type { SupabaseClient } from "@supabase/supabase-js";
import Stripe from "stripe";
import {
  createStripeInvoiceProjectionProvider,
  createSupabaseInvoiceProjectionRuntime,
  type StripeInvoiceApiClient,
} from "../../../supabase/functions/_shared/stripe-invoice-projection/index.ts";

declare const serviceClient: SupabaseClient;
const runtime = createSupabaseInvoiceProjectionRuntime(serviceClient);
void runtime;

declare const stripe: Stripe;
const apiClient: StripeInvoiceApiClient = stripe;
const provider = createStripeInvoiceProjectionProvider(apiClient);
void provider;
