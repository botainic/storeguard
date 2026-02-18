import db from "../db.server";

interface ProductVariant {
  id: string;
  title: string;
  price: string;
  compareAtPrice: string | null;
  sku: string | null;
  inventoryQuantity: number | null;
}

interface ProductOption {
  name: string;
  values: string[];
}

interface ProductNode {
  id: string;
  title: string;
  descriptionHtml: string | null;
  vendor: string | null;
  productType: string | null;
  status: string;
  tags: string[];
  images: { edges: Array<{ node: { id: string } }> };
  variants: {
    edges: Array<{ node: ProductVariant }>;
    pageInfo: {
      hasNextPage: boolean;
      endCursor: string | null;
    };
  };
  options: ProductOption[];
}

interface ProductEdge {
  node: ProductNode;
}

interface ThrottleStatus {
  maximumAvailable: number;
  currentlyAvailable: number;
  restoreRate: number;
}

interface ProductsResponse {
  data?: {
    products: {
      edges: ProductEdge[];
      pageInfo: {
        hasNextPage: boolean;
        endCursor: string | null;
      };
    };
  };
  extensions?: {
    cost: {
      requestedQueryCost: number;
      actualQueryCost: number;
      throttleStatus: ThrottleStatus;
    };
  };
  errors?: Array<{ message: string; extensions?: { code: string } }>;
}

interface VariantsResponse {
  data?: {
    product: {
      variants: {
        edges: Array<{ node: ProductVariant }>;
        pageInfo: {
          hasNextPage: boolean;
          endCursor: string | null;
        };
      };
    };
  };
  extensions?: {
    cost: {
      requestedQueryCost: number;
      actualQueryCost: number;
      throttleStatus: ThrottleStatus;
    };
  };
  errors?: Array<{ message: string; extensions?: { code: string } }>;
}

/** Batch size for product pagination (Shopify max is 250) */
export const PRODUCTS_PER_PAGE = 250;

/** Batch size for variant pagination within a product */
export const VARIANTS_PER_PAGE = 100;

/**
 * Minimum available query cost before we pause to let the bucket refill.
 * Shopify's default bucket is 1000 points with 50/sec restore rate.
 * A products query with 250 products costs ~500+ points.
 */
const THROTTLE_THRESHOLD = 200;

/**
 * Wait for Shopify's rate limit bucket to refill enough for the next query.
 * Returns immediately if sufficient budget is available.
 */
export async function waitForRateLimit(
  throttleStatus: ThrottleStatus | undefined,
  queryCost: number
): Promise<void> {
  if (!throttleStatus) return;

  const { currentlyAvailable, restoreRate } = throttleStatus;

  if (currentlyAvailable < Math.max(queryCost, THROTTLE_THRESHOLD)) {
    const pointsNeeded = queryCost - currentlyAvailable;
    const waitSeconds = Math.ceil(pointsNeeded / restoreRate) + 1;
    console.log(
      `[StoreGuard] Rate limit: ${currentlyAvailable} points available, need ~${queryCost}. Waiting ${waitSeconds}s...`
    );
    await new Promise((resolve) => setTimeout(resolve, waitSeconds * 1000));
  }
}

/**
 * Check if a GraphQL response contains a THROTTLED error and extract retry-after info.
 * Returns the number of ms to wait, or 0 if not throttled.
 */
export function getThrottleRetryMs(
  response: ProductsResponse | VariantsResponse
): number {
  if (!response.errors) return 0;

  const throttled = response.errors.some(
    (e) => e.extensions?.code === "THROTTLED"
  );
  if (!throttled) return 0;

  // Use cost info to calculate wait, or default to 2s
  const restoreRate = response.extensions?.cost?.throttleStatus?.restoreRate ?? 50;
  const needed = response.extensions?.cost?.requestedQueryCost ?? 100;
  const available = response.extensions?.cost?.throttleStatus?.currentlyAvailable ?? 0;
  const deficit = needed - available;

  if (deficit <= 0) return 2000;
  return Math.ceil((deficit / restoreRate) * 1000) + 1000;
}

// Snapshot format (matches jobProcessor.server.ts)
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
  }>;
  options: Array<{
    name: string;
    values: string[];
  }>;
}

