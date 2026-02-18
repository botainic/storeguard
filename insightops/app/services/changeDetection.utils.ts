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
 * Diff two sets of scopes and return added/removed.
 * Scopes are strings like "read_products", "write_orders", etc.
 */
export function diffScopes(
  previousScopes: string[],
  currentScopes: string[]
): { added: string[]; removed: string[] } {
  const prevSet = new Set(previousScopes.map((s) => s.trim()).filter(Boolean));
  const currSet = new Set(currentScopes.map((s) => s.trim()).filter(Boolean));

  const added = [...currSet].filter((s) => !prevSet.has(s)).sort();
  const removed = [...prevSet].filter((s) => !currSet.has(s)).sort();

  return { added, removed };
}

/**
 * Determine importance of a scope change.
 * Expansions (new permissions granted) are HIGH — potential security concern.
 * Reductions (permissions removed) are MEDIUM — usually intentional cleanup.
 */
export function getScopeChangeImportance(
  added: string[],
  removed: string[]
): "high" | "medium" {
  return added.length > 0 ? "high" : "medium";
}

/**
 * Format scope changes for human-readable display.
 * Returns a concise summary like "+read_orders, +write_products, -read_themes"
 */
export function formatScopeChanges(
  added: string[],
  removed: string[]
): { beforeValue: string; afterValue: string } {
  const beforeValue = removed.length > 0 ? removed.join(", ") : "(none)";
  const afterValue = added.length > 0 ? added.join(", ") : "(none)";
  return { beforeValue, afterValue };
}
