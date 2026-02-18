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
    // Check if we have ProductSnapshot records (from sync or webhooks)
    const snapshotCount = await db.productSnapshot.count({
      where: { shop },
    });

    if (snapshotCount > 0) {
      return { status: "completed", syncedProducts: snapshotCount, totalProducts: snapshotCount, error: null };
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
 * Sync all products from Shopify to our ProductCache and ProductSnapshot.
 * This ensures we have:
 * 1. Product names available for delete events (ProductCache)
 * 2. ProductSnapshot records for StoreGuard change detection
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
        console.error("[StoreGuard] Failed to fetch products from GraphQL");
        break;
      }

      // Upsert products into cache and ProductSnapshot for change detection
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

        // === StoreGuard: Create ProductSnapshot for change detection ===
        // This is what changeDetection.server.ts uses to compare before/after
        const productSnapshotVariants = product.variants.edges.map((v) => ({
          id: v.node.id.split("/").pop() || v.node.id,
          title: v.node.title,
          price: v.node.price,
          inventoryQuantity: v.node.inventoryQuantity ?? 0,
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

        // ProductSnapshot is the canonical baseline (created above via upsert).

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
  const expectedCount = Math.max(syncRecord?.syncedProducts ?? 0, cacheCount);

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
