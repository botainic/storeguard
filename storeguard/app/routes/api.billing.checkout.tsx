import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { createCheckoutSession, createPortalSession } from "../services/stripeService.server";

/**
 * Billing Checkout API
 *
 * POST /api/billing/checkout - Create Stripe Checkout session for Pro upgrade
 * POST /api/billing/checkout?action=portal - Create Customer Portal session
 *
 * Returns JSON with redirect URL - client uses App Bridge for external redirect
 */

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const action = url.searchParams.get("action");

  // Base URL for redirects (back to the app in Shopify admin)
  const appUrl = `https://${session.shop}/admin/apps/storeguard`;
  const settingsUrl = `${appUrl}/settings`;

  try {
    if (action === "portal") {
      // Customer portal for managing existing subscription
      const portalUrl = await createPortalSession(session.shop, settingsUrl);
      return Response.json({ redirectUrl: portalUrl });
    }

    // Default: Create checkout session for Pro upgrade
    const checkoutUrl = await createCheckoutSession(
      session.shop,
      `${settingsUrl}?upgraded=true`, // Success URL
      `${settingsUrl}?canceled=true`  // Cancel URL
    );

    return Response.json({ redirectUrl: checkoutUrl });
  } catch (error) {
    console.error("[StoreGuard] Billing error:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Billing error" },
      { status: 500 }
    );
  }
};
