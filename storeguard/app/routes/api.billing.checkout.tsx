import type { ActionFunctionArgs } from "react-router";
import { authenticate, PRO_MONTHLY_PLAN } from "../shopify.server";

/**
 * Billing Checkout API — Shopify Billing
 *
 * POST /api/billing/checkout - Request Pro subscription via Shopify Billing API
 * POST /api/billing/checkout?action=cancel - Cancel active subscription
 *
 * For upgrade: billing.request() handles the redirect (via App Bridge exitIframe flow).
 * For cancel: returns JSON success/error.
 */

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, billing } = await authenticate.admin(request);
  const url = new URL(request.url);
  const actionParam = url.searchParams.get("action");

  if (actionParam === "cancel") {
    try {
      const { appSubscriptions } = await billing.check({
        plans: [PRO_MONTHLY_PLAN],
      });

      if (appSubscriptions.length > 0) {
        await billing.cancel({
          subscriptionId: appSubscriptions[0].id,
          prorate: true,
        });
        return Response.json({ success: true, message: "Subscription cancelled" });
      }

      return Response.json({ error: "No active subscription" }, { status: 400 });
    } catch (error) {
      if (error instanceof Response) throw error;
      console.error("[StoreGuard] Cancel billing error:", error);
      return Response.json(
        { error: error instanceof Error ? error.message : "Billing error" },
        { status: 500 }
      );
    }
  }

  // Default: Request Pro subscription
  // billing.request() throws a redirect/401 that Shopify App Bridge handles
  // For embedded XHR: throws 401 with X-Shopify-API-Request-Failure-Reauthorize-Url
  // For form POST: throws redirect to exitIframe path
  await billing.request({
    plan: PRO_MONTHLY_PLAN,
    isTest: process.env.NODE_ENV !== "production",
  });

  // Never reached
  return Response.json({ error: "Unexpected billing state" }, { status: 500 });
};
