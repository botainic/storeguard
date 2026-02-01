import db from "../db.server";

/**
 * Stripe Billing Service for StoreGuard
 *
 * Handles subscription management via Stripe API.
 * Environment variables required:
 * - STRIPE_SECRET_KEY: Your Stripe secret key
 * - STRIPE_PRO_PRICE_ID: Price ID for Pro plan
 */

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const STRIPE_PRO_PRICE_ID = process.env.STRIPE_PRO_PRICE_ID;

if (!STRIPE_SECRET_KEY) {
  console.warn("[StoreGuard] STRIPE_SECRET_KEY not configured");
}

/**
 * Make a request to Stripe API
 */
async function stripeRequest<T>(
  endpoint: string,
  method: "GET" | "POST" | "DELETE" = "GET",
  body?: Record<string, string>
): Promise<T> {
  const response = await fetch(`https://api.stripe.com/v1${endpoint}`, {
    method,
    headers: {
      Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body ? new URLSearchParams(body).toString() : undefined,
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error((data as { error?: { message?: string } }).error?.message || "Stripe API error");
  }

  return data as T;
}

interface StripeCustomer {
  id: string;
  email: string | null;
}

interface StripeCheckoutSession {
  id: string;
  url: string;
}

interface StripeSubscription {
  id: string;
  status: string;
  customer: string;
}

/**
 * Get or create a Stripe customer for a shop
 */
export async function getOrCreateStripeCustomer(
  shopDomain: string,
  email?: string
): Promise<string> {
  // Check if shop already has a Stripe customer
  const shop = await db.shop.findUnique({
    where: { shopifyDomain: shopDomain },
    select: { stripeCustomerId: true, alertEmail: true },
  });

  if (shop?.stripeCustomerId) {
    return shop.stripeCustomerId;
  }

  // Create new Stripe customer
  const customerEmail = email || shop?.alertEmail || undefined;
  const customer = await stripeRequest<StripeCustomer>("/customers", "POST", {
    email: customerEmail || "",
    "metadata[shopifyDomain]": shopDomain,
    description: `StoreGuard - ${shopDomain}`,
  });

  // Save customer ID to shop
  await db.shop.update({
    where: { shopifyDomain: shopDomain },
    data: { stripeCustomerId: customer.id },
  });

  console.log(`[StoreGuard] Created Stripe customer ${customer.id} for ${shopDomain}`);

  return customer.id;
}

/**
 * Create a Stripe Checkout session for Pro upgrade
 */
export async function createCheckoutSession(
  shopDomain: string,
  successUrl: string,
  cancelUrl: string
): Promise<string> {
  if (!STRIPE_PRO_PRICE_ID) {
    throw new Error("STRIPE_PRO_PRICE_ID not configured");
  }

  const customerId = await getOrCreateStripeCustomer(shopDomain);

  const session = await stripeRequest<StripeCheckoutSession>(
    "/checkout/sessions",
    "POST",
    {
      customer: customerId,
      mode: "subscription",
      "line_items[0][price]": STRIPE_PRO_PRICE_ID,
      "line_items[0][quantity]": "1",
      success_url: successUrl,
      cancel_url: cancelUrl,
      "metadata[shopifyDomain]": shopDomain,
      "subscription_data[metadata][shopifyDomain]": shopDomain,
    }
  );

  console.log(`[StoreGuard] Created checkout session for ${shopDomain}`);

  return session.url;
}

/**
 * Create a Stripe Customer Portal session for managing subscription
 */
export async function createPortalSession(
  shopDomain: string,
  returnUrl: string
): Promise<string> {
  const shop = await db.shop.findUnique({
    where: { shopifyDomain: shopDomain },
    select: { stripeCustomerId: true },
  });

  if (!shop?.stripeCustomerId) {
    throw new Error("Shop has no Stripe customer");
  }

  const session = await stripeRequest<{ url: string }>(
    "/billing_portal/sessions",
    "POST",
    {
      customer: shop.stripeCustomerId,
      return_url: returnUrl,
    }
  );

  return session.url;
}

/**
 * Handle successful subscription - upgrade shop to Pro
 */
export async function handleSubscriptionCreated(
  subscriptionId: string,
  customerId: string,
  shopDomain: string
): Promise<void> {
  await db.shop.update({
    where: { shopifyDomain: shopDomain },
    data: {
      plan: "pro",
      stripeSubscriptionId: subscriptionId,
      stripeCustomerId: customerId,
    },
  });

  console.log(`[StoreGuard] Upgraded ${shopDomain} to Pro (subscription: ${subscriptionId})`);
}

/**
 * Handle subscription cancellation - downgrade shop to Free
 */
export async function handleSubscriptionCanceled(
  subscriptionId: string,
  shopDomain: string
): Promise<void> {
  await db.shop.update({
    where: { shopifyDomain: shopDomain },
    data: {
      plan: "free",
      stripeSubscriptionId: null,
      trackThemes: false, // Disable Pro-only features
    },
  });

  console.log(`[StoreGuard] Downgraded ${shopDomain} to Free (subscription canceled)`);
}

/**
 * Get subscription status for a shop
 */
export async function getSubscriptionStatus(shopDomain: string): Promise<{
  plan: "free" | "pro";
  hasSubscription: boolean;
  stripeCustomerId: string | null;
}> {
  const shop = await db.shop.findUnique({
    where: { shopifyDomain: shopDomain },
    select: { plan: true, stripeSubscriptionId: true, stripeCustomerId: true },
  });

  return {
    plan: (shop?.plan as "free" | "pro") || "free",
    hasSubscription: !!shop?.stripeSubscriptionId,
    stripeCustomerId: shop?.stripeCustomerId || null,
  };
}

/**
 * Look up shop by Stripe customer ID
 */
export async function getShopByStripeCustomer(customerId: string): Promise<string | null> {
  const shop = await db.shop.findFirst({
    where: { stripeCustomerId: customerId },
    select: { shopifyDomain: true },
  });

  return shop?.shopifyDomain || null;
}

/**
 * Cancel a shop's Stripe subscription (e.g., on app uninstall)
 * Cancels immediately to stop billing
 */
export async function cancelShopSubscription(shopDomain: string): Promise<void> {
  const shop = await db.shop.findUnique({
    where: { shopifyDomain: shopDomain },
    select: { stripeSubscriptionId: true },
  });

  if (!shop?.stripeSubscriptionId) {
    console.log(`[StoreGuard] No subscription to cancel for ${shopDomain}`);
    return;
  }

  try {
    await stripeRequest<StripeSubscription>(
      `/subscriptions/${shop.stripeSubscriptionId}`,
      "DELETE"
    );
    console.log(`[StoreGuard] Canceled subscription ${shop.stripeSubscriptionId} for ${shopDomain}`);
  } catch (error) {
    // Log but don't fail - subscription might already be canceled
    console.error(`[StoreGuard] Failed to cancel subscription for ${shopDomain}:`, error);
  }
}
