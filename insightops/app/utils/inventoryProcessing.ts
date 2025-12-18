/**
 * Inventory Processing Utility Functions
 * Extracted for testing and reuse
 */

export interface InventoryUpdate {
  available: number;
  oldAvailable: number | null;
  productTitle: string;
  variantTitle: string | null;
}

/**
 * Generate display name for a product/variant combination
 */
export function generateDisplayName(
  productTitle: string,
  variantTitle: string | null
): string {
  if (variantTitle && variantTitle !== "Default Title") {
    return `${productTitle} - ${variantTitle}`;
  }
  return productTitle;
}

/**
 * Generate inventory update message with directional arrow
 */
export function generateInventoryMessage(
  displayName: string,
  oldAvailable: number | null,
  newAvailable: number
): string {
  if (oldAvailable !== null && oldAvailable !== newAvailable) {
    const change = newAvailable - oldAvailable;
    const arrow = change > 0 ? "↑" : "↓";
    return `Stock ${arrow} "${displayName}" (${oldAvailable} → ${newAvailable})`;
  }
  return `Stock updated: "${displayName}" (${newAvailable} units)`;
}

/**
 * Check if a product is a gift card (should be filtered)
 */
export function isGiftCard(productTitle: string, productType: string): boolean {
  return (
    productTitle.toLowerCase().includes("gift card") ||
    productType.toLowerCase() === "gift_card"
  );
}

/**
 * Check if an inventory update was likely caused by a recent order
 * This is used to filter "symptom" events when we have the "cause" (order)
 */
export function wasInventoryUpdateCausedByOrder(
  productId: string,
  recentOrderDiff: string | null
): boolean {
  if (!recentOrderDiff || !productId) return false;

  try {
    const orderDiff = JSON.parse(recentOrderDiff);
    const orderProductIds =
      orderDiff.items?.map((item: { productId: number }) =>
        String(item.productId)
      ) || [];
    return orderProductIds.includes(productId);
  } catch {
    return false;
  }
}

/**
 * Build inventory diff JSON for storage
 */
export function buildInventoryDiff(
  available: number,
  oldAvailable: number | null,
  locationId: number
): string {
  return JSON.stringify({
    available,
    inventoryChange:
      oldAvailable !== null && oldAvailable !== available
        ? { old: oldAvailable, new: available }
        : null,
    locationId,
  });
}
