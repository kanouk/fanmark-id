import Stripe from "stripe";
import {
  createStripeSubscriptionProjectionProvider,
  projectStripeSubscriptionSnapshot,
  type StripePrivatePriceIdsByMode,
  type StripeSubscriptionApiClient,
} from "../../../supabase/functions/_shared/stripe-subscription-projection/index.ts";

declare const stripe: Stripe;
const apiClient: StripeSubscriptionApiClient = stripe;
const provider = createStripeSubscriptionProjectionProvider(apiClient);

declare const privatePriceIds: StripePrivatePriceIdsByMode;
const projection = projectStripeSubscriptionSnapshot({
  subscriptionId: "sub_typecheck",
  customerId: "cus_typecheck",
  livemode: false,
  privatePriceIds,
  provider,
});
void projection;