/**
 * Create a snapshot from GraphQL product data for baseline comparison
 */
function createSnapshotFromGraphQL(product: ProductNode): ProductSnapshot {
  return {
    title: product.title,
    description: product.descriptionHtml,
    vendor: product.vendor,
    productType: product.productType,
    status: product.status.toLowerCase(),
    tags: product.tags || [],
    imageCount: product.images?.edges?.length || 0,
    variants: product.variants.edges.map((v) => ({
      title: v.node.title,
      price: v.node.price,
      compareAtPrice: v.node.compareAtPrice,
      sku: v.node.sku,
      inventory: v.node.inventoryQuantity ?? 0,
    })),
    options: product.options?.map((o) => ({
      name: o.name,
      values: o.values,
    })) || [],
  };
}

/**
 * Get sync status for a shop
 */
export async function getSyncStatus(shop: string): Promise<{
  status: "pending" | "syncing" | "completed" | "failed" | "not_started";
  syncedProducts: number;
  totalProducts: number | null;
  error: string | null;
}> {
  const syncRecord = await db.shopSync.findUnique({
    where: { shop },
  });

  if (!syncRecord) {
    // Legacy installs may have ProductCache entries from webhooks without ever creating baseline snapshots.
    // Baselines are what make the *first* product update show a diff.
    const baselineCount = await db.changeEvent.count({
      where: { shop, eventType: "product_snapshot" },
    });

    if (baselineCount > 0) {
      return { status: "completed", syncedProducts: baselineCount, totalProducts: baselineCount, error: null };
    }

    return { status: "not_started", syncedProducts: 0, totalProducts: null, error: null };
  }

  return {
    status: syncRecord.status as "pending" | "syncing" | "completed" | "failed",
    syncedProducts: syncRecord.syncedProducts,
    totalProducts: syncRecord.totalProducts,
    error: syncRecord.error ?? null,
  };
}

/**
 * Fetch all variants for a product using cursor-based pagination.
 * Most products have <10 variants, but Shopify supports up to 2000.
 * Only makes additional requests if the first page indicates more variants exist.
 */
async function fetchAllVariants(
  admin: {
    graphql: (
      query: string,
      options?: { variables?: Record<string, unknown> }
    ) => Promise<Response>;
  },
  product: ProductNode
): Promise<ProductVariant[]> {
  // Collect variants from the initial query
  const allVariants = product.variants.edges.map((e) => e.node);

  // If no more pages, we're done (most products)
  if (!product.variants.pageInfo.hasNextPage) {
    return allVariants;
  }

  // Paginate remaining variants
  let variantCursor = product.variants.pageInfo.endCursor;
  let hasMore = true;

  while (hasMore) {
    const response = await admin.graphql(
      `#graphql
        query GetProductVariants($productId: ID!, $cursor: String) {
          product(id: $productId) {
            variants(first: ${VARIANTS_PER_PAGE}, after: $cursor) {
              edges {
                node {
                  id
                  title
                  price
                  compareAtPrice
                  sku
                  inventoryQuantity
                }
              }
              pageInfo {
                hasNextPage
                endCursor
              }
            }
          }
        }
      `,
      { variables: { productId: product.id, cursor: variantCursor } }
    );

    const data: VariantsResponse = await response.json();

    // Handle throttling on variant fetches
    const retryMs = getThrottleRetryMs(data);
    if (retryMs > 0) {
      console.log(`[StoreGuard] Throttled on variant fetch, waiting ${retryMs}ms`);
      await new Promise((resolve) => setTimeout(resolve, retryMs));
      continue; // Retry the same cursor
    }

    const variantPage = data.data?.product?.variants;
    if (!variantPage) break;

    for (const edge of variantPage.edges) {
      allVariants.push(edge.node);
    }

    // Proactive rate limit wait
    await waitForRateLimit(
      data.extensions?.cost?.throttleStatus,
      data.extensions?.cost?.actualQueryCost ?? 10
    );

    hasMore = variantPage.pageInfo.hasNextPage;
    variantCursor = variantPage.pageInfo.endCursor;
  }

  return allVariants;
}

