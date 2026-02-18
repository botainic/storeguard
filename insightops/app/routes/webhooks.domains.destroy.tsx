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

  const domain = payload as { id: number };

  await queueWebhookJob({
    shop,
    topic,
    resourceId: String(domain.id),
    payload,
    webhookId: webhookId || undefined,
    delayMs: 2000,
  });

  return new Response();
};
