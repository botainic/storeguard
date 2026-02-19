import db from "../db.server";

// Track if processor is already scheduled
let processorScheduled = false;

interface WebhookJobData {
  shop: string;
  topic: string;
  resourceId: string;
  payload: unknown;
  webhookId?: string;
  delayMs?: number; // Delay before processing (for Events API propagation)
}

/**
 * Queue a webhook for background processing.
 * Returns immediately so the webhook handler can respond with 200 OK.
 * Automatically schedules job processing after the delay.
 *
 * Handles duplicate webhookIds gracefully via unique constraint — returns null if already queued.
 */
export async function queueWebhookJob(data: WebhookJobData): Promise<string | null> {
  const processAt = data.delayMs
    ? new Date(Date.now() + data.delayMs)
    : new Date();

  try {
    const job = await db.webhookJob.create({
      data: {
        shop: data.shop,
        topic: data.topic,
        resourceId: data.resourceId,
        payload: JSON.stringify(data.payload),
        webhookId: data.webhookId,
        processAt,
      },
    });

    console.log(`[StoreGuard] Queued job ${job.id} for ${data.topic}`);

    // Auto-schedule job processing (fire-and-forget)
    scheduleJobProcessing(data.delayMs ? data.delayMs + 500 : 100);

    return job.id;
  } catch (error: unknown) {
    // Handle duplicate webhookId (unique constraint violation)
    if ((error as any)?.code === "P2002") {
      console.log(`[StoreGuard] Duplicate webhook ${data.webhookId}, already queued`);
      return null;
    }
    throw error;
  }
}

/**
 * Schedule job processing after a delay.
 * Uses setTimeout to run in background without blocking.
 * Coalesces multiple calls to avoid redundant processing.
 */
function scheduleJobProcessing(delayMs: number): void {
  if (processorScheduled) return;

  processorScheduled = true;
  setTimeout(async () => {
    try {
      // Dynamic import to avoid circular dependency
      const { processPendingJobs } = await import("./jobProcessor.server");
      const result = await processPendingJobs();
      if (result.processed > 0 || result.failed > 0) {
        console.log(`[StoreGuard] Processed ${result.processed} jobs, ${result.failed} failed`);
      }
    } catch (error) {
      console.error("[StoreGuard] Background processor error:", error);
    } finally {
      processorScheduled = false;
    }
  }, delayMs);
}

/**
 * Get pending jobs ready for processing
 */
export async function getPendingJobs(limit: number = 10) {
  return db.webhookJob.findMany({
    where: {
      status: "pending",
      processAt: { lte: new Date() },
    },
    orderBy: { createdAt: "asc" },
    take: limit,
  });
}

/**
 * Atomically claim a job for processing.
 * Uses updateMany with status check to prevent race conditions
 * when multiple workers try to claim the same job.
 * Returns true if the job was claimed, false if already taken.
 */
export async function claimJob(jobId: string): Promise<boolean> {
  const result = await db.webhookJob.updateMany({
    where: {
      id: jobId,
      status: "pending", // Only claim if still pending
    },
    data: {
      status: "processing",
      attempts: { increment: 1 },
    },
  });
  return result.count > 0;
}

/**
 * Mark a job as processing (legacy — prefer claimJob for atomic claims)
 */
export async function markJobProcessing(jobId: string) {
  return db.webhookJob.update({
    where: { id: jobId },
    data: {
      status: "processing",
      attempts: { increment: 1 },
    },
  });
}

/**
 * Mark a job as completed
 */
export async function markJobCompleted(jobId: string) {
  return db.webhookJob.update({
    where: { id: jobId },
    data: {
      status: "completed",
      completedAt: new Date(),
    },
  });
}

/**
 * Mark a job as failed
 */
export async function markJobFailed(jobId: string, error: string) {
  const job = await db.webhookJob.findUnique({ where: { id: jobId } });

  // Retry up to 3 times with exponential backoff
  if (job && job.attempts < 3) {
    const delayMs = Math.pow(2, job.attempts) * 1000; // 2s, 4s, 8s
    return db.webhookJob.update({
      where: { id: jobId },
      data: {
        status: "pending",
        processAt: new Date(Date.now() + delayMs),
        error,
      },
    });
  }

  return db.webhookJob.update({
    where: { id: jobId },
    data: {
      status: "failed",
      error,
    },
  });
}

/**
 * Clean up old completed/failed jobs (run periodically)
 */
export async function cleanupOldJobs(olderThanDays: number = 7) {
  const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);

  const result = await db.webhookJob.deleteMany({
    where: {
      status: { in: ["completed", "failed"] },
      createdAt: { lt: cutoff },
    },
  });

  if (result.count > 0) {
    console.log(`[StoreGuard] Cleaned up ${result.count} old jobs`);
  }

  return result.count;
}

/**
 * Clean up old data to keep DB small:
 * - ChangeEvents older than 90 days (digested ones)
 * - ProductSnapshots with no recent ChangeEvents
 * - Completed/failed WebhookJobs older than 7 days
 */
export async function cleanupOldData() {
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

  // 1. Delete old digested change events (keep undigested ones)
  const events = await db.changeEvent.deleteMany({
    where: {
      detectedAt: { lt: ninetyDaysAgo },
      digestedAt: { not: null },
    },
  });

  // 2. Clean old webhook jobs
  const jobs = await cleanupOldJobs(7);

  if (events.count > 0 || jobs > 0) {
    console.log(`[StoreGuard] Retention cleanup: ${events.count} old events, ${jobs} old jobs`);
  }

  return { events: events.count, jobs };
}