/**
 * Sync all products from Shopify to our ProductCache and create baseline snapshots.
 * This ensures we have:
 * 1. Product names available for delete events
 * 2. Baseline snapshots so the first update shows what changed
 * 3. ProductSnapshot records for StoreGuard change detection
 *
 * Uses cursor-based pagination to handle stores with 100K+ products.
 * Includes Shopify GraphQL rate limit awareness to avoid throttling.
 */
export async function syncProducts(
  shop: string,
  admin: {
    graphql: (
      query: string,
      options?: { variables?: Record<string, unknown> }
    ) => Promise<Response>;
  },
  opts?: { force?: boolean }
): Promise<{ synced: number; error?: string }> {
  let synced = 0;
  let cursor: string | null = null;
  let hasNextPage = true;
  const force = !!opts?.force;

  // Initialize sync status
  await db.shopSync.upsert({
    where: { shop },
    create: { shop, status: "syncing", startedAt: new Date() },
    update: { status: "syncing", startedAt: new Date(), error: null },
  });

  try {
    while (hasNextPage) {
      const response = await admin.graphql(
        `#graphql
          query GetProducts($cursor: String) {
            products(first: ${PRODUCTS_PER_PAGE}, after: $cursor) {
              edges {
                node {
                  id
                  title
                  descriptionHtml
                  vendor
                  productType
                  status
                  tags
                  images(first: 10) {
                    edges {
                      node {
                        id
                      }
                    }
                  }
                  variants(first: ${VARIANTS_PER_PAGE}) {
                    edges {
                      node {
                        id
                        title
                        price
                        compareAtPrice
                        sku
                        inventoryQuantity
                      }
                    }
                    pageInfo {
                      hasNextPage
                      endCursor
                    }
                  }
                  options {
                    name
                    values
                  }
                }
              }
              pageInfo {
                hasNextPage
                endCursor
              }
            }
          }
        `,
        {
          variables: { cursor },
        }
      );

      const data: ProductsResponse = await response.json();

      // Handle THROTTLED errors — wait and retry the same cursor
      const retryMs = getThrottleRetryMs(data);
      if (retryMs > 0) {
        console.log(`[StoreGuard] Throttled by Shopify, waiting ${retryMs}ms before retry...`);
        await new Promise((resolve) => setTimeout(resolve, retryMs));
        continue; // Retry with the same cursor
      }

      const products = data.data?.products;

      if (!products) {
        console.error("[StoreGuard] Failed to fetch products from GraphQL", data.errors);
        break;
      }

      // Proactive rate limit: wait if we're running low on points
      await waitForRateLimit(
        data.extensions?.cost?.throttleStatus,
        data.extensions?.cost?.actualQueryCost ?? 50
      );

      // Upsert products into cache and create baseline ChangeEvent entries
      for (const edge of products.edges) {
        const product = edge.node;
        // Extract numeric ID from GID (gid://shopify/Product/123)
        const numericId = product.id.split("/").pop() || product.id;

        // Fetch all variants (handles products with >100 variants via pagination)
        const allVariants = await fetchAllVariants(admin, product);

        // Upsert into cache for delete name resolution
        await db.productCache.upsert({
          where: {
            shop_id: {
              shop,
              id: numericId,
            },
          },
          create: {
            id: numericId,
            shop,
            title: product.title,
          },
          update: {
            title: product.title,
          },
        });

        // === StoreGuard: Create ProductSnapshot for change detection ===
        // This is what changeDetection.server.ts uses to compare before/after
        const productSnapshotVariants = allVariants.map((v) => ({
          id: v.id.split("/").pop() || v.id,
          title: v.title,
          price: v.price,
          inventoryQuantity: v.inventoryQuantity ?? 0,
        }));

        await db.productSnapshot.upsert({
          where: { shop_id: { shop, id: numericId } },
          create: {
            id: numericId,
            shop,
            title: product.title,
            status: product.status.toLowerCase(),
            variants: JSON.stringify(productSnapshotVariants),
          },
          update: {
            title: product.title,
            status: product.status.toLowerCase(),
            variants: JSON.stringify(productSnapshotVariants),
          },
        });

        // Build a synthetic ProductNode with all variants for snapshot creation
        const fullProduct: ProductNode = {
          ...product,
          variants: {
            edges: allVariants.map((v) => ({ node: v })),
            pageInfo: { hasNextPage: false, endCursor: null },
          },
        };

        // Ensure we have a baseline snapshot for this product.
        // IMPORTANT: ProductCache can exist from webhooks, but that doesn't mean a baseline snapshot exists.
        // Only `product_snapshot` events count as baselines.
        const existingBaseline = await db.changeEvent.findFirst({
          where: { shop, entityId: numericId, eventType: "product_snapshot" },
        });

        if (!existingBaseline || force) {
          // Create baseline snapshot so future updates can show diffs
          const snapshot = createSnapshotFromGraphQL(fullProduct);
          const diff = JSON.stringify({
            snapshot: snapshot,
            changes: [], // No changes for baseline
          });

          // Don't spam multiple baselines unless explicitly forced; even on force, keep it idempotent.
          if (!existingBaseline) {
            await db.changeEvent.create({
              data: {
                shop,
                entityType: "product",
                entityId: numericId,
                eventType: "product_snapshot",
                resourceName: product.title,
                source: "sync_job",
                importance: "low",
                topic: "products/snapshot",
                author: "StoreGuard",
                diff,
                webhookId: `baseline-${numericId}-${Date.now()}`,
              },
            });
          } else if (force) {
            await db.changeEvent.create({
              data: {
                shop,
                entityType: "product",
                entityId: numericId,
                eventType: "product_snapshot",
                resourceName: product.title,
                source: "sync_job",
                importance: "low",
                topic: "products/snapshot",
                author: "StoreGuard",
                diff,
                webhookId: `baseline-${numericId}-${Date.now()}`,
              },
            });
          }
        }

        synced++;

        // Persist progress frequently so the UI doesn't appear "stuck".
        if (synced % 50 === 0) {
          await db.shopSync.update({
            where: { shop },
            data: { syncedProducts: synced },
          });
        }
      }

      hasNextPage = products.pageInfo.hasNextPage;
      cursor = products.pageInfo.endCursor;

      // Update progress in database
      await db.shopSync.update({
        where: { shop },
        data: { syncedProducts: synced },
      });

      // Log progress for large catalogs
      if (synced % 500 === 0 && synced > 0) {
        console.log(`[StoreGuard] Sync progress: ${synced} products...`);
      }
    }

    // Mark sync as completed
    await db.shopSync.update({
      where: { shop },
      data: {
        status: "completed",
        syncedProducts: synced,
        completedAt: new Date(),
      },
    });

    console.log(`[StoreGuard] Synced ${synced} products with baseline snapshots for ${shop}`);
    return { synced };
  } catch (error) {
    console.error("[StoreGuard] Product sync failed:", error);

    // Mark sync as failed
    await db.shopSync.update({
      where: { shop },
      data: {
        status: "failed",
        error: String(error),
      },
    });

    return { synced, error: String(error) };
  }
}

