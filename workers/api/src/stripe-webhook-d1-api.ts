import Stripe from "stripe";
import {
  createStripeReceiptIngress,
  type StripeWebhookVerifier,
} from "../../../supabase/functions/_shared/stripe-receipt-ingress/index.ts";
import { selectD1Database, type Env } from "./repository.ts";
import { acceptStripeWebhookReceiptIntoD1 } from "./stripe-webhook-d1-ingress.ts";

const STRIPE_WEBHOOK_PATH = "/api/stripe/webhook";
const STRIPE_API_VERSION = "2025-08-27.basil";
const SIGNATURE_ONLY_KEY = "sk_test_webhook_signature_verification_only";

// This client is used only for signature verification. The fake test key is
// never used for Stripe API requests; all calls in the ingress path are local.
const stripe = new Stripe(SIGNATURE_ONLY_KEY, {
  apiVersion: STRIPE_API_VERSION,
  httpClient: Stripe.createFetchHttpClient(),
});
const cryptoProvider = Stripe.createSubtleCryptoProvider();

export function isStripeWebhookPath(pathname: string): boolean {
  return pathname === STRIPE_WEBHOOK_PATH;
}

function json(body: Record<string, unknown>, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
    },
  });
}

export async function handleStripeWebhookD1Request(request: Request, env: Env): Promise<Response | null> {
  const backend = env.STRIPE_WEBHOOK_BACKEND?.trim();
  if (!backend) return null;
  if (backend !== "d1") return json({ error: "server_misconfigured" }, 500);

  const secret = env.STRIPE_WEBHOOK_SECRET?.trim();
  const database = selectD1Database(env, "business");
  if (!secret || !database) return json({ error: "stripe_ingress_unavailable" }, 503);

  const ingress = createStripeReceiptIngress({
    stripe: stripe as unknown as StripeWebhookVerifier,
    webhookSecret: secret,
    cryptoProvider,
    persistReceipt: async (input) => {
      const result = await acceptStripeWebhookReceiptIntoD1({ database, event: input });
      return {
        receipt_id: result.receiptId,
        dispatch_id: result.dispatchId,
        outcome: result.outcome,
        receipt_status: result.receiptStatus,
        dispatch_status: result.dispatchStatus,
        delivery_count: result.deliveryCount,
      };
    },
  });
  return ingress(request);
}
