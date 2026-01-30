import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";

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

  // Check for duplicate
  if (webhookId) {
    const existing = await db.eventLog.findFirst({
      where: { webhookId },
    });
    if (existing) {
      console.log(`[StoreGuard] Duplicate webhook ${webhookId}, skipping`);
      return new Response();
    }
  }

  const theme = payload as ThemePayload;

  // Only log when a theme becomes the main (published) theme
  // The themes/publish webhook fires when a theme is published to the live store
  const message = `Theme published: "${theme.name}"`;

  await db.eventLog.create({
    data: {
      shop,
      shopifyId: String(theme.id),
      topic: "themes/publish",
      author: "System/App",
      message,
      diff: JSON.stringify({
        themeId: theme.id,
        themeName: theme.name,
        role: theme.role,
      }),
      webhookId,
    },
  });

  console.log(`[StoreGuard] ✅ Logged: ${message}`);

  return new Response();
};
