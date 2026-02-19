/**
 * In-process scheduler for StoreGuard.
 * Runs digest + cleanup once daily and weekly summary every 7 days,
 * without needing an external cron service.
 *
 * Import this module from any server loader to activate it.
 * Uses a module-level singleton so it only runs once per process.
 */

const DIGEST_INTERVAL_MS = 60 * 60 * 1000; // Check every hour
let initialized = false;
let lastDigestDate: string | null = null;
let lastWeeklySummaryWeek: string | null = null;

function getDateKey(): string {
  // Use 8am UTC as the digest cutoff — roughly morning in most timezones
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-${String(now.getUTCDate()).padStart(2, "0")}`;
}

/**
 * Get a week key for the current Monday (ISO week).
 * Weekly summary runs once per Monday at 8am UTC.
 */
function getWeekKey(): string {
  const now = new Date();
  // Get the Monday of the current week
  const day = now.getUTCDay(); // 0=Sun, 1=Mon
  const diff = day === 0 ? -6 : 1 - day; // Adjust to Monday
  const monday = new Date(now);
  monday.setUTCDate(now.getUTCDate() + diff);
  return `${monday.getUTCFullYear()}-${String(monday.getUTCMonth() + 1).padStart(2, "0")}-${String(monday.getUTCDate()).padStart(2, "0")}`;
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

async function runWeeklySummary() {
  // Only run on Mondays
  const now = new Date();
  if (now.getUTCDay() !== 1) return;

  const weekKey = getWeekKey();

  // Only run once per week
  if (lastWeeklySummaryWeek === weekKey) return;

  // Only run after 8am UTC
  const hour = now.getUTCHours();
  if (hour < 8) return;

  lastWeeklySummaryWeek = weekKey;

  try {
    console.log(`[StoreGuard] Running scheduled weekly summary for week of ${weekKey}`);

    const { getShopsForWeeklySummary, generateWeeklyHealthSummary } =
      await import("./weeklyHealthSummary.server");
    const { sendWeeklySummary } = await import("./emailService.server");

    const shops = await getShopsForWeeklySummary();
    console.log(`[StoreGuard] Weekly summary: ${shops.length} eligible shops`);

    for (const shop of shops) {
      try {
        const summary = await generateWeeklyHealthSummary(shop);
        if (!summary) continue;

        const emailResult = await sendWeeklySummary(summary);
        if (emailResult.success) {
          console.log(`[StoreGuard] Weekly summary sent for ${shop}: ${summary.activity.totalChanges} changes this week`);
        }
      } catch (err) {
        console.error(`[StoreGuard] Weekly summary failed for ${shop}:`, err);
      }
    }
  } catch (err) {
    console.error("[StoreGuard] Scheduled weekly summary failed:", err);
    // Reset so it retries next hour
    lastWeeklySummaryWeek = null;
  }
}

export function initScheduler() {
  if (initialized) return;
  initialized = true;

  console.log("[StoreGuard] Scheduler initialized — daily digest at ~8am UTC, weekly summary on Mondays ~8am UTC");

  // Run checks immediately (in case server restarted after 8am)
  setTimeout(() => {
    runDailyDigest();
    runWeeklySummary();
  }, 10_000);

  // Then check every hour
  setInterval(() => {
    runDailyDigest();
    runWeeklySummary();
  }, DIGEST_INTERVAL_MS);
}
