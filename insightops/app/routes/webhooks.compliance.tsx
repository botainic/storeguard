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
 * StoreGuard does NOT store customer PII (we strip names, emails, addresses
 * from order data), so customers/data_request and customers/redact are no-ops.
 * shop/redact deletes all data for the uninstalled shop.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);

  console.log(`Received compliance webhook: ${topic} for ${shop}`);

  switch (topic) {
    case "CUSTOMERS_DATA_REQUEST":
      // Customer requested their data. StoreGuard does not store customer PII.
      console.log("Customer data request - no PII stored by StoreGuard");
      break;

    case "CUSTOMERS_REDACT":
      // Store owner requested customer data deletion. StoreGuard does not store customer PII.
      console.log("Customer redact request - no PII stored by StoreGuard");
      break;

    case "SHOP_REDACT":
      // 48 hours after uninstall - delete all shop data
      console.log(`Shop redact request for ${shop}. Deleting all shop data.`);
      try {
        // Delete all data associated with this shop
        // Using the actual model names from schema.prisma

        // Delete change events
        await db.changeEvent.deleteMany({
          where: { shop },
        });

        // Delete event logs
        await db.eventLog.deleteMany({
          where: { shop },
        });

        // Delete product snapshots
        await db.productSnapshot.deleteMany({
          where: { shop },
        });

        // Delete product cache
        await db.productCache.deleteMany({
          where: { shop },
        });

        // Delete webhook jobs
        await db.webhookJob.deleteMany({
          where: { shop },
        });

        // Delete shop sync status
        await db.shopSync.delete({
          where: { shop },
        }).catch(() => {}); // May not exist

        // Delete shop settings
        await db.shop.deleteMany({
          where: { shopifyDomain: shop },
        });

        // Delete sessions
        await db.session.deleteMany({
          where: { shop },
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
