import db from "../db.server";
import { canTrackFeature, getLowStockThreshold, hasInstantAlerts, getShopAlertEmail } from "./shopService.server";
import { sendInstantAlert } from "./emailService.server";
import {
  calculatePriceImportance,
  isSignificantVisibilityTransition,
  getVisibilityImportance,
  shouldAlertInventoryZero as checkInventoryZero,
  shouldAlertLowStock as checkLowStock,
  formatVariantLabel,
  isCriticalInstantAlert,
} from "./changeDetection.utils";
import { getProductSalesVelocity } from "./salesVelocity.server";
import {
  enrichPriceChange,
  enrichInventoryZero,
  enrichLowStock,
  enrichVisibilityChange,
  enrichThemePublish,
  serializeContext,
} from "./contextEnricher.server";
import { estimateMoneySaved } from "./moneySaved.utils";
import { diffScopes } from "./jobProcessor.utils";

/**
 * Change Detection Service for StoreGuard
 *
 * Detects and records changes that matter to merchants:
 * - Price changes
 * - Visibility changes (status: active/draft/archived)
 * - Inventory hitting zero
 * - Theme publishes
 */

// Variant info stored in ProductSnapshot
interface VariantSnapshot {
  id: string;
  title: string;
  price: string;
  inventoryQuantity: number;
}

// Product data from webhook
interface ProductPayload {
  id: number;
  title: string;
  status: string;
  variants: Array<{
    id: number;
    title: string;
    price: string;
    inventory_quantity: number;
  }>;
}

// Theme payload
interface ThemePayload {
  id: number;
  name: string;
  role: string;
}

/**
 * Get or create a ProductSnapshot for comparison
 */
async function getProductSnapshot(shop: string, productId: string): Promise<{
  title: string;
  status: string;
  variants: VariantSnapshot[];
} | null> {
  const snapshot = await db.productSnapshot.findUnique({
    where: { shop_id: { shop, id: productId } },
    include: { variants: true },
  });

  if (!snapshot) return null;

  return {
    title: snapshot.title,
    status: snapshot.status,
    variants: snapshot.variants.map(v => ({
      id: v.shopifyVariantId,
      title: v.title,
      price: v.price,
      inventoryQuantity: v.inventoryQuantity,
    })),
  };
}

/**
 * Update the ProductSnapshot after processing
 */
async function updateProductSnapshot(
  shop: string,
  productId: string,
  data: { title: string; status: string; variants: VariantSnapshot[] }
): Promise<void> {
  await db.$transaction(async (tx) => {
    await tx.productSnapshot.upsert({
      where: { shop_id: { shop, id: productId } },
      create: {
        id: productId,
        shop,
        title: data.title,
        status: data.status,
      },
      update: {
        title: data.title,
        status: data.status,
      },
    });

    for (const v of data.variants) {
      await tx.variantSnapshot.upsert({
        where: {
          productSnapshotId_shopifyVariantId: {
            productSnapshotId: productId,
            shopifyVariantId: String(v.id),
          },
        },
        create: {
          productSnapshotId: productId,
          shop,
          shopifyVariantId: String(v.id),
          title: v.title,
          price: String(v.price),
          inventoryQuantity: v.inventoryQuantity,
        },
        update: {
          title: v.title,
          price: String(v.price),
          inventoryQuantity: v.inventoryQuantity,
        },
      });
    }
  });
}

/** Max instant alert emails per shop per hour */
const INSTANT_ALERT_RATE_LIMIT = 10;

/**
 * Decide whether to send an instant alert for a change event.
 * Returns true only when:
 * 1. The shop has instant alerts enabled (Pro + toggle on + email set)
 * 2. The event is critical (price drop >50%, out of stock, visibility hidden, domain removed, permissions expanded)
 * 3. The shop has not exceeded the rate limit (max 10 per hour)
 */
export async function shouldSendInstantAlert(
  shop: string,
  event: { eventType: string; importance: string; afterValue?: string | null }
): Promise<boolean> {
  // 1. Feature gate: Pro plan + instant alerts enabled + email configured
  const enabled = await hasInstantAlerts(shop);
  if (!enabled) return false;

  // 2. Severity check: only critical events
  if (!isCriticalInstantAlert(event)) return false;

  // 3. Rate limit: max 10 instant alert emails per shop per hour
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const recentAlertCount = await db.changeEvent.count({
    where: {
      shop,
      instantAlertSentAt: { not: null, gte: oneHourAgo },
    },
  });

  if (recentAlertCount >= INSTANT_ALERT_RATE_LIMIT) {
    console.log(`[StoreGuard] Rate limit reached for ${shop}: ${recentAlertCount} instant alerts in last hour`);
    return false;
  }

  return true;
}

