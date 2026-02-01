import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import {
  getShopsWithPendingDigests,
  generateDigestForShop,
  markEventsAsDigested,
  getEventIdsFromDigest,
} from "../services/dailyDigest.server";
import { sendDigestEmail } from "../services/emailService.server";

/**
 * Daily Digest API Endpoint
 *
 * Triggers the daily digest email for all shops with pending events.
 * Called by a cron job (e.g., Railway cron, Inngest, or external service).
 *
 * Authentication: Requires CRON_SECRET header or query param.
 *
 * GET /api/digest - Preview shops that would receive digests
 * POST /api/digest - Send digests to all eligible shops
 * POST /api/digest?shop=xxx.myshopify.com - Send digest to specific shop (for testing)
 */

const CRON_SECRET = process.env.CRON_SECRET || process.env.JOB_PROCESSOR_SECRET;

function isAuthorized(request: Request): boolean {
  if (!CRON_SECRET) {
    console.warn("[StoreGuard] No CRON_SECRET configured, digest endpoint is open");
    return true; // Allow in development
  }

  const url = new URL(request.url);
  const headerSecret = request.headers.get("x-cron-secret") || request.headers.get("authorization")?.replace("Bearer ", "");
  const querySecret = url.searchParams.get("secret");

  return headerSecret === CRON_SECRET || querySecret === CRON_SECRET;
}

/**
 * GET: Preview which shops would receive digests
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  if (!isAuthorized(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const shops = await getShopsWithPendingDigests();

    return Response.json({
      message: "Shops with pending digests",
      count: shops.length,
      shops,
    });
  } catch (error) {
    console.error("[StoreGuard] Failed to get pending digests:", error);
    return Response.json(
      { error: "Failed to get pending digests" },
      { status: 500 }
    );
  }
};

/**
 * POST: Send digest emails
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  if (!isAuthorized(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const specificShop = url.searchParams.get("shop");

  const results: Array<{
    shop: string;
    success: boolean;
    eventCount?: number;
    error?: string;
  }> = [];

  try {
    // Get shops to process
    let shopsToProcess: string[];

    if (specificShop) {
      // Test mode: single shop
      shopsToProcess = [specificShop];
      console.log(`[StoreGuard] Digest requested for specific shop: ${specificShop}`);
    } else {
      // Production mode: all shops with pending digests
      shopsToProcess = await getShopsWithPendingDigests();
      console.log(`[StoreGuard] Found ${shopsToProcess.length} shops with pending digests`);
    }

    // Process each shop
    for (const shopDomain of shopsToProcess) {
      try {
        const digest = await generateDigestForShop(shopDomain);

        if (!digest) {
          results.push({
            shop: shopDomain,
            success: true,
            eventCount: 0,
            error: "No events to digest or no alert email configured",
          });
          continue;
        }

        // Send the email
        const emailResult = await sendDigestEmail(digest);

        if (emailResult.success) {
          // Mark events as digested
          const eventIds = getEventIdsFromDigest(digest);
          await markEventsAsDigested(eventIds);

          results.push({
            shop: shopDomain,
            success: true,
            eventCount: digest.totalChanges,
          });
        } else {
          results.push({
            shop: shopDomain,
            success: false,
            eventCount: digest.totalChanges,
            error: emailResult.error,
          });
        }
      } catch (error) {
        console.error(`[StoreGuard] Digest failed for ${shopDomain}:`, error);
        results.push({
          shop: shopDomain,
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }

    // Summary
    const successful = results.filter((r) => r.success && (r.eventCount ?? 0) > 0).length;
    const failed = results.filter((r) => !r.success).length;
    const skipped = results.filter((r) => r.success && r.eventCount === 0).length;

    return Response.json({
      message: "Daily digest processing complete",
      summary: {
        total: shopsToProcess.length,
        successful,
        failed,
        skipped,
      },
      results,
    });
  } catch (error) {
    console.error("[StoreGuard] Digest processing failed:", error);
    return Response.json(
      { error: "Digest processing failed" },
      { status: 500 }
    );
  }
};
