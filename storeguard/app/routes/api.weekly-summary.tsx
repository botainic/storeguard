import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import {
  getShopsForWeeklySummary,
  generateWeeklyHealthSummary,
} from "../services/weeklyHealthSummary.server";
import { sendWeeklySummary } from "../services/emailService.server";

/**
 * Weekly Health Summary API Endpoint
 *
 * Sends weekly health summary emails to all shops with alertEmail configured.
 * Called by the in-process scheduler (every 7 days) or an external cron.
 *
 * Authentication: Requires CRON_SECRET header or query param.
 *
 * GET  /api/weekly-summary - Preview shops that would receive summaries
 * POST /api/weekly-summary - Send summaries to all eligible shops
 * POST /api/weekly-summary?shop=xxx.myshopify.com - Send to specific shop (testing)
 */

const CRON_SECRET = process.env.CRON_SECRET || process.env.JOB_PROCESSOR_SECRET;

function isAuthorized(request: Request): boolean {
  if (!CRON_SECRET) {
    if (process.env.NODE_ENV === "production") {
      console.error("[StoreGuard] CRON_SECRET not configured — rejecting weekly summary request");
      return false;
    }
    return true;
  }

  const url = new URL(request.url);
  const headerSecret =
    request.headers.get("x-cron-secret") ||
    request.headers.get("authorization")?.replace("Bearer ", "");
  const querySecret = url.searchParams.get("secret");

  return headerSecret === CRON_SECRET || querySecret === CRON_SECRET;
}

/**
 * GET: Preview which shops would receive weekly summaries
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  if (!isAuthorized(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const shops = await getShopsForWeeklySummary();

    return Response.json({
      message: "Shops eligible for weekly summary",
      count: shops.length,
      shops,
    });
  } catch (error) {
    console.error("[StoreGuard] Failed to get weekly summary shops:", error);
    return Response.json(
      { error: "Failed to get weekly summary shops" },
      { status: 500 },
    );
  }
};

/**
 * POST: Send weekly summary emails
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
    totalChanges?: number;
    error?: string;
  }> = [];

  try {
    let shopsToProcess: string[];

    if (specificShop) {
      shopsToProcess = [specificShop];
      console.log(`[StoreGuard] Weekly summary requested for specific shop: ${specificShop}`);
    } else {
      shopsToProcess = await getShopsForWeeklySummary();
      console.log(`[StoreGuard] Found ${shopsToProcess.length} shops for weekly summary`);
    }

    for (const shopDomain of shopsToProcess) {
      try {
        const summary = await generateWeeklyHealthSummary(shopDomain);

        if (!summary) {
          results.push({
            shop: shopDomain,
            success: true,
            totalChanges: 0,
            error: "No alert email configured or shop uninstalled",
          });
          continue;
        }

        const emailResult = await sendWeeklySummary(summary);

        results.push({
          shop: shopDomain,
          success: emailResult.success,
          totalChanges: summary.activity.totalChanges,
          error: emailResult.error,
        });
      } catch (error) {
        console.error(`[StoreGuard] Weekly summary failed for ${shopDomain}:`, error);
        results.push({
          shop: shopDomain,
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }

    const successful = results.filter((r) => r.success && !r.error).length;
    const failed = results.filter((r) => !r.success).length;
    const skipped = results.filter((r) => r.success && r.error).length;

    return Response.json({
      message: "Weekly summary processing complete",
      summary: {
        total: shopsToProcess.length,
        successful,
        failed,
        skipped,
      },
      results,
    });
  } catch (error) {
    console.error("[StoreGuard] Weekly summary processing failed:", error);
    return Response.json(
      { error: "Weekly summary processing failed" },
      { status: 500 },
    );
  }
};
