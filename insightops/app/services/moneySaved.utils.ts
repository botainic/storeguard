/**
 * Money Saved Estimation Utilities for StoreGuard
 *
 * Estimates how much revenue a merchant saves by catching a change early.
 * Pure functions — no database or API calls, fully testable.
 *
 * Formulas:
 *   Price drop:    |priceDelta| × dailySalesRate × DISCOVERY_DAYS × CONSERVATIVE_FACTOR
 *   Out of stock:  dailySalesRate × avgPrice × DISCOVERY_DAYS × CONSERVATIVE_FACTOR
 *   Visibility:    dailySalesRate × avgPrice × DISCOVERY_DAYS × CONSERVATIVE_FACTOR
 *
 * All estimates apply a 50% conservative factor to avoid overpromising.
 */

import type { ProductVelocity } from "./salesVelocity.utils";

/** How many days the issue would go unnoticed without StoreGuard */
const DISCOVERY_DAYS = 3;

/** Conservative multiplier to avoid overpromising */
const CONSERVATIVE_FACTOR = 0.5;

export interface MoneySavedInput {
  eventType: string;
  velocity: ProductVelocity | null;
  beforeValue: string | null;
  afterValue: string | null;
}

/**
 * Parse a price string like "$89.00" or "89.00" to a number.
 * Returns null if unparseable.
 */
function parsePrice(value: string | null): number | null {
  if (!value) return null;
  const num = parseFloat(value.replace(/^\$/, ""));
  return isNaN(num) ? null : num;
}

/**
 * Estimate money saved for a price change event.
 * Only applies to price drops (where merchant would lose money per sale).
 */
function estimatePriceDropSavings(
  velocity: ProductVelocity,
  beforeValue: string | null,
  afterValue: string | null
): number | null {
  const oldPrice = parsePrice(beforeValue);
  const newPrice = parsePrice(afterValue);

  if (oldPrice === null || newPrice === null) return null;

  // Only price drops cost money (price increases are fine)
  if (newPrice >= oldPrice) return null;

  const priceDelta = oldPrice - newPrice;
  return priceDelta * velocity.dailySalesRate * DISCOVERY_DAYS * CONSERVATIVE_FACTOR;
}

/**
 * Estimate money saved for an out-of-stock event.
 * Lost sales = velocity × avg price × days unnoticed.
 */
function estimateStockoutSavings(velocity: ProductVelocity): number | null {
  if (velocity.dailySalesRate === 0) return null;

  const avgPrice = velocity.totalRevenue / velocity.totalUnitsSold;
  return velocity.dailySalesRate * avgPrice * DISCOVERY_DAYS * CONSERVATIVE_FACTOR;
}

/**
 * Estimate money saved for a visibility change that hides a product.
 * Same as stockout — product invisible means zero sales.
 */
function estimateVisibilitySavings(
  velocity: ProductVelocity,
  afterValue: string | null
): number | null {
  // Only hidden products cost money (draft/archived)
  if (afterValue === "active") return null;

  if (velocity.dailySalesRate === 0) return null;

  const avgPrice = velocity.totalRevenue / velocity.totalUnitsSold;
  return velocity.dailySalesRate * avgPrice * DISCOVERY_DAYS * CONSERVATIVE_FACTOR;
}

/**
 * Estimate money saved by catching a change event.
 * Returns null when estimation isn't applicable (no velocity data, no impact).
 * Returns a positive dollar amount rounded to 2 decimal places.
 */
export function estimateMoneySaved(input: MoneySavedInput): number | null {
  const { eventType, velocity, beforeValue, afterValue } = input;

  if (!velocity || velocity.dailySalesRate === 0) {
    return null;
  }

  let estimate: number | null = null;

  switch (eventType) {
    case "price_change":
      estimate = estimatePriceDropSavings(velocity, beforeValue, afterValue);
      break;
    case "inventory_zero":
      estimate = estimateStockoutSavings(velocity);
      break;
    case "inventory_low":
      // Low stock is a warning — estimate savings if it would eventually hit zero
      estimate = estimateStockoutSavings(velocity);
      break;
    case "visibility_change":
      estimate = estimateVisibilitySavings(velocity, afterValue);
      break;
    default:
      // Other event types (theme_publish, collection, discount, etc.) don't have
      // quantifiable revenue impact
      return null;
  }

  if (estimate === null || estimate <= 0) return null;

  // Round to 2 decimal places
  return Math.round(estimate * 100) / 100;
}
