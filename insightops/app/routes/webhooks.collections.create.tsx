import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { queueWebhookJob, isWebhookProcessed } from "../services/jobQueue.server";

interface CollectionWebhookPayload {
  id: number;
  title: string;
  handle: string;
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

  const collection = payload as CollectionWebhookPayload;

  try {
    await queueWebhookJob({
      shop,
      topic,
      resourceId: String(collection.id),
      payload: collection,
      webhookId: webhookId || undefined,
      delayMs: 2000,
    });

    console.log(`[StoreGuard] Queued ${topic} for collection ${collection.id}`);
  } catch (error) {
    console.error(`[StoreGuard] Failed to queue job:`, error);
  }

  return new Response();
};
