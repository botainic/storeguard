import db from "../db.server";
import { apiVersion } from "../shopify.server";
import {
  getPendingJobs,
  claimJob,
  markJobCompleted,
  markJobFailed,
} from "./jobQueue.server";
import {
  processProductChanges,
  detectInventoryZero,
  detectLowStock,
  deleteProductSnapshot,
  recordThemePublish,
  recordCollectionCreated,
  recordCollectionUpdated,
  recordCollectionDeleted,
  recordDiscountCreated,
  recordDiscountUpdated,
  recordDiscountDeleted,
  recordAppPermissionsChanged,
  recordDomainChanged,
  recordDomainRemoved,
} from "./changeDetection.server";
import {
  aggregateInventoryLevels,
  type InventoryLevelNode,
} from "./changeDetection.utils";
import { normalizeTopic } from "./jobProcessor.utils";

// Full product payload from Shopify webhook
interface ProductPayload {
  id: number;
  title: string;
  body_html: string | null;
  vendor: string | null;
  product_type: string | null;
  handle: string;
  status: string; // active, draft, archived
  tags: string; // comma-separated
  template_suffix: string | null;
  published_scope: string;
  variants: Array<{
    id: number;
    title: string;
    price: string;
    compare_at_price: string | null;
    sku: string | null;
    inventory_quantity: number;
    weight: number | null;
    weight_unit: string | null;
  }>;
  options: Array<{
    id: number;
    name: string;
    values: string[];
  }>;
  images: Array<{
    id: number;
    src: string;
    alt: string | null;
    position: number;
  }>;
  image: {
    id: number;
    src: string;
    alt: string | null;
    position: number;
  } | null;
}

interface CollectionPayload {
  id: number;
  title: string;
  handle: string;
  body_html: string | null;
  published_scope: string;
  sort_order: string;
  image: {
    src: string;
    alt: string | null;
    position: number;
  } | null;
}

interface DiscountPayload {
  id: number;
  title: string;
  value: string;
  value_type: string; // "percentage" | "fixed_amount"
  code?: string;
  starts_at: string | null;
  ends_at: string | null;
}

interface DomainPayload {
  id: number;
  host: string;
  ssl_enabled?: boolean;
  localization?: { country: string | null; default_locale: string };
}

interface InventoryLevelPayload {
  inventory_item_id: number;
  location_id: number;
  available: number;
  updated_at: string;
}

interface ShopifyEvent {
  id: number;
  subject_id: number;
  created_at: string;
  subject_type: string;
  verb: string;
  message: string;
  author: string;
  description: string | null;
}

// Stored snapshot for diff comparison
interface ProductSnapshot {
  title: string;
  description: string | null;
  vendor: string | null;
  productType: string | null;
  status: string;
  tags: string[];
  imageCount: number;
  variants: Array<{
    title: string;
    price: string;
    compareAtPrice: string | null;
    sku: string | null;
    inventory: number;
    weight: number | null;
  }>;
  options: Array<{
    name: string;
    values: string[];
  }>;
}

// Human-readable change detection
interface DetectedChange {
  field: string;
  label: string;
  old?: string | number;
  new?: string | number;
}

/**
 * Create a snapshot of product state for comparison
 */
function createProductSnapshot(payload: ProductPayload): ProductSnapshot {
  return {
    title: payload.title,
    description: payload.body_html,
    vendor: payload.vendor,
    productType: payload.product_type,
    status: payload.status,
    tags: payload.tags ? payload.tags.split(", ").filter(Boolean) : [],
    imageCount: payload.images?.length || 0,
    variants: payload.variants.map((v) => ({
      title: v.title,
      price: v.price,
      compareAtPrice: v.compare_at_price,
      sku: v.sku,
      inventory: v.inventory_quantity,
      weight: v.weight ?? null,
    })),
    options: payload.options?.map((o) => ({
      name: o.name,
      values: o.values,
    })) || [],
  };
}

/**
 * Compare two snapshots and return human-readable changes
 */
