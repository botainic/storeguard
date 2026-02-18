import type { ActionFunctionArgs } from "react-router";
import { processPendingJobs } from "../services/jobProcessor.server";
import { cleanupOldJobs } from "../services/jobQueue.server";

/**
 * API endpoint to process pending webhook jobs.
 *
 * This can be called:
 * 1. By a cron job (e.g., every 5 seconds)
 * 2. After webhook ACK (fire-and-forget)
 * 3. Manually for debugging
 *
 * POST /api/jobs/process
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  // Simple auth check - in production, use a proper secret
  const authHeader = request.headers.get("Authorization");
  const expectedToken = process.env.JOB_PROCESSOR_SECRET || "storeguard-jobs";

  if (authHeader !== `Bearer ${expectedToken}`) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    // Process pending jobs
    const result = await processPendingJobs();

    // Periodically clean up old jobs (every ~100 calls)
    if (Math.random() < 0.01) {
      await cleanupOldJobs(7);
    }

    return new Response(
      JSON.stringify({
        success: true,
        processed: result.processed,
        failed: result.failed,
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("[StoreGuard] Job processor error:", error);
    return new Response(
      JSON.stringify({ error: String(error) }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
};

// Also support GET for easy testing
export const loader = async (args: ActionFunctionArgs) => {
  return action(args);
};
