import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { queueWebhookJob } from "../services/jobQueue.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const webhookId = request.headers.get("X-Shopify-Webhook-Id");

  const { shop, session, topic, payload } =
    await authenticate.webhook(request);

  console.log(`[StoreGuard] Received ${topic} webhook for ${shop} (ID: ${webhookId})`);

  if (!session) {
    return new Response();
  }

  const order = payload as { id: number };

  await queueWebhookJob({
    shop,
    topic,
    resourceId: String(order.id),
    payload,
    webhookId: webhookId || undefined,
  });

  return new Response();
};
