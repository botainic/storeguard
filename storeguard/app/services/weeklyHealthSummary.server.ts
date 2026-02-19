/**
 * Weekly Health Summary Service for StoreGuard
 *
 * Generates a weekly health report for each shop, sent every 7 days
 * regardless of activity. Includes:
 * - Section 1: Activity this week (ChangeEvent counts by type)
 * - Section 2: Current exposure snapshot (reuse risk scan data)
 * - Section 3: Protection reminder (static CTA)
 */

import db from "../db.server";
import type { RiskScanResult } from "./riskScan.server";
import { getCachedRiskScan } from "./riskScan.server";

export interface WeeklyActivitySummary {
  priceChanges: number;
  visibilityChanges: number;
  inventoryZero: number;
  inventoryLow: number;
  themePublishes: number;
  collectionChanges: number;
  discountChanges: number;
  domainChanges: number;
  appPermissionChanges: number;
  totalChanges: number;
}

export interface WeeklyHealthSummary {
  shop: string;
  alertEmail: string;
  generatedAt: Date;
  periodStart: Date;
  periodEnd: Date;
  activity: WeeklyActivitySummary;
  exposure: {
    zeroStockCount: number;
    lowStockCount: number;
    zeroPriceCount: number;
    highDiscountCount: number;
  };
  hasExposureData: boolean;
}

/**
 * Get all shops eligible for weekly summary (have alertEmail, not uninstalled).
 */
export async function getShopsForWeeklySummary(): Promise<string[]> {
  const shops = await db.shop.findMany({
    where: {
      alertEmail: { not: null },
      uninstalledAt: null,
    },
    select: { shopifyDomain: true },
  });

  return shops.map((s) => s.shopifyDomain);
}

/**
 * Count ChangeEvents from the last 7 days grouped by type.
 */
async function getWeeklyActivity(
  shop: string,
  periodStart: Date,
  periodEnd: Date,
): Promise<WeeklyActivitySummary> {
  const events = await db.changeEvent.groupBy({
    by: ["eventType"],
    where: {
      shop,
      detectedAt: { gte: periodStart, lte: periodEnd },
    },
    _count: { id: true },
  });

  const countMap = new Map<string, number>();
  for (const e of events) {
    countMap.set(e.eventType, e._count.id);
  }

  const priceChanges = countMap.get("price_change") ?? 0;
  const visibilityChanges = countMap.get("visibility_change") ?? 0;
  const inventoryZero = countMap.get("inventory_zero") ?? 0;
  const inventoryLow = countMap.get("inventory_low") ?? 0;
  const themePublishes = countMap.get("theme_publish") ?? 0;
  const collectionChanges =
    (countMap.get("collection_created") ?? 0) +
    (countMap.get("collection_updated") ?? 0) +
    (countMap.get("collection_deleted") ?? 0);
  const discountChanges =
    (countMap.get("discount_created") ?? 0) +
    (countMap.get("discount_changed") ?? 0) +
    (countMap.get("discount_deleted") ?? 0);
  const domainChanges =
    (countMap.get("domain_changed") ?? 0) +
    (countMap.get("domain_removed") ?? 0);
  const appPermissionChanges =
    countMap.get("app_permissions_changed") ?? 0;

  const totalChanges =
    priceChanges +
    visibilityChanges +
    inventoryZero +
    inventoryLow +
    themePublishes +
    collectionChanges +
    discountChanges +
    domainChanges +
    appPermissionChanges;

  return {
    priceChanges,
    visibilityChanges,
    inventoryZero,
    inventoryLow,
    themePublishes,
    collectionChanges,
    discountChanges,
    domainChanges,
    appPermissionChanges,
    totalChanges,
  };
}

/**
 * Generate a weekly health summary for a shop.
 * Uses cached risk scan data for the exposure snapshot (no full re-sync).
 * Returns null if no alertEmail configured.
 */
export async function generateWeeklyHealthSummary(
  shopDomain: string,
): Promise<WeeklyHealthSummary | null> {
  const shop = await db.shop.findUnique({
    where: { shopifyDomain: shopDomain },
  });

  if (!shop || !shop.alertEmail || shop.uninstalledAt) {
    return null;
  }

  const periodEnd = new Date();
  const periodStart = new Date(periodEnd.getTime() - 7 * 24 * 60 * 60 * 1000);

  // Section 1: Activity this week
  const activity = await getWeeklyActivity(shopDomain, periodStart, periodEnd);

  // Section 2: Current exposure snapshot from cached risk scan
  let exposure = {
    zeroStockCount: 0,
    lowStockCount: 0,
    zeroPriceCount: 0,
    highDiscountCount: 0,
  };
  let hasExposureData = false;

  const cachedScan = await getCachedRiskScan(shopDomain);
  if (cachedScan) {
    hasExposureData = true;
    exposure = {
      zeroStockCount: cachedScan.zeroStockProducts.length,
      lowStockCount: cachedScan.lowStockVariants.length,
      zeroPriceCount: cachedScan.zeroPriceProducts.length,
      highDiscountCount: cachedScan.highDiscounts.length,
    };
  }

  const summary: WeeklyHealthSummary = {
    shop: shopDomain,
    alertEmail: shop.alertEmail,
    generatedAt: new Date(),
    periodStart,
    periodEnd,
    activity,
    exposure,
    hasExposureData,
  };

  console.log(
    `[StoreGuard] Generated weekly summary for ${shopDomain}: ${activity.totalChanges} changes this week`,
  );

  return summary;
}
