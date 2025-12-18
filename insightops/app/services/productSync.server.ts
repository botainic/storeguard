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
  variants: { edges: Array<{ node: ProductVariant }> };
  options: ProductOption[];
}

interface ProductEdge {
  node: ProductNode;
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
    const baselineCount = await db.eventLog.count({
      where: { shop, topic: "products/snapshot" },
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
 * Sync all products from Shopify to our ProductCache and create baseline snapshots.
 * This ensures we have:
 * 1. Product names available for delete events
 * 2. Baseline snapshots so the first update shows what changed
 * Uses cursor-based pagination to handle stores with many products.
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
            products(first: 50, after: $cursor) {
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
                  variants(first: 10) {
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
      const products = data.data?.products;

      if (!products) {
        console.error("[InsightOps] Failed to fetch products from GraphQL");
        break;
      }

      // Upsert products into cache and create baseline EventLog entries
      for (const edge of products.edges) {
        const product = edge.node;
        // Extract numeric ID from GID (gid://shopify/Product/123)
        const numericId = product.id.split("/").pop() || product.id;

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

        // Ensure we have a baseline snapshot for this product.
        // IMPORTANT: ProductCache can exist from webhooks, but that doesn't mean a baseline snapshot exists.
        // Only `products/snapshot` events count as baselines.
        const existingBaseline = await db.eventLog.findFirst({
          where: { shop, shopifyId: numericId, topic: "products/snapshot" },
        });

        if (!existingBaseline || force) {
          // Create baseline snapshot so future updates can show diffs
          const snapshot = createSnapshotFromGraphQL(product);
          const diff = JSON.stringify({
            snapshot: snapshot,
            changes: [], // No changes for baseline
          });

          // Don't spam multiple baselines unless explicitly forced; even on force, keep it idempotent by upserting a single baseline.
          // Prisma doesn't support "upsert" without a unique key, so we just create a new baseline when forcing.
          // (For normal runs, we only create if missing.)
          if (!existingBaseline) {
            await db.eventLog.create({
              data: {
                shop,
                shopifyId: numericId,
                topic: "products/snapshot",
                author: "InsightOps",
                message: `Baseline snapshot for "${product.title}"`,
                diff,
                webhookId: null,
              },
            });
          } else if (force) {
            await db.eventLog.create({
              data: {
                shop,
                shopifyId: numericId,
                topic: "products/snapshot",
                author: "InsightOps",
                message: `Refreshed baseline snapshot for "${product.title}"`,
                diff,
                webhookId: null,
              },
            });
          }
        }

        synced++;

        // Persist progress frequently so the UI doesn't appear "stuck".
        if (synced % 10 === 0) {
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
      if (synced % 100 === 0 && synced > 0) {
        console.log(`[InsightOps] Sync progress: ${synced} products...`);
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

    console.log(`[InsightOps] Synced ${synced} products with baseline snapshots for ${shop}`);
    return { synced };
  } catch (error) {
    console.error("[InsightOps] Product sync failed:", error);

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
 * Check if we need to sync products (no cache exists for this shop)
 */
export async function needsProductSync(shop: string): Promise<boolean> {
  // Prefer explicit sync state when available.
  const syncRecord = await db.shopSync.findUnique({ where: { shop } });
  if (syncRecord) {
    if (syncRecord.status === "completed") return false;
    if (syncRecord.status === "syncing") return false; // already running
    // failed / pending => allow retry
    return true;
  }

  // No ShopSync record: determine whether baseline snapshots exist.
  const baselineCount = await db.eventLog.count({
    where: { shop, topic: "products/snapshot" },
  });
  return baselineCount === 0;
}
