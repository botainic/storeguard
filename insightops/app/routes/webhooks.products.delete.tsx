import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { queueWebhookJob, isWebhookProcessed } from "../services/jobQueue.server";

interface ProductDeletePayload {
  id: number;
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
    console.log(`[InsightOps] Duplicate webhook ${webhookId}, skipping`);
    return new Response();
  }

  const product = payload as ProductDeletePayload;

  try {
    // No delay for delete - we need to grab the title from cache before cleanup
    await queueWebhookJob({
      shop,
      topic,
      resourceId: String(product.id),
      payload: product,
      webhookId: webhookId || undefined,
      delayMs: 0, // Process immediately
    });

    console.log(`[InsightOps] Queued ${topic} for product ${product.id}`);
  } catch (error) {
    console.error(`[InsightOps] Failed to queue job:`, error);
  }

  return new Response();
};