/**
 * Create a ChangeEvent record
 */
async function createChangeEvent(data: {
  shop: string;
  entityType: string;
  entityId: string;
  eventType: string;
  resourceName: string;
  beforeValue: string | null;
  afterValue: string | null;
  webhookId: string;
  source?: "webhook" | "sync_job" | "manual";
  importance?: "high" | "medium" | "low";
  groupId?: string;
  contextData?: string | null;
  moneySaved?: number | null;
}): Promise<void> {
  try {
    const importance = data.importance ?? "medium";

    // Check instant alert eligibility BEFORE creating the event (for rate limit accuracy)
    const sendInstant = await shouldSendInstantAlert(data.shop, {
      eventType: data.eventType,
      importance,
      afterValue: data.afterValue,
    });

    const event = await db.changeEvent.create({
      data: {
        shop: data.shop,
        entityType: data.entityType,
        entityId: data.entityId,
        eventType: data.eventType,
        resourceName: data.resourceName,
        beforeValue: data.beforeValue,
        afterValue: data.afterValue,
        webhookId: data.webhookId,
        source: data.source ?? "webhook",
        importance,
        groupId: data.groupId,
        contextData: data.contextData ?? null,
        instantAlertSentAt: sendInstant ? new Date() : null,
        moneySaved: data.moneySaved ?? null,
      },
    });
    console.log(`[StoreGuard] Created ${data.eventType} event for "${data.resourceName}"`);

    // Send instant alert for critical events only
    if (sendInstant) {
      const alertEmail = await getShopAlertEmail(data.shop);
      if (alertEmail) {
        // Fire and forget - don't block on email sending
        sendInstantAlert(
          {
            eventType: data.eventType,
            resourceName: data.resourceName,
            beforeValue: data.beforeValue,
            afterValue: data.afterValue,
            importance,
            detectedAt: event.detectedAt,
            contextData: data.contextData ?? null,
          },
          data.shop,
          alertEmail
        ).catch((err) => {
          console.error(`[StoreGuard] Failed to send instant alert:`, err);
        });
      }
    }
  } catch (error: unknown) {
    // Handle duplicate webhookId (already processed)
    if (error instanceof Error && error.message.includes("Unique constraint")) {
      console.log(`[StoreGuard] Duplicate event for webhookId ${data.webhookId}, skipping`);
      return;
    }
    throw error;
  }
}

/**
 * Detect price changes between old and new product state
 * Returns array of price changes (one per variant that changed)
 */
export async function detectPriceChanges(
  shop: string,
  product: ProductPayload,
  webhookId: string
): Promise<number> {
  // Check if shop wants to track prices
  if (!await canTrackFeature(shop, "prices")) {
    return 0;
  }

  const productId = String(product.id);
  const oldSnapshot = await getProductSnapshot(shop, productId);

  if (!oldSnapshot) {
    // First time seeing this product - create snapshot, no alerts
    await updateProductSnapshot(shop, productId, {
      title: product.title,
      status: product.status,
      variants: product.variants.map(v => ({
        id: String(v.id),
        title: v.title,
        price: v.price,
        inventoryQuantity: v.inventory_quantity,
      })),
    });
    return 0;
  }

  let changesDetected = 0;

  // Fetch sales velocity for business context (best-effort, non-blocking)
  let velocity: Awaited<ReturnType<typeof getProductSalesVelocity>> = null;
  try {
    velocity = await getProductSalesVelocity(shop, productId);
  } catch {
    // Non-critical — proceed without velocity context
  }

  // Compare each variant's price - only alert when price_before !== price_after
  for (const newVariant of product.variants) {
    const oldVariant = oldSnapshot.variants.find(v => v.id === String(newVariant.id));

    // Explicit rule: only fire when price actually changed
    if (oldVariant && oldVariant.price !== newVariant.price) {
      const variantLabel = formatVariantLabel(product.title, newVariant.title);
      const importance = calculatePriceImportance(oldVariant.price, newVariant.price);

      const enriched = enrichPriceChange(
        variantLabel,
        `$${oldVariant.price}`,
        `$${newVariant.price}`,
        velocity
      );
      const contextData = serializeContext(enriched);

      const moneySaved = estimateMoneySaved({
        eventType: "price_change",
        velocity,
        beforeValue: `$${oldVariant.price}`,
        afterValue: `$${newVariant.price}`,
      });

      await createChangeEvent({
        shop,
        entityType: "variant",
        entityId: String(newVariant.id),
        eventType: "price_change",
        resourceName: variantLabel,
        beforeValue: `$${oldVariant.price}`,
        afterValue: `$${newVariant.price}`,
        webhookId: `${webhookId}-price-${newVariant.id}`,
        importance: importance as "high" | "medium" | "low",
        contextData,
        moneySaved,
      });
      changesDetected++;
    }
  }

  // Update snapshot with new state
  await updateProductSnapshot(shop, productId, {
    title: product.title,
    status: product.status,
    variants: product.variants.map(v => ({
      id: String(v.id),
      title: v.title,
      price: v.price,
      inventoryQuantity: v.inventory_quantity,
    })),
  });

  return changesDetected;
}

