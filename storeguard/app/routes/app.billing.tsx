import type { ActionFunctionArgs } from "react-router";
import { authenticate, PRO_MONTHLY_PLAN } from "../shopify.server";

/**
 * Billing route - handles subscription requests
 *
 * POST /app/billing - Initiates the Pro subscription flow
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { billing } = await authenticate.admin(request);

  // Request the Pro subscription
  // This redirects to Shopify's billing approval page
  await billing.request({
    plan: PRO_MONTHLY_PLAN,
    isTest: true, // Set to false in production for real charges
  });

  // billing.request never returns - it always redirects
  // This line is just for TypeScript
  return null;
};