/**
 * Check if we need to sync products (no snapshots exist for this shop)
 */
export async function needsProductSync(shop: string): Promise<boolean> {
  const syncRecord = await db.shopSync.findUnique({ where: { shop } });
  const snapshotCount = await db.productSnapshot.count({ where: { shop } });
  const cacheCount = await db.productCache.count({ where: { shop } });
  const baselineCount = await db.changeEvent.count({ where: { shop, eventType: "product_snapshot" } });
  const expectedCount = Math.max(syncRecord?.syncedProducts ?? 0, cacheCount, baselineCount);

  if (syncRecord) {
    if (syncRecord.status === "completed") {
      if (expectedCount > 0 && snapshotCount < expectedCount) {
        console.log(
          `[StoreGuard] Sync completed but ProductSnapshots incomplete (${snapshotCount}/${expectedCount}) - triggering resync for ${shop}`
        );
        return true;
      }
      if (snapshotCount === 0) {
        console.log(`[StoreGuard] Sync completed but no ProductSnapshots - triggering resync for ${shop}`);
        return true;
      }
      return false;
    }
    if (syncRecord.status === "syncing") return false; // already running
    // failed / pending => allow retry
    return true;
  }

  if (snapshotCount === 0) return true;
  if (expectedCount > 0 && snapshotCount < expectedCount) return true;
  return false;
}
