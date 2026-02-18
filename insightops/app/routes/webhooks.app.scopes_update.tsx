import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { recordAppPermissionsChange } from "../services/changeDetection.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const webhookId = request.headers.get("X-Shopify-Webhook-Id");
  const { payload, session, topic, shop } = await authenticate.webhook(request);
  console.log(`[StoreGuard] Received ${topic} webhook for ${shop} (ID: ${webhookId})`);

  const current = (payload.current ?? []) as string[];
  const previous = (payload.previous ?? []) as string[];

  // Always update session scopes (existing behavior)
  if (session) {
    await db.session.update({
      where: { id: session.id },
      data: { scope: current.toString() },
    });
  }

  // Record app permission change event (new behavior)
  if (webhookId) {
    const recorded = await recordAppPermissionsChange(
      shop,
      previous,
      current,
      webhookId
    );
    if (recorded) {
      console.log(`[StoreGuard] App permission change alert created for ${shop}`);
    }
  }

  return new Response();
};