function detectChanges(oldSnap: ProductSnapshot | null, newSnap: ProductSnapshot): DetectedChange[] {
  const changes: DetectedChange[] = [];

  if (!oldSnap) return changes; // New product, no comparison

  // Title
  if (oldSnap.title !== newSnap.title) {
    changes.push({ field: "title", label: "Title", old: oldSnap.title, new: newSnap.title });
  }

  // Description (truncate for display)
  const oldDesc = oldSnap.description?.slice(0, 50) || "(empty)";
  const newDesc = newSnap.description?.slice(0, 50) || "(empty)";
  if (oldSnap.description !== newSnap.description) {
    changes.push({ field: "description", label: "Description", old: oldDesc, new: newDesc });
  }

  // Vendor
  if (oldSnap.vendor !== newSnap.vendor) {
    changes.push({ field: "vendor", label: "Vendor", old: oldSnap.vendor || "(none)", new: newSnap.vendor || "(none)" });
  }

  // Product type
  if (oldSnap.productType !== newSnap.productType) {
    changes.push({ field: "productType", label: "Product type", old: oldSnap.productType || "(none)", new: newSnap.productType || "(none)" });
  }

  // Status
  if (oldSnap.status !== newSnap.status) {
    changes.push({ field: "status", label: "Status", old: oldSnap.status, new: newSnap.status });
  }

  // Tags
  const oldTags = oldSnap.tags.sort().join(", ") || "(none)";
  const newTags = newSnap.tags.sort().join(", ") || "(none)";
  if (oldTags !== newTags) {
    changes.push({ field: "tags", label: "Tags", old: oldTags, new: newTags });
  }

  // Images
  if (oldSnap.imageCount !== newSnap.imageCount) {
    changes.push({ field: "images", label: "Images", old: oldSnap.imageCount, new: newSnap.imageCount });
  }

  // Price (first variant)
  if (oldSnap.variants[0]?.price !== newSnap.variants[0]?.price) {
    changes.push({
      field: "price",
      label: "Price",
      old: `$${oldSnap.variants[0]?.price || "0"}`,
      new: `$${newSnap.variants[0]?.price || "0"}`,
    });
  }

  // Compare-at price (sale)
  if (oldSnap.variants[0]?.compareAtPrice !== newSnap.variants[0]?.compareAtPrice) {
    changes.push({
      field: "compareAtPrice",
      label: "Compare-at price",
      old: oldSnap.variants[0]?.compareAtPrice ? `$${oldSnap.variants[0].compareAtPrice}` : "(none)",
      new: newSnap.variants[0]?.compareAtPrice ? `$${newSnap.variants[0].compareAtPrice}` : "(none)",
    });
  }

  // Inventory (first variant) - normalize nulls to 0 for comparison
  const oldInventory = oldSnap.variants[0]?.inventory ?? 0;
  const newInventory = newSnap.variants[0]?.inventory ?? 0;
  if (oldInventory !== newInventory) {
    changes.push({
      field: "inventory",
      label: "Stock",
      old: oldInventory,
      new: newInventory,
    });
  }

  // SKU
  if (oldSnap.variants[0]?.sku !== newSnap.variants[0]?.sku) {
    changes.push({
      field: "sku",
      label: "SKU",
      old: oldSnap.variants[0]?.sku || "(none)",
      new: newSnap.variants[0]?.sku || "(none)",
    });
  }

  // Options (variant options like Size, Color)
  const oldOptions = oldSnap.options.map((o) => `${o.name}: ${o.values.join("/")}`).join("; ");
  const newOptions = newSnap.options.map((o) => `${o.name}: ${o.values.join("/")}`).join("; ");
  if (oldOptions !== newOptions) {
    changes.push({ field: "options", label: "Options", old: oldOptions || "(none)", new: newOptions || "(none)" });
  }

  return changes;
}

/**
 * Format changes into a human-readable summary
 */
function formatChangeSummary(changes: DetectedChange[]): string {
  if (changes.length === 0) return "";

  if (changes.length === 1) {
    const c = changes[0];
    return `${c.label}: ${c.old} → ${c.new}`;
  }

  if (changes.length <= 3) {
    return changes.map((c) => c.label).join(", ") + " changed";
  }

  return `${changes.length} fields changed`;
}

/**
 * Fetch author attribution from Shopify Events API
 */
