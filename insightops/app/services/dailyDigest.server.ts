import db from "../db.server";

/**
 * Daily Digest Service for StoreGuard
 *
 * Generates daily digest of change events for email notifications.
 * Groups events by type and includes summary statistics.
 */

export interface DigestEvent {
  id: string;
  entityType: string;
  entityId: string;
  eventType: string;
  resourceName: string;
  beforeValue: string | null;
  afterValue: string | null;
  detectedAt: Date;
  importance: string;
  contextData: string | null;
}

export interface DigestSummary {
  shop: string;
  alertEmail: string;
  generatedAt: Date;
  periodStart: Date;
  periodEnd: Date;
  totalChanges: number;
  highPriorityCount: number;
  eventsByType: {
    price_change: DigestEvent[];
    visibility_change: DigestEvent[];
    inventory_low: DigestEvent[];
    inventory_zero: DigestEvent[];
    theme_publish: DigestEvent[];
  };
}

/**
 * Get all shops that have:
 * 1. An alert email configured
 * 2. Not uninstalled
 * 3. At least one undigested event
 */
export async function getShopsWithPendingDigests(): Promise<string[]> {
  // Get shops with alert email configured and not uninstalled
  const shops = await db.shop.findMany({
    where: {
      alertEmail: { not: null },
      uninstalledAt: null,
    },
    select: { shopifyDomain: true },
  });

  // Filter to only shops with undigested events
  const shopsWithEvents: string[] = [];

  for (const shop of shops) {
    const eventCount = await db.changeEvent.count({
      where: {
        shop: shop.shopifyDomain,
        digestedAt: null,
      },
    });

    if (eventCount > 0) {
      shopsWithEvents.push(shop.shopifyDomain);
    }
  }

  return shopsWithEvents;
}

/**
 * Generate a digest for a specific shop
 * Returns null if no events to digest or no alert email configured
 */
export async function generateDigestForShop(shopDomain: string): Promise<DigestSummary | null> {
  // Get shop settings
  const shop = await db.shop.findUnique({
    where: { shopifyDomain: shopDomain },
  });

  if (!shop || !shop.alertEmail) {
    console.log(`[StoreGuard] No alert email for ${shopDomain}, skipping digest`);
    return null;
  }

  if (shop.uninstalledAt) {
    console.log(`[StoreGuard] Shop ${shopDomain} is uninstalled, skipping digest`);
    return null;
  }

  // Get undigested events from the last 24 hours
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const events = await db.changeEvent.findMany({
    where: {
      shop: shopDomain,
      digestedAt: null,
      detectedAt: { gte: twentyFourHoursAgo },
    },
    orderBy: { detectedAt: "desc" },
    take: 50, // Cap for email sanity
  });

  if (events.length === 0) {
    console.log(`[StoreGuard] No events to digest for ${shopDomain}`);
    return null;
  }

  // Group events by type
  const eventsByType = {
    price_change: [] as DigestEvent[],
    visibility_change: [] as DigestEvent[],
    inventory_low: [] as DigestEvent[],
    inventory_zero: [] as DigestEvent[],
    theme_publish: [] as DigestEvent[],
  };

  let highPriorityCount = 0;

  for (const event of events) {
    const digestEvent: DigestEvent = {
      id: event.id,
      entityType: event.entityType,
      entityId: event.entityId,
      eventType: event.eventType,
      resourceName: event.resourceName,
      beforeValue: event.beforeValue,
      afterValue: event.afterValue,
      detectedAt: event.detectedAt,
      importance: event.importance,
      contextData: event.contextData,
    };

    if (event.importance === "high") {
      highPriorityCount++;
    }

    // Add to appropriate category
    const eventType = event.eventType as keyof typeof eventsByType;
    if (eventsByType[eventType]) {
      eventsByType[eventType].push(digestEvent);
    }
  }

  // Build summary
  const digest: DigestSummary = {
    shop: shopDomain,
    alertEmail: shop.alertEmail,
    generatedAt: new Date(),
    periodStart: twentyFourHoursAgo,
    periodEnd: new Date(),
    totalChanges: events.length,
    highPriorityCount,
    eventsByType,
  };

  console.log(`[StoreGuard] Generated digest for ${shopDomain}: ${events.length} events`);

  return digest;
}

/**
 * Mark events as digested after successful email send
 */
export async function markEventsAsDigested(eventIds: string[]): Promise<void> {
  if (eventIds.length === 0) return;

  await db.changeEvent.updateMany({
    where: { id: { in: eventIds } },
    data: { digestedAt: new Date() },
  });

  console.log(`[StoreGuard] Marked ${eventIds.length} events as digested`);
}

/**
 * Get all event IDs from a digest summary
 */
export function getEventIdsFromDigest(digest: DigestSummary): string[] {
  const allEvents = [
    ...digest.eventsByType.price_change,
    ...digest.eventsByType.visibility_change,
    ...digest.eventsByType.inventory_low,
    ...digest.eventsByType.inventory_zero,
    ...digest.eventsByType.theme_publish,
  ];

  return allEvents.map((e) => e.id);
}

/**
 * Format event type for display
 */
export function formatEventType(eventType: string): string {
  switch (eventType) {
    case "price_change":
      return "Price Changes";
    case "visibility_change":
      return "Visibility Changes";
    case "inventory_low":
      return "Low Stock";
    case "inventory_zero":
      return "Out of Stock";
    case "theme_publish":
      return "Theme Published";
    default:
      return eventType;
  }
}

/**
 * Format a single event for email display
 */
export function formatEventForEmail(event: DigestEvent): string {
  const time = event.detectedAt.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });

  switch (event.eventType) {
    case "price_change":
      return `${event.resourceName}: ${event.beforeValue} → ${event.afterValue} (${time})`;
    case "visibility_change":
      return `${event.resourceName}: ${event.beforeValue} → ${event.afterValue} (${time})`;
    case "inventory_low":
      return `${event.resourceName}: stock dropped to ${event.afterValue} units (was ${event.beforeValue}) (${time})`;
    case "inventory_zero":
      return `${event.resourceName}: now out of stock (was ${event.beforeValue} units) (${time})`;
    case "theme_publish":
      return `"${event.resourceName}" is now your live theme (${time})`;
    default:
      return `${event.resourceName}: ${event.beforeValue} → ${event.afterValue} (${time})`;
  }
}