/**
 * Detect visibility/status changes (active <-> draft <-> archived)
 */
export async function detectVisibilityChanges(
  shop: string,
  product: ProductPayload,
  webhookId: string
): Promise<boolean> {
  // Check if shop wants to track visibility
  if (!await canTrackFeature(shop, "visibility")) {
    return false;
  }

  const productId = String(product.id);
  const oldSnapshot = await getProductSnapshot(shop, productId);

  if (!oldSnapshot) {
    // First time - snapshot already created by detectPriceChanges or create here
    await updateProductSnapshot(shop, productId, {
      title: product.title,
      status: product.status,
      variants: product.variants.map(v => ({
        id: String(v.id),
        title: v.title,
        price: v.price,
        inventoryQuantity: v.inventory_quantity,
      })),
    });
    return false;
  }

  if (isSignificantVisibilityTransition(oldSnapshot.status, product.status)) {
    const importance = getVisibilityImportance(product.status);

    // Fetch sales velocity for business context (best-effort)
    let velocity: Awaited<ReturnType<typeof getProductSalesVelocity>> = null;
    try {
      velocity = await getProductSalesVelocity(shop, productId);
    } catch {
      // Non-critical
    }

    const enriched = enrichVisibilityChange(
      product.title,
      oldSnapshot.status,
      product.status,
      velocity
    );
    const contextData = serializeContext(enriched);

    const moneySaved = estimateMoneySaved({
      eventType: "visibility_change",
      velocity,
      beforeValue: oldSnapshot.status,
      afterValue: product.status,
    });

    await createChangeEvent({
      shop,
      entityType: "product",
      entityId: productId,
      eventType: "visibility_change",
      resourceName: product.title,
      beforeValue: oldSnapshot.status,
      afterValue: product.status,
      webhookId: `${webhookId}-status`,
      importance,
      contextData,
      moneySaved,
    });

    // Update snapshot
    await updateProductSnapshot(shop, productId, {
      title: product.title,
      status: product.status,
      variants: product.variants.map(v => ({
        id: String(v.id),
        title: v.title,
        price: v.price,
        inventoryQuantity: v.inventory_quantity,
      })),
    });

    return true;
  }

  // Update snapshot even if no significant change (status may have changed draft↔archived)
  if (oldSnapshot.status !== product.status) {
    await updateProductSnapshot(shop, productId, {
      title: product.title,
      status: product.status,
      variants: product.variants.map(v => ({
        id: String(v.id),
        title: v.title,
        price: v.price,
        inventoryQuantity: v.inventory_quantity,
      })),
    });
  }

  return false;
}

/**
 * Detect inventory hitting zero
 * Explicit rule: Only triggers on transition >0 → 0
 * Does NOT trigger on: 0 → 0, negative → 0, or any other scenario
 */
