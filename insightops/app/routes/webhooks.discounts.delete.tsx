import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { queueWebhookJob, isWebhookProcessed } from "../services/jobQueue.server";

interface DiscountDeletePayload {
  id: number;
  title?: string;
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

  if (webhookId && await isWebhookProcessed(webhookId)) {
    console.log(`[StoreGuard] Duplicate webhook ${webhookId}, skipping`);
    return new Response();
  }

  const discount = payload as DiscountDeletePayload;

  try {
    await queueWebhookJob({
      shop,
      topic,
      resourceId: String(discount.id),
      payload: discount,
      webhookId: webhookId || undefined,
      delayMs: 0, // Process immediately for deletes
    });

    console.log(`[StoreGuard] Queued ${topic} for discount ${discount.id}`);
  } catch (error) {
    console.error(`[StoreGuard] Failed to queue job:`, error);
  }

  return new Response();
};