async function fetchAuthor(
  shop: string,
  accessToken: string,
  resourceType: "Product" | "Collection",
  resourceId: number,
  verb: string
): Promise<string | null> {
  try {
    // NOTE: Shopify is deprecating REST /products and /variants endpoints for public apps.
    // We avoid any REST URL under `/products/*` and instead use the generic Events API.
    const endpoint =
      resourceType === "Product"
        ? `https://${shop}/admin/api/${apiVersion}/events.json?filter=Product&limit=20`
        : `https://${shop}/admin/api/${apiVersion}/events.json?filter=Collection&limit=20`;

    const response = await fetch(endpoint, {
      headers: {
        "X-Shopify-Access-Token": accessToken,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      console.log(`[StoreGuard] Events API returned ${response.status}`);
      return null;
    }

    const data = (await response.json()) as { events: ShopifyEvent[] };
    if (!data.events?.length) return null;

    // Find the matching event (works for Product and Collection)
    const matchingEvent = data.events.find((e) => e.subject_id === resourceId && e.verb === verb);
    return matchingEvent?.author || data.events[0]?.author || null;
  } catch (error) {
    console.error(`[StoreGuard] Failed to fetch events:`, error);
    return null;
  }
}

/**
 * Process a product update job
 */
async function processProductUpdate(
  shop: string,
  accessToken: string,
  payload: ProductPayload,
  webhookId: string | null
): Promise<void> {
  // === StoreGuard Change Detection ===
  // Detect price and visibility changes, create ChangeEvent records
  if (webhookId) {
    const { priceChanges, statusChange } = await processProductChanges(shop, payload, webhookId);
    if (priceChanges > 0 || statusChange) {
      console.log(`[StoreGuard] Detected ${priceChanges} price changes, status change: ${statusChange}`);
    }
  }

  // Create new snapshot
  const newSnapshot = createProductSnapshot(payload);

  // Get previous snapshot for diff comparison
  // Look for any event with a snapshot (baseline or previous update)
  let oldSnapshot: ProductSnapshot | null = null;
  const previousEvents = await db.changeEvent.findMany({
    where: {
      shop,
      entityId: String(payload.id),
      diff: { not: null },
    },
    orderBy: { detectedAt: "desc" },
    take: 5, // Check recent events for a valid snapshot
  });

  for (const prevEvent of previousEvents) {
    if (prevEvent.diff) {
      try {
        const prevDiff = JSON.parse(prevEvent.diff);
        if (prevDiff.snapshot) {
          oldSnapshot = prevDiff.snapshot;
          break; // Found a valid snapshot
        }
      } catch {
        // Invalid JSON, try next event
      }
    }
  }

  // Detect what changed
  const changes = detectChanges(oldSnapshot, newSnapshot);
  const changeSummary = formatChangeSummary(changes);

  // Fetch author
  const author = (await fetchAuthor(shop, accessToken, "Product", payload.id, "update")) || "System/App";

  // Build message with change summary
  let message = `${author} updated "${payload.title}"`;
  if (changeSummary) {
    message += ` - ${changeSummary}`;
  } else if (!oldSnapshot) {
    // No previous snapshot to compare against - this is first tracked change
    message += ` (first tracked change)`;
  }

  // Store snapshot + changes for future comparison and display
  const diff = JSON.stringify({
    snapshot: newSnapshot,
    changes: changes,
  });

  // Update product cache
  await db.productCache.upsert({
    where: { shop_id: { shop, id: String(payload.id) } },
    create: { id: String(payload.id), shop, title: payload.title },
    update: { title: payload.title },
  });

  // Create activity log entry
  await db.changeEvent.create({
    data: {
      shop,
      entityType: "product",
      entityId: String(payload.id),
      eventType: "product_updated",
      resourceName: payload.title,
      source: "webhook",
      importance: "low",
      topic: "products/update",
      author,
      diff,
      webhookId: webhookId ?? `activity-products-update-${payload.id}-${Date.now()}`,
    },
  });

  console.log(`[StoreGuard] Logged: ${message}`);
}

/**
 * Process a product create job
 */
async function processProductCreate(
  shop: string,
  accessToken: string,
  payload: ProductPayload,
  webhookId: string | null
): Promise<void> {
  const author = (await fetchAuthor(shop, accessToken, "Product", payload.id, "create")) || "System/App";

  // Create snapshot for future comparisons
  const snapshot = createProductSnapshot(payload);

  // Build descriptive message
  const price = payload.variants[0]?.price ? `$${payload.variants[0].price}` : "";
  const variantCount = payload.variants.length;
  const imageCount = payload.images?.length || 0;

  let details: string[] = [];
  if (price) details.push(price);
  if (variantCount > 1) details.push(`${variantCount} variants`);
  if (imageCount > 0) details.push(`${imageCount} image${imageCount > 1 ? "s" : ""}`);

  let message = `${author} created "${payload.title}"`;
  if (details.length > 0) {
    message += ` (${details.join(", ")})`;
  }

  const diff = JSON.stringify({
    snapshot: snapshot,
    changes: [], // No changes for new products
  });

  await db.productCache.upsert({
    where: { shop_id: { shop, id: String(payload.id) } },
    create: { id: String(payload.id), shop, title: payload.title },
    update: { title: payload.title },
  });

  await db.changeEvent.create({
    data: {
      shop,
      entityType: "product",
      entityId: String(payload.id),
      eventType: "product_created",
      resourceName: payload.title,
      source: "webhook",
      importance: "low",
      topic: "products/create",
      author,
      diff,
      webhookId: webhookId ?? `activity-products-create-${payload.id}-${Date.now()}`,
    },
  });

  console.log(`[StoreGuard] Logged: ${message}`);
}

/**
 * Process a product delete job
 */
async function processProductDelete(
  shop: string,
  payload: { id: number },
  webhookId: string | null
): Promise<void> {
  const productId = String(payload.id);
  let productTitle: string | null = null;

  // Try to get title from cache
  const cachedProduct = await db.productCache.findUnique({
    where: { shop_id: { shop, id: productId } },
  });

  if (cachedProduct) {
    productTitle = cachedProduct.title;
    await db.productCache.delete({
      where: { shop_id: { shop, id: productId } },
    });
  }

  // === StoreGuard: Clean up snapshot for deleted product ===
  await deleteProductSnapshot(shop, productId);

  // Fallback to previous ChangeEvent records
  if (!productTitle) {
    const previousEvent = await db.changeEvent.findFirst({
      where: { shop, entityId: productId },
      orderBy: { detectedAt: "desc" },
    });
    if (previousEvent) {
      productTitle = previousEvent.resourceName;
    }
  }

  const displayName = productTitle || `Product #${payload.id}`;
  const message = `Product deleted: "${displayName}"`;

  await db.changeEvent.create({
    data: {
      shop,
      entityType: "product",
      entityId: productId,
      eventType: "product_deleted",
      resourceName: displayName,
      source: "webhook",
      importance: "low",
      topic: "products/delete",
      author: "System/App",
      diff: null,
      webhookId: webhookId ?? `activity-products-delete-${payload.id}-${Date.now()}`,
    },
  });

  console.log(`[StoreGuard] Logged: ${message}`);
}

/**
 * Process a collection job
 */
async function processCollection(
  shop: string,
  accessToken: string,
  topic: string,
  payload: CollectionPayload | { id: number },
  webhookId: string | null
): Promise<void> {
  const verb = topic.includes("create") ? "create" : topic.includes("update") ? "update" : "delete";

  if (verb === "delete") {
    // For deletes, try to get title from previous events or ChangeEvents
    const collectionId = String((payload as { id: number }).id);
    let title: string | null = null;

    // Try ChangeEvent first for title lookup
    const previousChange = await db.changeEvent.findFirst({
      where: { shop, entityType: "collection", entityId: collectionId },
      orderBy: { detectedAt: "desc" },
    });
    if (previousChange) {
      title = previousChange.resourceName;
    }

    const displayName = title || `Collection #${collectionId}`;

    // === StoreGuard ChangeEvent ===
    if (webhookId) {
      await recordCollectionDeleted(shop, collectionId, displayName, webhookId);
    }

    console.log(`[StoreGuard] Collection deleted: "${displayName}"`);
    return;
  }

  const collection = payload as CollectionPayload;
  const author = (await fetchAuthor(shop, accessToken, "Collection", collection.id, verb)) || "System/App";

  // === StoreGuard ChangeEvent ===
  if (webhookId) {
    if (verb === "create") {
      await recordCollectionCreated(shop, String(collection.id), collection.title, webhookId);
    } else {
      await recordCollectionUpdated(shop, String(collection.id), collection.title, webhookId);
    }
  }

  console.log(`[StoreGuard] Collection ${verb}d: "${collection.title}"`);
}

/**
 * Process a discount job
 */
async function processDiscount(
  shop: string,
  topic: string,
  payload: DiscountPayload | { id: number },
  webhookId: string | null
): Promise<void> {
  const verb = topic.includes("create") ? "create" : topic.includes("update") ? "update" : "delete";

  if (verb === "delete") {
    const discountId = String((payload as { id: number }).id);

    // Try to find a title from previous ChangeEvents
    let title: string | null = null;
    const previousChange = await db.changeEvent.findFirst({
      where: { shop, entityType: "discount", entityId: discountId },
      orderBy: { detectedAt: "desc" },
    });
    if (previousChange) {
      title = previousChange.resourceName;
    }

    const displayName = title || `Discount #${discountId}`;

    if (webhookId) {
      await recordDiscountDeleted(shop, discountId, displayName, webhookId);
    }

    console.log(`[StoreGuard] Discount deleted: "${displayName}"`);
    return;
  }

  const discount = payload as DiscountPayload;
  const discountTitle = discount.title || discount.code || `Discount #${discount.id}`;
  const discountValue = discount.value_type === "percentage" ? discount.value : null;

  if (webhookId) {
    if (verb === "create") {
      await recordDiscountCreated(shop, String(discount.id), discountTitle, discountValue, webhookId);
    } else {
      await recordDiscountUpdated(shop, String(discount.id), discountTitle, discountValue, webhookId);
    }
  }

  console.log(`[StoreGuard] Discount ${verb}d: "${discountTitle}"`);
}

/**
 * Process a domain job
 */
async function processDomain(
  shop: string,
  topic: string,
  payload: DomainPayload | { id: number },
  webhookId: string | null
): Promise<void> {
  const isDestroy = topic.includes("destroy");

  if (isDestroy) {
    const domainId = String((payload as { id: number }).id);

    // Try to find a host from previous ChangeEvents
    let host: string | null = null;
    const previousChange = await db.changeEvent.findFirst({
      where: { shop, entityType: "domain", entityId: domainId },
      orderBy: { detectedAt: "desc" },
    });
    if (previousChange) {
      host = previousChange.resourceName;
    }

    const displayName = host || `Domain #${domainId}`;

    if (webhookId) {
      await recordDomainRemoved(shop, domainId, displayName, webhookId);
    }

    console.log(`[StoreGuard] Domain removed: "${displayName}"`);
    return;
  }

  const domain = payload as DomainPayload;
  const domainHost = domain.host || `Domain #${domain.id}`;

  if (webhookId) {
    await recordDomainChanged(shop, String(domain.id), domainHost, webhookId);
  }

  console.log(`[StoreGuard] Domain changed: "${domainHost}"`);
}

/** Shape of the inventoryLevels connection from the GraphQL response */
interface InventoryLevelsConnection {
  nodes: InventoryLevelNode[];
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
}

/**
 * Fetch total inventory across all locations for an inventory item.
 * Uses cursor-based pagination to handle merchants with >50 locations.
 * Returns { totalQuantity, locationName } where totalQuantity is the sum
 * of available quantities across all locations, and locationName is the
 * name of the location that triggered this webhook.
 */
async function fetchTotalInventory(
  shop: string,
  accessToken: string,
  inventoryItemId: number,
  triggerLocationId: number
): Promise<{ totalQuantity: number; locationName: string | null }> {
  const allNodes: InventoryLevelNode[] = [];
  let cursor: string | null = null;
  const MAX_PAGES = 20; // Safety limit to prevent infinite loops

  try {
    for (let page = 0; page < MAX_PAGES; page++) {
      const gql = await fetch(`https://${shop}/admin/api/${apiVersion}/graphql.json`, {
        method: "POST",
        headers: {
          "X-Shopify-Access-Token": accessToken,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          query: `#graphql
            query InventoryLevels($inventoryItemId: ID!, $cursor: String) {
              inventoryItem(id: $inventoryItemId) {
                inventoryLevels(first: 50, after: $cursor) {
                  nodes {
                    quantities(names: ["available"]) {
                      quantity
                    }
                    location {
                      id
                      name
                    }
                  }
                  pageInfo {
                    hasNextPage
                    endCursor
                  }
                }
              }
            }`,
          variables: {
            inventoryItemId: `gid://shopify/InventoryItem/${inventoryItemId}`,
            cursor,
          },
        }),
      });

      const data = (await gql.json()) as {
        data?: { inventoryItem?: { inventoryLevels?: InventoryLevelsConnection } };
      };
      const connection = data?.data?.inventoryItem?.inventoryLevels;
      if (!connection?.nodes || connection.nodes.length === 0) {
        break;
      }

      allNodes.push(...connection.nodes);

      if (!connection.pageInfo.hasNextPage || !connection.pageInfo.endCursor) {
        break;
      }
      cursor = connection.pageInfo.endCursor;
    }

    if (allNodes.length === 0) {
      return { totalQuantity: 0, locationName: null };
    }

    return aggregateInventoryLevels(allNodes, triggerLocationId);
  } catch (error) {
    console.error(`[StoreGuard] Failed to fetch total inventory:`, error);
    return { totalQuantity: 0, locationName: null };
  }
}

/**
 * Process an inventory update job
 *
 * Multi-location aware: aggregates inventory across all locations before alerting.
 * The webhook fires per-location, so we query Shopify for the total across all locations.
 */
async function processInventoryUpdate(
  shop: string,
  accessToken: string,
  payload: InventoryLevelPayload,
  webhookId: string | null
): Promise<void> {
  // Fetch product info from inventory item
  let productTitle = "Unknown Product";
  let variantTitle = "";
  let productId = "";
  let productType = "";

  let variantId = "";
  try {
    // GraphQL replacement for deprecated REST /products and /variants
    // Get variant + product info using the inventory item id.
    const gql = await fetch(`https://${shop}/admin/api/${apiVersion}/graphql.json`, {
      method: "POST",
      headers: {
        "X-Shopify-Access-Token": accessToken,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: `#graphql
          query VariantByInventoryItem($inventoryItemId: ID!) {
            inventoryItem(id: $inventoryItemId) {
              id
              variant {
                id
                title
                product {
                  id
                  title
                  productType
                }
              }
            }
          }`,
        variables: { inventoryItemId: `gid://shopify/InventoryItem/${payload.inventory_item_id}` },
      }),
    });

    const data = (await gql.json()) as any;
    const v = data?.data?.inventoryItem?.variant;
    if (v) {
      variantTitle = String(v.title || "");
      productTitle = String(v.product?.title || productTitle);
      productType = String(v.product?.productType || "");
      // Extract product ID
      const productGid: string | undefined = v.product?.id;
      const productMatch = typeof productGid === "string" ? productGid.match(/\/Product\/(\d+)$/) : null;
      productId = productMatch?.[1] ?? "";
      // Extract variant ID for ProductSnapshot lookup
      const variantGid: string | undefined = v.id;
      const variantMatch = typeof variantGid === "string" ? variantGid.match(/\/ProductVariant\/(\d+)$/) : null;
      variantId = variantMatch?.[1] ?? "";
    }
  } catch (fetchError) {
    console.error(`[StoreGuard] Failed to fetch product info:`, fetchError);
  }

  // Skip gift cards - they generate noise and aren't useful to track
  if (productTitle.toLowerCase().includes("gift card") || productType.toLowerCase() === "gift_card") {
    console.log(`[StoreGuard] Skipping gift card inventory update: ${productTitle}`);
    return;
  }

  // === Multi-location: Fetch total inventory across all locations ===
  const { totalQuantity, locationName } = await fetchTotalInventory(
    shop,
    accessToken,
    payload.inventory_item_id,
    payload.location_id
  );

  // Get previous TOTAL inventory for diff display AND for >0→0 detection
  // Strategy: Check ChangeEvent first (most recent), then fall back to ProductSnapshot
  let oldAvailable: number | null = null;
  try {
    // First, try ChangeEvent (recent inventory updates) — stores totalQuantity
    const previousEvent = await db.changeEvent.findFirst({
      where: {
        shop,
        entityId: String(payload.inventory_item_id),
        topic: "inventory/levels/update",
      },
      orderBy: { detectedAt: "desc" },
    });

    if (previousEvent?.diff) {
      const prevDiff = JSON.parse(previousEvent.diff);
      // Prefer totalQuantity (multi-location) over legacy available (single-location)
      oldAvailable = prevDiff.totalQuantity ?? prevDiff.available ?? null;
    }

    // If no ChangeEvent, fall back to ProductSnapshot
    if (oldAvailable === null && productId && variantId) {
      const matchingVariant = await db.variantSnapshot.findUnique({
        where: {
          productSnapshotId_shopifyVariantId: {
            productSnapshotId: productId,
            shopifyVariantId: variantId,
          },
        },
      });
      if (matchingVariant && matchingVariant.inventoryQuantity !== undefined) {
        oldAvailable = matchingVariant.inventoryQuantity;
        console.log(`[StoreGuard] Got previous inventory ${oldAvailable} from VariantSnapshot for ${productTitle}`);
      }
    }
  } catch (prevError) {
    console.error(`[StoreGuard] Failed to fetch previous inventory:`, prevError);
  }

  // Build location context for alerts
  const locationContext = locationName ? `Last change at ${locationName}` : null;

  // === StoreGuard: Detect inventory changes using TOTAL quantity ===
  if (productId && webhookId) {
    // Detect low stock (crossing below threshold) — uses total across all locations
    const lowStockDetected = await detectLowStock(
      shop,
      String(payload.inventory_item_id),
      productId,
      productTitle,
      variantTitle,
      totalQuantity,
      oldAvailable,
      webhookId,
      locationContext
    );

    // Detect inventory hitting zero (only if not already low stock alert)
    // Rule: Only triggers on >0 → 0 transition — uses total across all locations
    if (totalQuantity === 0 && !lowStockDetected) {
      await detectInventoryZero(
        shop,
        String(payload.inventory_item_id),
        productId,
        productTitle,
        variantTitle,
        totalQuantity,
        oldAvailable,
        webhookId,
        locationContext
      );
    }
  }

  // Update or create ProductSnapshot with TOTAL inventory (keeps snapshot current for future comparisons)
  if (productId && variantId) {
    try {
      // Ensure ProductSnapshot exists
      await db.productSnapshot.upsert({
        where: { shop_id: { shop, id: productId } },
        create: {
          id: productId,
          shop,
          title: productTitle,
          status: "active",
        },
        update: {},
      });

      // Upsert the specific variant — atomic, no read-modify-write
      await db.variantSnapshot.upsert({
        where: {
          productSnapshotId_shopifyVariantId: {
            productSnapshotId: productId,
            shopifyVariantId: variantId,
          },
        },
        create: {
          productSnapshotId: productId,
          shop,
          shopifyVariantId: variantId,
          title: variantTitle || "Default Title",
          price: "0.00",
          inventoryQuantity: totalQuantity,
        },
        update: {
          inventoryQuantity: totalQuantity,
        },
      });
      console.log(`[StoreGuard] Updated VariantSnapshot inventory for ${productTitle}: ${totalQuantity} (total across locations)`);
    } catch (snapshotError) {
      console.error(`[StoreGuard] Failed to update ProductSnapshot inventory:`, snapshotError);
    }
  }

  const displayName =
    variantTitle && variantTitle !== "Default Title"
      ? `${productTitle} - ${variantTitle}`
      : productTitle;

  // Create a clear message showing stock change (total across all locations)
  let message: string;
  if (oldAvailable !== null && oldAvailable !== totalQuantity) {
    const change = totalQuantity - oldAvailable;
    const arrow = change > 0 ? "↑" : "↓";
    message = `Stock ${arrow} "${displayName}" (${oldAvailable} → ${totalQuantity} total)`;
  } else {
    message = `Stock updated: "${displayName}" (${totalQuantity} units total)`;
  }
  if (locationName) {
    message += ` [${locationName}]`;
  }

  const diff = JSON.stringify({
    available: payload.available,
    totalQuantity,
    inventoryChange:
      oldAvailable !== null && oldAvailable !== totalQuantity
        ? { old: oldAvailable, new: totalQuantity }
        : null,
    locationId: payload.location_id,
    locationName,
  });

  await db.changeEvent.create({
    data: {
      shop,
      entityType: "variant",
      // Use inventory_item_id consistently for inventory events
      // This matches the lookup in getPreviousInventory above
      entityId: String(payload.inventory_item_id),
      eventType: "inventory_update",
      resourceName: displayName,
      source: "webhook",
      importance: "low",
      topic: "inventory/levels/update",
      author: "System/App",
      diff,
      webhookId: webhookId ?? `activity-inventory-update-${payload.inventory_item_id}-${Date.now()}`,
    },
  });

  console.log(`[StoreGuard] Logged: ${message}`);
}

