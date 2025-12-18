import type { LoaderFunctionArgs } from "react-router";
import db from "../db.server";
import { queueWebhookJob } from "../services/jobQueue.server";
import { processPendingJobs } from "../services/jobProcessor.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  // 1. Find a valid session to use
  const session = await db.session.findFirst();

  if (!session) {
    return new Response(
      JSON.stringify({ error: "No session found. Please install the app first." }),
      { status: 404, headers: { "Content-Type": "application/json" } }
    );
  }

  const shop = session.shop;
  console.log(`[Test] Using shop: ${shop}`);

  // 2. Queue a fake inventory job
  // specific mock IDs - in a real scenario these would need to match real Shopify IDs
  // for the API calls in jobProcessor to succeed.
  // However, even if they fail API calls, it should still log "Inventory updated: Unknown Product"

  const jobId = await queueWebhookJob({
    shop,
    topic: "inventory/levels/update",
    resourceId: "123456789", // Fake inventory item ID
    payload: {
      inventory_item_id: 123456789,
      location_id: 987654321,
      available: 50 + Math.floor(Math.random() * 10), // Random stock level
      updated_at: new Date().toISOString(),
    },
    delayMs: 0, // No delay for test
  });

  console.log(`[Test] Queued job ${jobId}`);

  // 3. Process it immediately
  const result = await processPendingJobs();

  // 4. Check if event was created
  const recentEvent = await db.eventLog.findFirst({
    where: {
      shop,
      topic: "INVENTORY_LEVELS_UPDATE"
    },
    orderBy: { timestamp: "desc" }
  });

  return new Response(
    JSON.stringify({
      message: "Test completed",
      jobId,
      processingResult: result,
      recentEvent,
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
};


