import type { ActionFunctionArgs } from "react-router";
import { authenticate, PRO_MONTHLY_PLAN } from "../shopify.server";

/**
 * Billing Checkout API
 *
 * POST /api/billing/checkout - Create subscription, return confirmation URL
 * POST /api/billing/checkout?action=cancel - Cancel active subscription
 */

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, billing, admin } = await authenticate.admin(request);
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
        return Response.json({ success: true });
      }

      return Response.json({ error: "No active subscription" }, { status: 400 });
    } catch (error) {
      if (error instanceof Response) throw error;
      return Response.json({ error: "Cancel failed" }, { status: 500 });
    }
  }

  // Create subscription via GraphQL and return the confirmation URL
  try {
    const isTest = process.env.NODE_ENV !== "production";
    const returnUrl = `https://admin.shopify.com/store/${session.shop.replace(".myshopify.com", "")}/apps/insightops/app/settings?upgraded=true`;

    const response = await admin.graphql(
      `#graphql
      mutation appSubscriptionCreate($name: String!, $lineItems: [AppSubscriptionLineItemInput!]!, $returnUrl: URL!, $test: Boolean) {
        appSubscriptionCreate(
          name: $name
          lineItems: $lineItems
          returnUrl: $returnUrl
          test: $test
        ) {
          appSubscription {
            id
          }
          confirmationUrl
          userErrors {
            field
            message
          }
        }
      }`,
      {
        variables: {
          name: PRO_MONTHLY_PLAN,
          returnUrl,
          test: isTest,
          lineItems: [
            {
              plan: {
                appRecurringPricingDetails: {
                  price: { amount: 19.0, currencyCode: "USD" },
                  interval: "EVERY_30_DAYS",
                },
              },
            },
          ],
        },
      }
    );

    const data = await response.json();
    const result = data.data?.appSubscriptionCreate;

    if (result?.userErrors?.length > 0) {
      console.error("[StoreGuard] Billing GraphQL errors:", result.userErrors);
      return Response.json({ error: result.userErrors[0].message }, { status: 400 });
    }

    if (!result?.confirmationUrl) {
      return Response.json({ error: "No confirmation URL" }, { status: 500 });
    }

    return Response.json({ confirmationUrl: result.confirmationUrl });
  } catch (error) {
    if (error instanceof Response) throw error;
    console.error("[StoreGuard] Billing error:", error);
    return Response.json({ error: "Billing request failed" }, { status: 500 });
  }
};
