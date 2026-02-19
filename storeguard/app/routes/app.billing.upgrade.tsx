import type { LoaderFunctionArgs } from "react-router";
import { authenticate, PRO_MONTHLY_PLAN } from "../shopify.server";

/**
 * Billing upgrade route — navigating here triggers the Shopify billing flow.
 * 
 * Uses billing.require() which is the canonical Shopify pattern:
 * - If merchant already has Pro: redirects back to settings
 * - If not: billing.request() triggers the App Bridge redirect to Shopify's payment page
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { billing } = await authenticate.admin(request);

  await billing.require({
    plans: [PRO_MONTHLY_PLAN],
    isTest: process.env.NODE_ENV !== "production",
    onFailure: async () => {
      // This triggers the Shopify payment confirmation page
      await billing.request({
        plan: PRO_MONTHLY_PLAN,
        isTest: process.env.NODE_ENV !== "production",
      });
    },
  });

  // If we get here, merchant already has Pro — redirect to settings
  const { redirect } = await import("react-router");
  const url = new URL(request.url);
  const host = url.searchParams.get("host") || "";
  const shop = url.searchParams.get("shop") || "";
  throw redirect(`/app/settings?host=${host}&shop=${shop}&upgraded=true`);
};

export default function BillingUpgrade() {
  return <div style={{ padding: 20, textAlign: "center" }}>Redirecting to billing...</div>;
}
