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
} from "./changeDetection.utils";

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
  });

  if (!snapshot) return null;

  try {
    const variants = JSON.parse(snapshot.variants) as VariantSnapshot[];
    return {
      title: snapshot.title,
      status: snapshot.status,
      variants,
    };
  } catch {
    return null;
  }
}

/**
 * Update the ProductSnapshot after processing
 */
async function updateProductSnapshot(
  shop: string,
  productId: string,
  data: { title: string; status: string; variants: VariantSnapshot[] }
): Promise<void> {
  await db.productSnapshot.upsert({
    where: { shop_id: { shop, id: productId } },
    create: {
      id: productId,
      shop,
      title: data.title,
      status: data.status,
      variants: JSON.stringify(data.variants),
    },
    update: {
      title: data.title,
      status: data.status,
      variants: JSON.stringify(data.variants),
    },
  });
}

/**
 * Create a ChangeEvent record
 */
async function createChangeEvent(data: {
  shop: string;
  entityType: "product" | "variant" | "theme" | "domain";
  entityId: string;
  eventType: "price_change" | "visibility_change" | "inventory_low" | "inventory_zero" | "theme_publish" | "domain_changed" | "domain_removed";
  resourceName: string;
  beforeValue: string | null;
  afterValue: string | null;
  webhookId: string;
  source?: "webhook" | "sync_job" | "manual";
  importance?: "high" | "medium" | "low";
  groupId?: string;
}): Promise<void> {
  try {
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
        importance: data.importance ?? "medium",
        groupId: data.groupId,
      },
    });
    console.log(`[StoreGuard] Created ${data.eventType} event for "${data.resourceName}"`);

    // Send instant alert if enabled (Pro feature)
    const shouldSendInstant = await hasInstantAlerts(data.shop);
    if (shouldSendInstant) {
      const alertEmail = await getShopAlertEmail(data.shop);
      if (alertEmail) {
        // Fire and forget - don't block on email sending
        sendInstantAlert(
          {
            eventType: data.eventType,
            resourceName: data.resourceName,
            beforeValue: data.beforeValue,
            afterValue: data.afterValue,
            importance: data.importance ?? "medium",
            detectedAt: event.detectedAt,
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

  // Compare each variant's price - only alert when price_before !== price_after
  for (const newVariant of product.variants) {
    const oldVariant = oldSnapshot.variants.find(v => v.id === String(newVariant.id));

    // Explicit rule: only fire when price actually changed
    if (oldVariant && oldVariant.price !== newVariant.price) {
      const variantLabel = formatVariantLabel(product.title, newVariant.title);
      const importance = calculatePriceImportance(oldVariant.price, newVariant.price);

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
  webhookId: string
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

  await createChangeEvent({
    shop,
    entityType: "variant",
    entityId: inventoryItemId,
    eventType: "inventory_zero",
    resourceName: formatVariantLabel(productTitle, variantTitle),
    beforeValue: String(previousQuantity),
    afterValue: "0",
    webhookId: `${webhookId}-inventory-zero-${inventoryItemId}`,
    importance: "high", // Out of stock is always high importance
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
  webhookId: string
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

  await createChangeEvent({
    shop,
    entityType: "variant",
    entityId: inventoryItemId,
    eventType: "inventory_low",
    resourceName: displayName,
    beforeValue: String(previousQuantity),
    afterValue: String(newQuantity),
    webhookId: `${webhookId}-inventory-low-${inventoryItemId}`,
    importance: "medium", // Low stock is medium importance (zero is high)
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

  await createChangeEvent({
    shop,
    entityType: "theme",
    entityId: String(theme.id),
    eventType: "theme_publish",
    resourceName: theme.name,
    beforeValue: null, // We don't know what theme was live before
    afterValue: "main",
    webhookId: `${webhookId}-theme`,
    importance: "high", // Theme publish is always important
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

// Domain payload from Shopify webhook
interface DomainPayload {
  id: number;
  host: string;
  ssl_enabled: boolean;
  localization?: {
    country: string | null;
    default_locale: string;
    alternate_locales: string[];
  };
}

/**
 * Record a domain change event (domains/create or domains/update)
 * Domain changes are HIGH importance — can break SEO, links, and customer access
 */
export async function recordDomainChange(
  shop: string,
  domain: DomainPayload,
  webhookId: string,
  action: "added" | "updated"
): Promise<boolean> {
  if (!await canTrackFeature(shop, "domains")) {
    console.log(`[StoreGuard] Domain tracking disabled for ${shop} (Free plan or disabled)`);
    return false;
  }

  const afterValue = action === "added"
    ? `Domain "${domain.host}" added`
    : `Domain "${domain.host}" updated`;

  await createChangeEvent({
    shop,
    entityType: "domain",
    entityId: String(domain.id),
    eventType: "domain_changed",
    resourceName: domain.host,
    beforeValue: null,
    afterValue,
    webhookId: `${webhookId}-domain`,
    importance: "high",
  });

  return true;
}

/**
 * Record a domain removal event (domains/destroy)
 * Domain removal is HIGH importance — breaks SEO, bookmarks, and customer access
 */
export async function recordDomainRemoval(
  shop: string,
  domain: DomainPayload,
  webhookId: string
): Promise<boolean> {
  if (!await canTrackFeature(shop, "domains")) {
    console.log(`[StoreGuard] Domain tracking disabled for ${shop} (Free plan or disabled)`);
    return false;
  }

  await createChangeEvent({
    shop,
    entityType: "domain",
    entityId: String(domain.id),
    eventType: "domain_removed",
    resourceName: domain.host,
    beforeValue: domain.host,
    afterValue: null,
    webhookId: `${webhookId}-domain`,
    importance: "high",
  });

  return true;
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
