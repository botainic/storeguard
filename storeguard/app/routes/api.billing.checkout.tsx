import type { ActionFunctionArgs } from "react-router";
import { authenticate, PRO_MONTHLY_PLAN } from "../shopify.server";

/**
 * Billing Checkout API — Shopify Billing
 *
 * POST /api/billing/checkout - Request Pro subscription
 * POST /api/billing/checkout?action=cancel - Cancel active subscription
 *
 * For upgrade: billing.request() throws a 401 with X-Shopify-API-Request-Failure-Reauthorize-Url
 * header when called via XHR. App Bridge's patched fetch intercepts this and redirects
 * the top frame to the Shopify payment page.
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

  // billing.request() throws a Response:
  // - For XHR: 401 with X-Shopify-API-Request-Failure-Reauthorize-Url header
  //   → App Bridge intercepts and redirects top frame to payment page
  // - For non-XHR: redirect to exit-iframe page
  await billing.request({
    plan: PRO_MONTHLY_PLAN,
    isTest: process.env.NODE_ENV !== "production",
  });

  // Never reached
  return Response.json({ error: "Unexpected billing state" }, { status: 500 });
};
