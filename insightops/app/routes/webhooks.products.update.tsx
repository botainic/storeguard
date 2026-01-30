import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { queueWebhookJob, isWebhookProcessed } from "../services/jobQueue.server";

interface ProductWebhookPayload {
  id: number;
  title: string;
  handle: string;
  variants: Array<{
    id: number;
    price: string;
    compare_at_price: string | null;
    inventory_quantity: number;
    title: string;
  }>;
  updated_at: string;
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const webhookId = request.headers.get("X-Shopify-Webhook-Id");

  const { shop, session, topic, payload } =
    await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop} (ID: ${webhookId})`);

  // ACK immediately if no session - Shopify requires fast response
  if (!session) {
    console.log(`No session found for ${shop}, skipping`);
    return new Response();
  }

  // Check for duplicate (already processed or queued)
  if (webhookId && await isWebhookProcessed(webhookId)) {
    console.log(`[StoreGuard] Duplicate webhook ${webhookId}, skipping`);
    return new Response();
  }

  const product = payload as ProductWebhookPayload;

  // Queue the job with 2s delay for Events API propagation
  // This returns immediately, avoiding webhook timeout
  try {
    await queueWebhookJob({
      shop,
      topic,
      resourceId: String(product.id),
      payload: product,
      webhookId: webhookId || undefined,
      delayMs: 2000, // Wait for Shopify Events API to populate
    });

    console.log(`[StoreGuard] Queued ${topic} for product ${product.id}`);
  } catch (error) {
    // If queue fails (e.g., duplicate), just log and continue
    console.error(`[StoreGuard] Failed to queue job:`, error);
  }

  // Always return 200 OK immediately
  return new Response();
};
