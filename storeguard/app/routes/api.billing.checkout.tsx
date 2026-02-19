import type { ActionFunctionArgs } from "react-router";
import { authenticate, PRO_MONTHLY_PLAN } from "../shopify.server";

/**
 * Billing Checkout API — Shopify Billing
 *
 * POST /api/billing/checkout - Request Pro subscription via Shopify Billing API
 * POST /api/billing/checkout?action=cancel - Cancel active subscription
 *
 * Shopify handles the entire payment flow — no external payment processor needed.
 */

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, billing } = await authenticate.admin(request);
  const url = new URL(request.url);
  const actionParam = url.searchParams.get("action");

  try {
    if (actionParam === "cancel") {
      // Get current subscription to cancel
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
    }

    // Default: Request Pro subscription
    // billing.request() throws a redirect Response to Shopify's payment page
    // After merchant approves, Shopify redirects back to the app
    await billing.request({
      plan: PRO_MONTHLY_PLAN,
      isTest: process.env.NODE_ENV !== "production",
    });

    // billing.request() never returns — it throws a redirect
    // This line is only reached if something unexpected happens
    return Response.json({ error: "Unexpected billing state" }, { status: 500 });
  } catch (error) {
    // billing.request() throws a Response (redirect) — let it through
    if (error instanceof Response) {
      throw error;
    }

    console.error("[StoreGuard] Billing error:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Billing error" },
      { status: 500 }
    );
  }
};
