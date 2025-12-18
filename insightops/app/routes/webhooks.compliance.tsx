import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";

/**
 * GDPR Compliance Webhooks Handler
 *
 * This endpoint handles all three mandatory GDPR compliance webhooks:
 * - customers/data_request: Customer requests their data
 * - customers/redact: Store owner requests customer data deletion
 * - shop/redact: 48 hours after app uninstall, delete all shop data
 *
 * InsightOps does NOT store customer PII (we strip names, emails, addresses
 * from order data), so customers/data_request and customers/redact are no-ops.
 * shop/redact deletes all data for the uninstalled shop.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);

  console.log(`Received compliance webhook: ${topic} for ${shop}`);

  switch (topic) {
    case "CUSTOMERS_DATA_REQUEST":
      // Customer requested their data. InsightOps does not store customer PII.
      console.log("Customer data request - no PII stored by InsightOps");
      break;

    case "CUSTOMERS_REDACT":
      // Store owner requested customer data deletion. InsightOps does not store customer PII.
      console.log("Customer redact request - no PII stored by InsightOps");
      break;

    case "SHOP_REDACT":
      // 48 hours after uninstall - delete all shop data
      console.log(`Shop redact request for ${shop}. Deleting all shop data.`);
      try {
        // Delete all data associated with this shop
        // Order matters due to foreign key constraints

        // Delete orders first (references Shop)
        await db.order.deleteMany({
          where: { shop: { domain: shop } },
        });

        // Delete activity logs (references Shop)
        await db.activityLog.deleteMany({
          where: { shop: { domain: shop } },
        });

        // Delete shop settings (references Shop)
        await db.shopSettings.deleteMany({
          where: { shop: { domain: shop } },
        });

        // Delete sessions
        await db.session.deleteMany({
          where: { shop },
        });

        // Finally delete the shop record itself
        await db.shop.deleteMany({
          where: { domain: shop },
        });

        console.log(`Successfully deleted all data for shop: ${shop}`);
      } catch (error) {
        console.error(`Error deleting shop data for ${shop}:`, error);
        // Still return 200 to acknowledge receipt - Shopify expects this
      }
      break;

    default:
      console.log(`Unknown compliance topic: ${topic}`);
  }

  return new Response(null, { status: 200 });
};
