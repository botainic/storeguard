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
 * Determine if a change event is critical enough for an immediate instant alert.
 *
 * Critical events:
 * - Price drop >50% (importance "high" on price_change)
 * - Out of stock across all locations (inventory_zero)
 * - Product hidden from store (visibility_change to draft/archived)
 * - Domain removed (domain_removed)
 * - App permissions expanded (app_permissions_changed with importance "high")
 */
export function isCriticalInstantAlert(event: {
  eventType: string;
  importance: string;
  afterValue?: string | null;
}): boolean {
  switch (event.eventType) {
    case "price_change":
      return event.importance === "high";
    case "inventory_zero":
      return true;
    case "visibility_change":
      return event.afterValue === "draft" || event.afterValue === "archived";
    case "domain_removed":
      return true;
    case "app_permissions_changed":
      return event.importance === "high";
    default:
      return false;
  }
}

/** Shape of each inventory level node returned by Shopify GraphQL */
export interface InventoryLevelNode {
  quantities: Array<{ quantity: number }>;
  location: { id: string; name: string } | null;
}

/**
 * Aggregate inventory level nodes into a total quantity and trigger location name.
 * Used by fetchTotalInventory after paginating through all inventory levels.
 */
export function aggregateInventoryLevels(
  nodes: InventoryLevelNode[],
  triggerLocationId: number
): { totalQuantity: number; locationName: string | null } {
  let totalQuantity = 0;
  let locationName: string | null = null;

  for (const level of nodes) {
    const qty = level.quantities?.[0]?.quantity ?? 0;
    totalQuantity += qty;

    // Identify the triggering location
    const locGid: string = level.location?.id ?? "";
    const locMatch = locGid.match(/\/Location\/(\d+)$/);
    if (locMatch?.[1] === String(triggerLocationId)) {
      locationName = level.location?.name ?? null;
    }
  }

  return { totalQuantity, locationName };
}
