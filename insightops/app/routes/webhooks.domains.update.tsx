import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { recordDomainChange } from "../services/changeDetection.server";

interface DomainPayload {
  id: number;
  host: string;
  ssl_enabled: boolean;
  localization?: {
    country: string | null;
    default_locale: string;
    alternate_locales: string[];
  };
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const webhookId = request.headers.get("X-Shopify-Webhook-Id");

  const { shop, session, topic, payload } =
    await authenticate.webhook(request);

  console.log(`[StoreGuard] Received ${topic} webhook for ${shop} (ID: ${webhookId})`);

  if (!session) {
    console.log(`[StoreGuard] No session found for ${shop}, skipping`);
    return new Response();
  }

  if (!webhookId) {
    console.log(`[StoreGuard] No webhookId, skipping`);
    return new Response();
  }

  const domain = payload as DomainPayload;

  const recorded = await recordDomainChange(shop, domain, webhookId, "updated");

  if (recorded) {
    console.log(`[StoreGuard] Domain updated alert created for "${domain.host}"`);
  }

  return new Response();
};