/**
 * Process a theme publish job
 */
async function processThemePublish(
  shop: string,
  payload: { id: number; name: string; role: string },
  webhookId: string | null
): Promise<void> {
  if (!webhookId) {
    console.log(`[StoreGuard] No webhookId for theme publish, skipping`);
    return;
  }

  const recorded = await recordThemePublish(shop, payload, webhookId);
  if (recorded) {
    console.log(`[StoreGuard] Theme publish alert created for "${payload.name}"`);
  }
}

/**
 * Process an app scopes update job
 * Diffs previous vs current scopes and creates ChangeEvent for permission changes
 */
async function processScopesUpdate(
  shop: string,
  sessionId: string,
  payload: { current: string[] },
  webhookId: string | null
): Promise<void> {
  // Get the previous scopes from the session before updating
  const currentSession = await db.session.findUnique({
    where: { id: sessionId },
    select: { scope: true },
  });

  const previousScopes = currentSession?.scope
    ? currentSession.scope.split(",").map(s => s.trim()).filter(Boolean)
    : [];

  const currentScopes = payload.current;

  // Update the session with new scopes
  await db.session.update({
    where: { id: sessionId },
    data: { scope: currentScopes.toString() },
  });

  // === StoreGuard: Create ChangeEvent for permission diff ===
  if (webhookId) {
    await recordAppPermissionsChanged(shop, previousScopes, currentScopes, webhookId);
  }

  console.log(`[StoreGuard] Updated scopes for ${shop}`);
}

