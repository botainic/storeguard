import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { markShopUninstalled } from "../services/shopService.server";
import { cancelShopSubscription } from "../services/stripeService.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, session, topic } = await authenticate.webhook(request);

  console.log(`[StoreGuard] Received ${topic} webhook for ${shop}`);

  // 1. Cancel any active Stripe subscription to stop billing
  try {
    await cancelShopSubscription(shop);
  } catch (error) {
    // Log but continue - don't fail uninstall if Stripe fails
    console.error(`[StoreGuard] Error canceling subscription on uninstall:`, error);
  }

  // 2. Mark shop as uninstalled (keeps data for GDPR compliance - deleted after 48h via SHOP_REDACT)
  await markShopUninstalled(shop);

  // 3. Clean up pending webhook jobs (no point processing for uninstalled shop)
  await db.webhookJob.deleteMany({
    where: { shop, status: "pending" },
  });

  // 4. Delete sessions
  // Webhook requests can trigger multiple times and after an app has already been uninstalled.
  // If this webhook already ran, the session may have been deleted previously.
  if (session) {
    await db.session.deleteMany({ where: { shop } });
  }

  console.log(`[StoreGuard] App uninstalled for ${shop} - subscription canceled, jobs cleared`);

  return new Response();
};
