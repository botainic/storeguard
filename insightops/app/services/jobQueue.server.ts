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
 */
export async function queueWebhookJob(data: WebhookJobData): Promise<string> {
  const processAt = data.delayMs
    ? new Date(Date.now() + data.delayMs)
    : new Date();

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
  scheduleJobProcessing(data.delayMs ? data.delayMs + 500 : 500);

  return job.id;
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
 * Check if a webhook has already been processed (deduplication)
 */
export async function isWebhookProcessed(webhookId: string): Promise<boolean> {
  // Check both completed jobs and event logs
  const [existingJob, existingEvent] = await Promise.all([
    db.webhookJob.findUnique({ where: { webhookId } }),
    db.eventLog.findUnique({ where: { webhookId } }),
  ]);

  return !!(existingJob || existingEvent);
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
 * Mark a job as processing
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
