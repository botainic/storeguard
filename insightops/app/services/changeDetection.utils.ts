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

// ============================================
// Multi-Location Inventory Utilities
// ============================================

export interface LocationInventory {
  locationId: string;
  locationName: string;
  available: number;
}

export interface MultiLocationResult {
  totalAvailable: number;
  locations: LocationInventory[];
  locationCount: number;
}

/**
 * Compute total available inventory across all locations.
 */
export function computeTotalInventory(locations: LocationInventory[]): number {
  return locations.reduce((sum, loc) => sum + loc.available, 0);
}

/**
 * Build a human-readable location context string for alerts.
 * Examples:
 *  - "Warehouse NYC hit zero, but 45 units remain across 2 other locations"
 *  - "Completely out of stock across all 3 locations"
 *  - "Stock low at Warehouse NYC (2 left), 45 units remain across 2 other locations"
 */
export function buildLocationContext(
  triggeringLocationName: string,
  triggeringLocationAvailable: number,
  allLocations: LocationInventory[]
): string {
  const otherLocations = allLocations.filter(
    (loc) => loc.locationName !== triggeringLocationName
  );
  const totalOther = otherLocations.reduce((sum, loc) => sum + loc.available, 0);
  const totalAll = triggeringLocationAvailable + totalOther;

  if (totalAll === 0) {
    if (allLocations.length === 1) {
      return "Out of stock";
    }
    return `Completely out of stock across all ${allLocations.length} locations`;
  }

  if (triggeringLocationAvailable === 0 && totalOther > 0) {
    const otherCount = otherLocations.length;
    const unitWord = totalOther !== 1 ? "units" : "unit";
    const remainWord = totalOther !== 1 ? "remain" : "remains";
    return `${triggeringLocationName} hit zero, but ${totalOther} ${unitWord} ${remainWord} across ${otherCount} other location${otherCount !== 1 ? "s" : ""}`;
  }

  if (totalOther > 0) {
    const otherCount = otherLocations.length;
    return `${triggeringLocationName} has ${triggeringLocationAvailable} left, ${totalOther} unit${totalOther !== 1 ? "s" : ""} at ${otherCount} other location${otherCount !== 1 ? "s" : ""}`;
  }

  return `${triggeringLocationName} has ${triggeringLocationAvailable} left (only location)`;
}

/**
 * Determine if an inventory_zero alert should fire considering multi-location.
 * Only alert when total inventory across ALL locations is zero.
 */
export function shouldAlertInventoryZeroMultiLocation(
  totalAvailable: number,
  previousTotalAvailable: number | null
): boolean {
  return shouldAlertInventoryZero(totalAvailable, previousTotalAvailable);
}

/**
 * Determine if an inventory_low alert should fire considering multi-location.
 * Uses total inventory across ALL locations against the threshold.
 */
export function shouldAlertLowStockMultiLocation(
  totalAvailable: number,
  previousTotalAvailable: number | null,
  threshold: number
): boolean {
  return shouldAlertLowStock(totalAvailable, previousTotalAvailable, threshold);
}