export async function detectInventoryZero(
  shop: string,
  inventoryItemId: string,
  productId: string,
  productTitle: string,
  variantTitle: string,
  newQuantity: number,
  previousQuantity: number | null, // Must be provided from webhook processing
  webhookId: string,
  locationContext?: string | null
): Promise<boolean> {
  // Check if shop wants to track inventory
  if (!await canTrackFeature(shop, "inventory")) {
    return false;
  }

  if (!checkInventoryZero(newQuantity, previousQuantity)) {
    return false;
  }

  // Prevent duplicate alerts by checking recent events for this specific variant
  const recentAlert = await db.changeEvent.findFirst({
    where: {
      shop,
      eventType: "inventory_zero",
      entityId: inventoryItemId, // Use inventory item ID for variant-level dedup
      detectedAt: {
        gte: new Date(Date.now() - 24 * 60 * 60 * 1000), // Last 24 hours
      },
    },
  });

  if (recentAlert) {
    console.log(`[StoreGuard] Already alerted for ${productTitle} inventory zero in last 24h`);
    return false;
  }

  // Fetch sales velocity for business context (best-effort)
  let velocity: Awaited<ReturnType<typeof getProductSalesVelocity>> = null;
  try {
    velocity = await getProductSalesVelocity(shop, productId);
  } catch {
    // Non-critical
  }

  const displayName = formatVariantLabel(productTitle, variantTitle);
  const enriched = enrichInventoryZero(
    displayName,
    String(previousQuantity),
    velocity,
    locationContext ?? null
  );
  const contextData = serializeContext(enriched);

  const moneySaved = estimateMoneySaved({
    eventType: "inventory_zero",
    velocity,
    beforeValue: String(previousQuantity),
    afterValue: "0",
  });

  await createChangeEvent({
    shop,
    entityType: "variant",
    entityId: inventoryItemId,
    eventType: "inventory_zero",
    resourceName: displayName,
    beforeValue: String(previousQuantity),
    afterValue: "0",
    webhookId: `${webhookId}-inventory-zero-${inventoryItemId}`,
    importance: "high",
    contextData,
    moneySaved,
  });

  return true;
}

/**
 * Detect inventory dropping below low stock threshold
 * Triggers when quantity crosses from above threshold to at or below threshold
 * Does NOT trigger on: already below threshold, or at zero (that's inventory_zero)
 */
export async function detectLowStock(
  shop: string,
  inventoryItemId: string,
  productId: string,
  productTitle: string,
  variantTitle: string,
  newQuantity: number,
  previousQuantity: number | null,
  webhookId: string,
  locationContext?: string | null
): Promise<boolean> {
  // Get the shop's low stock threshold
  const threshold = await getLowStockThreshold(shop);
  if (threshold === null) {
    return false; // Shop doesn't exist or inventory tracking disabled
  }

  if (!checkLowStock(newQuantity, previousQuantity, threshold)) {
    return false;
  }

  // Check for recent low stock alert for this variant (24 hour dedup)
  const recentAlert = await db.changeEvent.findFirst({
    where: {
      shop,
      eventType: "inventory_low",
      entityId: inventoryItemId,
      detectedAt: {
        gte: new Date(Date.now() - 24 * 60 * 60 * 1000),
      },
    },
  });

  if (recentAlert) {
    console.log(`[StoreGuard] Already alerted for ${productTitle} low stock in last 24h`);
    return false;
  }

  const displayName = formatVariantLabel(productTitle, variantTitle);

  // Fetch sales velocity for business context (best-effort)
  let velocity: Awaited<ReturnType<typeof getProductSalesVelocity>> = null;
  try {
    velocity = await getProductSalesVelocity(shop, productId);
  } catch {
    // Non-critical
  }

  const enriched = enrichLowStock(
    displayName,
    String(previousQuantity),
    String(newQuantity),
    velocity,
    locationContext ?? null
  );
  const contextData = serializeContext(enriched);

  const moneySaved = estimateMoneySaved({
    eventType: "inventory_low",
    velocity,
    beforeValue: String(previousQuantity),
    afterValue: String(newQuantity),
  });

  await createChangeEvent({
    shop,
    entityType: "variant",
    entityId: inventoryItemId,
    eventType: "inventory_low",
    resourceName: displayName,
    beforeValue: String(previousQuantity),
    afterValue: String(newQuantity),
    webhookId: `${webhookId}-inventory-low-${inventoryItemId}`,
    importance: "medium",
    contextData,
    moneySaved,
  });

  console.log(`[StoreGuard] Low stock alert: ${displayName} dropped to ${newQuantity} (threshold: ${threshold})`);

  return true;
}

/**
 * Record a theme publish event
 * Explicit rule: Only trigger when role === "main" (became the live theme)
 * The themes/publish webhook fires when a theme becomes the live theme
 */
