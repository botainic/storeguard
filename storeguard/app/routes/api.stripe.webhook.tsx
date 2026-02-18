import type { ActionFunctionArgs } from "react-router";
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
 *
 * Note: In production, you should verify the webhook signature.
 * Set STRIPE_WEBHOOK_SECRET and use Stripe's signature verification.
 */

const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;

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

  // In production, verify webhook signature
  // For now, we'll trust the payload (test mode)
  if (STRIPE_WEBHOOK_SECRET) {
    const signature = request.headers.get("stripe-signature");
    if (!signature) {
      console.error("[StoreGuard] Missing Stripe signature");
      return Response.json({ error: "Missing signature" }, { status: 400 });
    }
    // TODO: Implement signature verification with stripe library
    // For V1, we proceed without verification in test mode
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
