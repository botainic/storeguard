import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { queueWebhookJob, isWebhookProcessed } from "../services/jobQueue.server";

interface InventoryLevelPayload {
  inventory_item_id: number;
  location_id: number;
  available: number;
  updated_at: string;
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const webhookId = request.headers.get("X-Shopify-Webhook-Id");

  const { shop, session, topic, payload } =
    await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop} (ID: ${webhookId})`);

  if (!session) {
    console.log(`No session found for ${shop}, skipping`);
    return new Response();
  }

  // Check for duplicate (already processed or queued)
  if (webhookId && await isWebhookProcessed(webhookId)) {
    console.log(`[InsightOps] Duplicate webhook ${webhookId}, skipping`);
    return new Response();
  }

  const inventoryPayload = payload as InventoryLevelPayload;

  // Queue the job with 2s delay (consistent with other webhooks, though inventory might be faster)
  try {
    await queueWebhookJob({
      shop,
      topic,
      resourceId: String(inventoryPayload.inventory_item_id),
      payload: inventoryPayload,
      webhookId: webhookId || undefined,
      delayMs: 2000,
    });

    console.log(`[InsightOps] Queued ${topic} for inventory item ${inventoryPayload.inventory_item_id}`);
  } catch (error) {
    console.error(`[InsightOps] Failed to queue job:`, error);
  }

  // Always return 200 OK immediately
  return new Response();
};
