import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { authenticate, PRO_MONTHLY_PLAN } from "../shopify.server";

/**
 * Billing upgrade route.
 * 
 * Calls Shopify Billing API directly via GraphQL to get the confirmation URL,
 * then redirects to the exit-iframe page which App Bridge handles.
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const url = new URL(request.url);

  const isTest = process.env.NODE_ENV !== "production";

  // Create the subscription directly via GraphQL
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
        returnUrl: `https://${session.shop}/admin/apps/insightops/app/settings?upgraded=true`,
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
    console.error("[StoreGuard] Billing errors:", result.userErrors);
    throw redirect(`/app/settings?${url.searchParams.toString()}&billing_error=true`);
  }

  const confirmationUrl = result?.confirmationUrl;
  if (!confirmationUrl) {
    console.error("[StoreGuard] No confirmation URL returned");
    throw redirect(`/app/settings?${url.searchParams.toString()}&billing_error=true`);
  }

  // Redirect to exit-iframe which App Bridge will handle
  const host = url.searchParams.get("host") || "";
  const shop = url.searchParams.get("shop") || session.shop;
  const exitParams = new URLSearchParams({
    shop,
    host,
    exitIframe: confirmationUrl,
  });

  throw redirect(`/auth/exit-iframe?${exitParams.toString()}`);
};

export default function BillingUpgrade() {
  return (
    <div style={{ padding: 40, textAlign: "center", color: "#6b7280" }}>
      Redirecting to billing...
    </div>
  );
}
