import type { ActionFunctionArgs } from "react-router";
import { createHmac, timingSafeEqual } from "crypto";
import {
  handleSubscriptionCreated,
  handleSubscriptionCanceled,
  getShopByStripeCustomer,
} from "../services/stripeService.server";

/**
 * Stripe Webhook Handler
 *
 * POST /api/stripe/webhook - Receives Stripe webhook events
 *
 * Handles:
 * - checkout.session.completed - User completed checkout
 * - customer.subscription.created - Subscription started
 * - customer.subscription.updated - Subscription changed
 * - customer.subscription.deleted - Subscription canceled
 */

const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;

// Stripe signature tolerance: 5 minutes
const SIGNATURE_TOLERANCE_SEC = 300;

/**
 * Verify Stripe webhook signature (v1 scheme)
 * https://docs.stripe.com/webhooks/signatures
 */
function verifyStripeSignature(
  payload: string,
  signatureHeader: string,
  secret: string
): boolean {
  // Parse the signature header: t=timestamp,v1=signature[,v1=signature...]
  const parts = signatureHeader.split(",");
  const timestamp = parts.find((p) => p.startsWith("t="))?.slice(2);
  const signatures = parts
    .filter((p) => p.startsWith("v1="))
    .map((p) => p.slice(3));

  if (!timestamp || signatures.length === 0) {
    return false;
  }

  // Check timestamp tolerance (prevent replay attacks)
  const ts = parseInt(timestamp, 10);
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - ts) > SIGNATURE_TOLERANCE_SEC) {
    console.error(`[StoreGuard] Stripe webhook timestamp too old: ${now - ts}s`);
    return false;
  }

  // Compute expected signature: HMAC-SHA256(secret, "timestamp.payload")
  const signedPayload = `${timestamp}.${payload}`;
  const expected = createHmac("sha256", secret)
    .update(signedPayload)
    .digest("hex");

  // Compare against all v1 signatures (timing-safe)
  const expectedBuf = Buffer.from(expected, "hex");
  return signatures.some((sig) => {
    try {
      const sigBuf = Buffer.from(sig, "hex");
      return (
        expectedBuf.length === sigBuf.length &&
        timingSafeEqual(expectedBuf, sigBuf)
      );
    } catch {
      return false;
    }
  });
}

interface StripeEvent {
  id: string;
  type: string;
  data: {
    object: {
      id: string;
      customer: string;
      status?: string;
      metadata?: Record<string, string>;
      subscription?: string;
    };
  };
}

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const payload = await request.text();

  // Verify webhook signature in production
  if (STRIPE_WEBHOOK_SECRET) {
    const signature = request.headers.get("stripe-signature");
    if (!signature) {
      console.error("[StoreGuard] Missing Stripe signature");
      return Response.json({ error: "Missing signature" }, { status: 400 });
    }
    if (!verifyStripeSignature(payload, signature, STRIPE_WEBHOOK_SECRET)) {
      console.error("[StoreGuard] Invalid Stripe signature");
      return Response.json({ error: "Invalid signature" }, { status: 400 });
    }
  } else if (process.env.NODE_ENV === "production") {
    console.error("[StoreGuard] STRIPE_WEBHOOK_SECRET not set in production");
    return Response.json({ error: "Webhook not configured" }, { status: 500 });
  }

  let event: StripeEvent;
  try {
    event = JSON.parse(payload);
  } catch {
    console.error("[StoreGuard] Invalid webhook payload");
    return Response.json({ error: "Invalid payload" }, { status: 400 });
  }

  console.log(`[StoreGuard] Stripe webhook: ${event.type}`);

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        // User completed checkout - subscription is now active
        const session = event.data.object;
        const shopDomain = session.metadata?.shopifyDomain;
        const subscriptionId = session.subscription;
        const customerId = session.customer;

        if (shopDomain && subscriptionId) {
          await handleSubscriptionCreated(subscriptionId, customerId, shopDomain);
        } else {
          console.warn("[StoreGuard] Checkout completed but missing metadata:", {
            shopDomain,
            subscriptionId,
          });
        }
        break;
      }

      case "customer.subscription.created":
      case "customer.subscription.updated": {
        const subscription = event.data.object;
        const customerId = subscription.customer;
        const subscriptionId = subscription.id;
        const status = subscription.status;

        // Get shop from metadata or customer lookup
        let shopDomain = subscription.metadata?.shopifyDomain;
        if (!shopDomain) {
          shopDomain = await getShopByStripeCustomer(customerId) || undefined;
        }

        if (shopDomain) {
          if (status === "active" || status === "trialing") {
            await handleSubscriptionCreated(subscriptionId, customerId, shopDomain);
          } else if (status === "canceled" || status === "unpaid" || status === "past_due") {
            await handleSubscriptionCanceled(subscriptionId, shopDomain);
          }
        }
        break;
      }

      case "customer.subscription.deleted": {
        // Subscription was canceled/ended
        const subscription = event.data.object;
        const customerId = subscription.customer;

        let shopDomain = subscription.metadata?.shopifyDomain;
        if (!shopDomain) {
          shopDomain = await getShopByStripeCustomer(customerId) || undefined;
        }

        if (shopDomain) {
          await handleSubscriptionCanceled(subscription.id, shopDomain);
        }
        break;
      }

      default:
        console.log(`[StoreGuard] Unhandled Stripe event: ${event.type}`);
    }

    return Response.json({ received: true });
  } catch (error) {
    console.error("[StoreGuard] Webhook processing error:", error);
    return Response.json(
      { error: "Webhook processing failed" },
      { status: 500 }
    );
  }
};