/**
 * Process a single job
 */
async function processJob(job: {
  id: string;
  shop: string;
  topic: string;
  resourceId: string;
  payload: string;
  webhookId: string | null;
}): Promise<void> {
  // Get session for access token
  const session = await db.session.findFirst({
    where: { shop: job.shop },
  });

  if (!session?.accessToken) {
    throw new Error(`No session found for ${job.shop}`);
  }

  const payload = JSON.parse(job.payload);

  // Normalize topic format: PRODUCTS_UPDATE -> products/update
  const normalizedTopic = normalizeTopic(job.topic);

  switch (normalizedTopic) {
    case "products/update":
      await processProductUpdate(job.shop, session.accessToken, payload, job.webhookId);
      break;
    case "products/create":
      await processProductCreate(job.shop, session.accessToken, payload, job.webhookId);
      break;
    case "products/delete":
      await processProductDelete(job.shop, payload, job.webhookId);
      break;
    case "collections/create":
    case "collections/update":
    case "collections/delete":
      await processCollection(job.shop, session.accessToken, normalizedTopic, payload, job.webhookId);
      break;
    case "inventory/levels/update":
      await processInventoryUpdate(job.shop, session.accessToken, payload, job.webhookId);
      break;
    case "themes/publish":
      await processThemePublish(job.shop, payload, job.webhookId);
      break;
    case "discounts/create":
    case "discounts/update":
    case "discounts/delete":
      await processDiscount(job.shop, normalizedTopic, payload, job.webhookId);
      break;
    case "domains/create":
    case "domains/update":
    case "domains/destroy":
      await processDomain(job.shop, normalizedTopic, payload, job.webhookId);
      break;
    case "app/scopes/update":
      await processScopesUpdate(job.shop, session.id, payload, job.webhookId);
      break;
    default:
      console.log(`[StoreGuard] Unknown topic: ${job.topic} (normalized: ${normalizedTopic})`);
  }
}

/**
 * Process all pending jobs (called from a route or cron)
 */
export async function processPendingJobs(): Promise<{
  processed: number;
  failed: number;
}> {
  const jobs = await getPendingJobs(20);
  let processed = 0;
  let failed = 0;

  for (const job of jobs) {
    try {
      // Atomically claim the job — skip if another worker already took it
      const claimed = await claimJob(job.id);
      if (!claimed) continue;

      await processJob(job);
      await markJobCompleted(job.id);
      processed++;
    } catch (error) {
      console.error(`[StoreGuard] Job ${job.id} failed:`, error);
      await markJobFailed(job.id, String(error));
      failed++;
    }
  }

  return { processed, failed };
}
