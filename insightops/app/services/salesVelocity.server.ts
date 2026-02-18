/**
 * Sales Velocity Service for StoreGuard
 *
 * Fetches order data from Shopify using GraphQL with cursor-based pagination
 * and date-range filtering. Calculates per-product sales velocity for
 * context-rich alerts (e.g., "you've been selling 8/day").
 *
 * Key design decisions:
 * - Uses date-range queries (last 30 days) instead of fetching all orders
 * - Cursor-based pagination handles stores with any order volume
 * - Aggregates on our side since ShopifyQL is not available for public apps
 * - Caches results to avoid repeated API calls during a single webhook batch
 */

import { apiVersion } from "../shopify.server";
import db from "../db.server";
import {
  calculateProductVelocity,
  type OrderData,
  type ProductVelocity,
} from "./salesVelocity.utils";

const ORDERS_QUERY = `#graphql
  query GetOrders($query: String!, $cursor: String) {
    orders(first: 50, after: $cursor, query: $query) {
      edges {
        node {
          id
          createdAt
          lineItems(first: 50) {
            edges {
              node {
                product {
                  id
                }
                variant {
                  id
                }
                quantity
                originalUnitPriceSet {
                  shopMoney {
                    amount
                  }
                }
              }
            }
          }
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

// Max pages to fetch to prevent runaway pagination
const MAX_PAGES = 20; // 20 pages * 50 orders = 1000 orders max

// In-memory cache (lives for the lifetime of a single request/job batch)
// Key: `${shop}:${periodDays}`, Value: velocity map
const velocityCache = new Map<string, { data: Map<string, ProductVelocity>; expiresAt: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Extract numeric ID from Shopify GID.
 * "gid://shopify/Product/12345" -> "12345"
 */
function extractId(gid: string | null | undefined): string {
  if (!gid) return "";
  const match = gid.match(/\/(\d+)$/);
  return match?.[1] ?? "";
}

/**
 * Fetch orders from Shopify using cursor-based pagination with date-range filtering.
 * Returns normalized OrderData array.
 */
async function fetchOrders(
  shop: string,
  accessToken: string,
  periodDays: number
): Promise<OrderData[]> {
  const sinceDate = new Date(Date.now() - periodDays * 24 * 60 * 60 * 1000);
  const query = `created_at:>='${sinceDate.toISOString()}'`;

  const orders: OrderData[] = [];
  let cursor: string | null = null;
  let page = 0;

  while (page < MAX_PAGES) {
    const response = await fetch(
      `https://${shop}/admin/api/${apiVersion}/graphql.json`,
      {
        method: "POST",
        headers: {
          "X-Shopify-Access-Token": accessToken,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          query: ORDERS_QUERY,
          variables: { query, cursor },
        }),
      }
    );

    if (!response.ok) {
      console.error(
        `[StoreGuard] Orders API returned ${response.status} for ${shop}`
      );
      break;
    }

    const data = (await response.json()) as {
      data?: {
        orders?: {
          edges: Array<{
            node: {
              id: string;
              createdAt: string;
              lineItems: {
                edges: Array<{
                  node: {
                    product: { id: string } | null;
                    variant: { id: string } | null;
                    quantity: number;
                    originalUnitPriceSet: {
                      shopMoney: { amount: string };
                    } | null;
                  };
                }>;
              };
            };
          }>;
          pageInfo: {
            hasNextPage: boolean;
            endCursor: string | null;
          };
        };
      };
      errors?: Array<{ message: string }>;
    };

    if (data.errors?.length) {
      console.error(
        `[StoreGuard] Orders GraphQL errors:`,
        data.errors.map((e) => e.message).join(", ")
      );
      break;
    }

    const edges = data.data?.orders?.edges ?? [];

    for (const edge of edges) {
      const lineItems = edge.node.lineItems.edges
        .map((li) => ({
          productId: extractId(li.node.product?.id),
          variantId: extractId(li.node.variant?.id),
          quantity: li.node.quantity,
          price: parseFloat(
            li.node.originalUnitPriceSet?.shopMoney?.amount ?? "0"
          ),
        }))
        .filter((li) => li.productId !== "");

      if (lineItems.length > 0) {
        orders.push({
          id: extractId(edge.node.id),
          createdAt: edge.node.createdAt,
          lineItems,
        });
      }
    }

    const pageInfo = data.data?.orders?.pageInfo;
    if (!pageInfo?.hasNextPage || !pageInfo.endCursor) {
      break;
    }

    cursor = pageInfo.endCursor;
    page++;
  }

  if (page >= MAX_PAGES) {
    console.log(
      `[StoreGuard] Hit max page limit (${MAX_PAGES}) for ${shop}, processed ${orders.length} orders`
    );
  }

  return orders;
}

/**
 * Get sales velocity for all products in a shop.
 * Uses cursor-based pagination to handle any order volume.
 * Results are cached for 5 minutes to avoid redundant API calls.
 *
 * @param shop - Shop domain
 * @param periodDays - Number of days to look back (default: 30)
 */
export async function getShopSalesVelocity(
  shop: string,
  periodDays: number = 30
): Promise<Map<string, ProductVelocity>> {
  // Check cache
  const cacheKey = `${shop}:${periodDays}`;
  const cached = velocityCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data;
  }

  // Get access token from session
  const session = await db.session.findFirst({
    where: { shop },
    select: { accessToken: true },
  });

  if (!session?.accessToken) {
    console.log(
      `[StoreGuard] No session for ${shop}, cannot fetch sales velocity`
    );
    return new Map();
  }

  try {
    const orders = await fetchOrders(shop, session.accessToken, periodDays);
    const velocityMap = calculateProductVelocity(orders, periodDays);

    // Cache the result
    velocityCache.set(cacheKey, {
      data: velocityMap,
      expiresAt: Date.now() + CACHE_TTL_MS,
    });

    console.log(
      `[StoreGuard] Calculated sales velocity for ${shop}: ${orders.length} orders, ${velocityMap.size} products`
    );

    return velocityMap;
  } catch (error) {
    console.error(
      `[StoreGuard] Failed to fetch sales velocity for ${shop}:`,
      error
    );
    return new Map();
  }
}

/**
 * Get sales velocity for a single product.
 * Fetches shop-wide velocity (cached) and returns the product's data.
 */
export async function getProductSalesVelocity(
  shop: string,
  productId: string,
  periodDays: number = 30
): Promise<ProductVelocity | null> {
  const velocityMap = await getShopSalesVelocity(shop, periodDays);
  return velocityMap.get(productId) ?? null;
}

/**
 * Clear the velocity cache for a shop.
 * Call this when order data may have changed.
 */
export function clearVelocityCache(shop?: string): void {
  if (shop) {
    for (const key of velocityCache.keys()) {
      if (key.startsWith(`${shop}:`)) {
        velocityCache.delete(key);
      }
    }
  } else {
    velocityCache.clear();
  }
}
