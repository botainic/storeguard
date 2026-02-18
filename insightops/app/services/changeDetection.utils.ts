/**
 * Pure utility functions for change detection.
 * Extracted from changeDetection.server.ts for testability.
 */

/**
 * Calculate importance level based on price change magnitude.
 * >=50% change = high, >=20% = medium, <20% = low
 */
export function calculatePriceImportance(
  oldPrice: number | string,
  newPrice: number | string
): "high" | "medium" | "low" {
  const old = typeof oldPrice === "string" ? parseFloat(oldPrice) || 0 : oldPrice;
  const current = typeof newPrice === "string" ? parseFloat(newPrice) || 0 : newPrice;

  if (old === 0) return "high";

  const changePercent = (Math.abs(current - old) / old) * 100;
  if (changePercent >= 50) return "high";
  if (changePercent >= 20) return "medium";
  return "low";
}

/**
 * Check if a visibility transition is significant enough to alert on.
 * We only care about transitions involving "active" (visible on store).
 * draft <-> archived is not meaningful (both are hidden).
 */
export function isSignificantVisibilityTransition(
  oldStatus: string,
  newStatus: string
): boolean {
  if (oldStatus === newStatus) return false;

  const significantTransitions = [
    ["active", "draft"],
    ["active", "archived"],
    ["draft", "active"],
    ["archived", "active"],
  ];

  return significantTransitions.some(
    ([from, to]) => oldStatus === from && newStatus === to
  );
}

/**
 * Determine importance of a visibility change.
 * Going hidden = high, going visible = medium.
 */
export function getVisibilityImportance(
  newStatus: string
): "high" | "medium" {
  const goingHidden = newStatus === "draft" || newStatus === "archived";
  return goingHidden ? "high" : "medium";
}

/**
 * Check if an inventory zero alert should fire.
 * Only triggers on transition from >0 to exactly 0.
 */
export function shouldAlertInventoryZero(
  newQuantity: number,
  previousQuantity: number | null
): boolean {
  if (newQuantity !== 0) return false;
  if (previousQuantity === null || previousQuantity === undefined) return false;
  if (previousQuantity <= 0) return false;
  return true;
}

/**
 * Check if a low stock alert should fire.
 * Triggers when quantity crosses from above threshold to at/below threshold.
 * Does not trigger at zero (that's handled by inventory_zero).
 */
export function shouldAlertLowStock(
  newQuantity: number,
  previousQuantity: number | null,
  threshold: number
): boolean {
  if (newQuantity === 0) return false;
  if (previousQuantity === null || previousQuantity === undefined) return false;

  const wasAboveThreshold = previousQuantity > threshold;
  const isAtOrBelowThreshold = newQuantity <= threshold;

  return wasAboveThreshold && isAtOrBelowThreshold;
}

/**
 * Format a variant label for display.
 * "Default Title" variants just show the product name.
 */
export function formatVariantLabel(
  productTitle: string,
  variantTitle: string | null
): string {
  if (!variantTitle || variantTitle === "Default Title") {
    return productTitle;
  }
  return `${productTitle} - ${variantTitle}`;
}

/**
 * Determine importance for a discount event.
 * High importance: >50% discount or unlimited usage.
 * Medium importance: everything else.
 */
export function calculateDiscountImportance(
  discountValue: number | null,
  discountType: string | null,
  usageLimit: number | null
): "high" | "medium" {
  // Unlimited usage = high importance
  if (usageLimit === null || usageLimit === 0) {
    return "high";
  }

  // Percentage discount >50% = high importance
  if (discountType === "percentage" && discountValue !== null && discountValue > 50) {
    return "high";
  }

  return "medium";
}

/**
 * Format a discount value for human-readable display.
 * e.g., "50%" for percentage, "$10.00" for fixed_amount
 */
export function formatDiscountValue(
  value: number | string | null,
  type: string | null
): string {
  if (value === null || value === undefined) return "unknown";
  const numValue = typeof value === "string" ? parseFloat(value) : value;
  if (isNaN(numValue)) return String(value);

  if (type === "percentage") {
    return `${numValue}%`;
  }
  return `$${numValue.toFixed(2)}`;
}

/**
 * Build a concise context string for discount events.
 * e.g., "50% off, code: SUMMER50, no usage limit, expires 2026-03-01"
 */
export function buildDiscountContext(info: {
  title: string;
  code?: string | null;
  value?: number | string | null;
  valueType?: string | null;
  usageLimit?: number | null;
  endsAt?: string | null;
}): string {
  const parts: string[] = [];

  if (info.value !== null && info.value !== undefined && info.valueType) {
    parts.push(`${formatDiscountValue(info.value, info.valueType)} off`);
  }

  if (info.code) {
    parts.push(`code: ${info.code}`);
  }

  if (info.usageLimit === null || info.usageLimit === 0) {
    parts.push("no usage limit");
  } else if (info.usageLimit) {
    parts.push(`limit: ${info.usageLimit} uses`);
  }

  if (info.endsAt) {
    const date = new Date(info.endsAt);
    if (!isNaN(date.getTime())) {
      parts.push(`expires ${date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`);
    }
  }

  return parts.join(", ");
}