export async function recordThemePublish(
  shop: string,
  theme: ThemePayload,
  webhookId: string
): Promise<boolean> {
  // Check if shop wants to track themes (Pro only)
  if (!await canTrackFeature(shop, "themes")) {
    console.log(`[StoreGuard] Theme tracking disabled for ${shop} (Free plan or disabled)`);
    return false;
  }

  // Explicit rule: Only alert when this theme became the live theme
  // The themes/publish webhook only fires when theme becomes live, but let's be explicit
  if (theme.role !== "main") {
    console.log(`[StoreGuard] Theme "${theme.name}" role is ${theme.role}, not main - skipping`);
    return false;
  }

  const enriched = enrichThemePublish(theme.name);
  const contextData = serializeContext(enriched);

  await createChangeEvent({
    shop,
    entityType: "theme",
    entityId: String(theme.id),
    eventType: "theme_publish",
    resourceName: theme.name,
    beforeValue: null,
    afterValue: "main",
    webhookId: `${webhookId}-theme`,
    importance: "high",
    contextData,
  });

  return true;
}

// ============================================
// COLLECTION CHANGE DETECTION
// ============================================

/**
 * Record a collection created event
 */
export async function recordCollectionCreated(
  shop: string,
  collectionId: string,
  collectionTitle: string,
  webhookId: string
): Promise<boolean> {
  if (!await canTrackFeature(shop, "collections")) {
    return false;
  }

  await createChangeEvent({
    shop,
    entityType: "collection",
    entityId: collectionId,
    eventType: "collection_created",
    resourceName: collectionTitle,
    beforeValue: null,
    afterValue: collectionTitle,
    webhookId: `${webhookId}-collection-created`,
    importance: "low",
  });

  return true;
}

/**
 * Record a collection updated event
 */
export async function recordCollectionUpdated(
  shop: string,
  collectionId: string,
  collectionTitle: string,
  webhookId: string
): Promise<boolean> {
  if (!await canTrackFeature(shop, "collections")) {
    return false;
  }

  await createChangeEvent({
    shop,
    entityType: "collection",
    entityId: collectionId,
    eventType: "collection_updated",
    resourceName: collectionTitle,
    beforeValue: null,
    afterValue: collectionTitle,
    webhookId: `${webhookId}-collection-updated`,
    importance: "medium",
  });

  return true;
}

/**
 * Record a collection deleted event
 * HIGH importance — deleting a collection breaks links and navigation
 */
export async function recordCollectionDeleted(
  shop: string,
  collectionId: string,
  collectionTitle: string,
  webhookId: string
): Promise<boolean> {
  if (!await canTrackFeature(shop, "collections")) {
    return false;
  }

  await createChangeEvent({
    shop,
    entityType: "collection",
    entityId: collectionId,
    eventType: "collection_deleted",
    resourceName: collectionTitle,
    beforeValue: collectionTitle,
    afterValue: null,
    webhookId: `${webhookId}-collection-deleted`,
    importance: "high",
  });

  return true;
}

// ============================================
// DISCOUNT CHANGE DETECTION (Pro only)
// ============================================

/**
 * Record a discount created event
 */
export async function recordDiscountCreated(
  shop: string,
  discountId: string,
  discountTitle: string,
  discountValue: string | null,
  webhookId: string
): Promise<boolean> {
  if (!await canTrackFeature(shop, "discounts")) {
    return false;
  }

  // Large discounts (>=50%) are high importance
  let importance: "high" | "medium" | "low" = "medium";
  if (discountValue) {
    const numericValue = parseFloat(discountValue);
    if (!isNaN(numericValue) && numericValue >= 50) {
      importance = "high";
    }
  }

  await createChangeEvent({
    shop,
    entityType: "discount",
    entityId: discountId,
    eventType: "discount_created",
    resourceName: discountTitle,
    beforeValue: null,
    afterValue: discountValue ? `${discountValue}% off` : discountTitle,
    webhookId: `${webhookId}-discount-created`,
    importance,
  });

  return true;
}

/**
 * Record a discount updated event
 */
export async function recordDiscountUpdated(
  shop: string,
  discountId: string,
  discountTitle: string,
  discountValue: string | null,
  webhookId: string
): Promise<boolean> {
  if (!await canTrackFeature(shop, "discounts")) {
    return false;
  }

  await createChangeEvent({
    shop,
    entityType: "discount",
    entityId: discountId,
    eventType: "discount_changed",
    resourceName: discountTitle,
    beforeValue: null,
    afterValue: discountValue ? `${discountValue}% off` : discountTitle,
    webhookId: `${webhookId}-discount-changed`,
    importance: "medium",
  });

  return true;
}

