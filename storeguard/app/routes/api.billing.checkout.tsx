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

    // billing.request() throws a redirect Response to Shopify's payment confirmation page
    // We catch it and return the URL as JSON so the frontend can navigate via _top
    await billing.request({
      plan: PRO_MONTHLY_PLAN,
      isTest: process.env.NODE_ENV !== "production",
    });

    // Never reached — billing.request() always throws
    return Response.json({ error: "Unexpected billing state" }, { status: 500 });
  } catch (error) {
    // billing.request() throws a Response (redirect) — extract the URL and return as JSON
    if (error instanceof Response && (error.status === 301 || error.status === 302 || error.status === 303 || error.status === 307 || error.status === 308)) {
      const redirectUrl = error.headers.get("location");
      if (redirectUrl) {
        return Response.json({ redirectUrl });
      }
    }

    // Re-throw if it's some other Response
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
