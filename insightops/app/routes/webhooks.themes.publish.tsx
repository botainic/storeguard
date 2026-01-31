import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { recordThemePublish } from "../services/changeDetection.server";

interface ThemePayload {
  id: number;
  name: string;
  role: string; // "main", "unpublished", "demo"
  theme_store_id: number | null;
  previewable: boolean;
  processing: boolean;
  admin_graphql_api_id: string;
  created_at: string;
  updated_at: string;
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

  const theme = payload as ThemePayload;

  // Record theme publish event (checks if Pro plan and theme tracking enabled)
  const recorded = await recordThemePublish(shop, theme, webhookId);

  if (recorded) {
    console.log(`[StoreGuard] ✅ Theme publish alert created for "${theme.name}"`);
  }

  return new Response();
};
