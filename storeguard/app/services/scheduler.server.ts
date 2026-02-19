/**
 * In-process scheduler for StoreGuard.
 * Runs digest + cleanup once daily without needing an external cron service.
 *
 * Import this module from any server loader to activate it.
 * Uses a module-level singleton so it only runs once per process.
 */

const DIGEST_INTERVAL_MS = 60 * 60 * 1000; // Check every hour
let initialized = false;
let lastDigestDate: string | null = null;

function getDateKey(): string {
  // Use 8am UTC as the digest cutoff — roughly morning in most timezones
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-${String(now.getUTCDate()).padStart(2, "0")}`;
}

async function runDailyDigest() {
  const today = getDateKey();

  // Only run once per calendar day
  if (lastDigestDate === today) return;

  // Only run after 8am UTC
  const hour = new Date().getUTCHours();
  if (hour < 8) return;

  lastDigestDate = today;

  try {
    console.log(`[StoreGuard] Running scheduled daily digest for ${today}`);

    // Dynamic import to avoid circular dependencies
    const { getShopsWithPendingDigests, generateDigestForShop, markEventsAsDigested, getEventIdsFromDigest } =
      await import("./dailyDigest.server");
    const { sendDigestEmail } = await import("./emailService.server");
    const { cleanupOldData } = await import("./jobQueue.server");

    const shops = await getShopsWithPendingDigests();
    console.log(`[StoreGuard] Digest: ${shops.length} shops with pending events`);

    for (const shop of shops) {
      try {
        const digest = await generateDigestForShop(shop);
        if (!digest) continue;

        const emailResult = await sendDigestEmail(digest);
        if (emailResult.success) {
          const eventIds = getEventIdsFromDigest(digest);
          await markEventsAsDigested(eventIds);
          console.log(`[StoreGuard] Digest sent for ${shop}: ${digest.totalChanges} changes`);
        }
      } catch (err) {
        console.error(`[StoreGuard] Digest failed for ${shop}:`, err);
      }
    }

    // Run retention cleanup
    try {
      await cleanupOldData();
    } catch (err) {
      console.error("[StoreGuard] Retention cleanup failed:", err);
    }
  } catch (err) {
    console.error("[StoreGuard] Scheduled digest failed:", err);
    // Reset so it retries next hour
    lastDigestDate = null;
  }
}

export function initScheduler() {
  if (initialized) return;
  initialized = true;

  console.log("[StoreGuard] Scheduler initialized — daily digest at ~8am UTC");

  // Run check immediately (in case server restarted after 8am)
  setTimeout(() => runDailyDigest(), 10_000);

  // Then check every hour
  setInterval(() => runDailyDigest(), DIGEST_INTERVAL_MS);
}
