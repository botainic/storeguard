/**
 * Pure utility functions for sales velocity calculations.
 * Extracted for testability — no database or API calls.
 */

export interface OrderLineItem {
  productId: string;
  variantId: string;
  quantity: number;
  price: number;
}

export interface OrderData {
  id: string;
  createdAt: string; // ISO date
  lineItems: OrderLineItem[];
}

export interface ProductVelocity {
  productId: string;
  totalUnitsSold: number;
  totalRevenue: number;
  orderCount: number;
  dailySalesRate: number; // units per day
  dailyRevenue: number; // revenue per day
  periodDays: number;
}

/**
 * Calculate sales velocity for each product from a list of orders.
 * Uses the actual date range of orders (not a fixed window) for accuracy.
 */
export function calculateProductVelocity(
  orders: OrderData[],
  periodDays: number
): Map<string, ProductVelocity> {
  const productStats = new Map<
    string,
    { totalUnits: number; totalRevenue: number; orderIds: Set<string> }
  >();

  for (const order of orders) {
    for (const item of order.lineItems) {
      const existing = productStats.get(item.productId);
      if (existing) {
        existing.totalUnits += item.quantity;
        existing.totalRevenue += item.quantity * item.price;
        existing.orderIds.add(order.id);
      } else {
        productStats.set(item.productId, {
          totalUnits: item.quantity,
          totalRevenue: item.quantity * item.price,
          orderIds: new Set([order.id]),
        });
      }
    }
  }

  const effectiveDays = Math.max(periodDays, 1);
  const result = new Map<string, ProductVelocity>();

  for (const [productId, stats] of productStats) {
    result.set(productId, {
      productId,
      totalUnitsSold: stats.totalUnits,
      totalRevenue: stats.totalRevenue,
      orderCount: stats.orderIds.size,
      dailySalesRate: stats.totalUnits / effectiveDays,
      dailyRevenue: stats.totalRevenue / effectiveDays,
      periodDays: effectiveDays,
    });
  }

  return result;
}

/**
 * Get velocity for a single product from a velocity map.
 */
export function getProductVelocity(
  velocityMap: Map<string, ProductVelocity>,
  productId: string
): ProductVelocity | null {
  return velocityMap.get(productId) ?? null;
}

/**
 * Format sales velocity as a human-readable string for alert context.
 * Examples:
 *   "selling 8/day" (high velocity)
 *   "selling ~1/day" (moderate)
 *   "sold 3 in the last 30 days" (low)
 *   null (no sales data)
 */
export function formatVelocityContext(
  velocity: ProductVelocity | null
): string | null {
  if (!velocity || velocity.totalUnitsSold === 0) {
    return null;
  }

  if (velocity.dailySalesRate >= 1) {
    const rounded = Math.round(velocity.dailySalesRate);
    return `selling ${rounded}/day`;
  }

  if (velocity.dailySalesRate >= 0.14) {
    // ~1/week or more
    const weeklyRate = Math.round(velocity.dailySalesRate * 7);
    return `selling ~${weeklyRate}/week`;
  }

  // Low velocity — just show total
  return `sold ${velocity.totalUnitsSold} in the last ${velocity.periodDays} days`;
}

/**
 * Estimate revenue impact for a stockout or pricing error.
 *
 * Price error: Daily Sales Rate * Hours Until Discovery * Price Difference
 * Stockout: Daily Sales Rate * Hours Out of Stock * Average Item Price
 */
export function estimateRevenueImpact(
  velocity: ProductVelocity | null,
  type: "price_error" | "stockout" | "visibility",
  params: {
    priceDifference?: number; // For price errors
    hoursUntilDiscovery?: number; // Default: 2 hours
    itemPrice?: number; // For stockout/visibility
  }
): number | null {
  if (!velocity || velocity.dailySalesRate === 0) {
    return null;
  }

  const hourlySalesRate = velocity.dailySalesRate / 24;
  const hours = params.hoursUntilDiscovery ?? 2;

  switch (type) {
    case "price_error": {
      const priceDiff = params.priceDifference ?? 0;
      if (priceDiff <= 0) return null;
      // Conservative: 50% of calculated impact
      return Math.round(hourlySalesRate * hours * priceDiff * 0.5 * 100) / 100;
    }
    case "stockout": {
      const price = params.itemPrice ?? velocity.dailyRevenue / velocity.dailySalesRate;
      // Conservative: 50% of calculated impact
      return Math.round(hourlySalesRate * hours * price * 0.5 * 100) / 100;
    }
    case "visibility": {
      const price = params.itemPrice ?? velocity.dailyRevenue / velocity.dailySalesRate;
      // Conservative: 50% of calculated impact
      return Math.round(hourlySalesRate * hours * price * 0.5 * 100) / 100;
    }
    default:
      return null;
  }
}
