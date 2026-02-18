import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { queueWebhookJob, isWebhookProcessed } from "../services/jobQueue.server";

interface DiscountWebhookPayload {
  id: number;
  title: string;
  code?: string;
  value_type?: string;
  value?: string;
  usage_limit?: number | null;
  ends_at?: string | null;
  starts_at?: string | null;
  status?: string;
  discount_type?: string;
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

  const discount = payload as DiscountWebhookPayload;

  try {
    await queueWebhookJob({
      shop,
      topic,
      resourceId: String(discount.id),
      payload: discount,
      webhookId: webhookId || undefined,
      delayMs: 2000,
    });

    console.log(`[StoreGuard] Queued ${topic} for discount ${discount.id}`);
  } catch (error) {
    console.error(`[StoreGuard] Failed to queue job:`, error);
  }

  return new Response();
};