/**
 * Record a discount deleted event
 * HIGH importance — deleting a discount can break promotions
 */
export async function recordDiscountDeleted(
  shop: string,
  discountId: string,
  discountTitle: string,
  webhookId: string
): Promise<boolean> {
  if (!await canTrackFeature(shop, "discounts")) {
    return false;
  }

  await createChangeEvent({
    shop,
    entityType: "discount",
    entityId: discountId,
    eventType: "discount_deleted",
    resourceName: discountTitle,
    beforeValue: discountTitle,
    afterValue: null,
    webhookId: `${webhookId}-discount-deleted`,
    importance: "high",
  });

  return true;
}

// ============================================
// APP PERMISSION CHANGE DETECTION (Pro only)
// ============================================

/**
 * Record an app permissions changed event.
 * Diffs previous vs current scopes.
 * HIGH importance for scope expansions (new permissions added).
 */
export async function recordAppPermissionsChanged(
  shop: string,
  previousScopes: string[],
  currentScopes: string[],
  webhookId: string
): Promise<boolean> {
  if (!await canTrackFeature(shop, "app_permissions")) {
    return false;
  }

  // Diff scopes
  const { added, removed } = diffScopes(previousScopes, currentScopes);

  // No actual change
  if (added.length === 0 && removed.length === 0) {
    return false;
  }

  // Scope expansions are HIGH importance (security risk)
  const importance: "high" | "medium" | "low" = added.length > 0 ? "high" : "medium";

  let resourceName = "App permissions";
  if (added.length > 0 && removed.length === 0) {
    resourceName = `${added.length} scope${added.length > 1 ? "s" : ""} added`;
  } else if (removed.length > 0 && added.length === 0) {
    resourceName = `${removed.length} scope${removed.length > 1 ? "s" : ""} removed`;
  } else {
    resourceName = `${added.length} added, ${removed.length} removed`;
  }

  const contextData = JSON.stringify({ added, removed });

  await createChangeEvent({
    shop,
    entityType: "app",
    entityId: shop,
    eventType: "app_permissions_changed",
    resourceName,
    beforeValue: previousScopes.join(", "),
    afterValue: currentScopes.join(", "),
    webhookId: `${webhookId}-app-permissions`,
    importance,
    contextData,
  });

  return true;
}

// ============================================
// DOMAIN CHANGE DETECTION (Pro only)
// ============================================

/**
 * Record a domain changed event (created or updated)
 * HIGH importance — domain changes affect SEO and store access
 */
export async function recordDomainChanged(
  shop: string,
  domainId: string,
  domainHost: string,
  webhookId: string
): Promise<boolean> {
  if (!await canTrackFeature(shop, "domains")) {
    return false;
  }

  await createChangeEvent({
    shop,
    entityType: "domain",
    entityId: domainId,
    eventType: "domain_changed",
    resourceName: domainHost,
    beforeValue: null,
    afterValue: domainHost,
    webhookId: `${webhookId}-domain-changed`,
    importance: "high",
  });

  return true;
}

/**
 * Record a domain removed event
 * HIGH importance — removing a domain breaks store access
 */
export async function recordDomainRemoved(
  shop: string,
  domainId: string,
  domainHost: string,
  webhookId: string
): Promise<boolean> {
  if (!await canTrackFeature(shop, "domains")) {
    return false;
  }

  await createChangeEvent({
    shop,
    entityType: "domain",
    entityId: domainId,
    eventType: "domain_removed",
    resourceName: domainHost,
    beforeValue: domainHost,
    afterValue: null,
    webhookId: `${webhookId}-domain-removed`,
    importance: "high",
  });

  return true;
}

/**
 * Process a product update and detect all relevant changes
 * This is the main entry point called from jobProcessor
 */
export async function processProductChanges(
  shop: string,
  product: ProductPayload,
  webhookId: string
): Promise<{ priceChanges: number; statusChange: boolean }> {
  const priceChanges = await detectPriceChanges(shop, product, webhookId);
  const statusChange = await detectVisibilityChanges(shop, product, webhookId);

  return { priceChanges, statusChange };
}

/**
 * Delete ProductSnapshot when product is deleted
 */
export async function deleteProductSnapshot(shop: string, productId: string): Promise<void> {
  try {
    await db.productSnapshot.delete({
      where: { shop_id: { shop, id: productId } },
    });
  } catch {
    // Snapshot may not exist
  }
}
