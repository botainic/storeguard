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
  type OrderLineItem,
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
            pageInfo {
              hasNextPage
              endCursor
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

const ORDER_LINE_ITEMS_QUERY = `#graphql
  query GetOrderLineItems($orderId: ID!, $cursor: String) {
    order(id: $orderId) {
      lineItems(first: 50, after: $cursor) {
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
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  }
`;

// Max pages to fetch to prevent runaway pagination
const MAX_PAGES = 20; // 20 pages * 50 orders = 1000 orders max
const MAX_LINE_ITEM_PAGES = 10; // 10 pages * 50 items = 500 line items per order

// In-memory cache (lives for the lifetime of a single request/job batch)
// Key: `${shop}:${periodDays}`, Value: velocity map
const velocityCache = new Map<string, { data: Map<string, ProductVelocity>; expiresAt: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const CACHE_MAX_ENTRIES = 50; // Prevent unbounded memory growth

/**
 * Extract numeric ID from Shopify GID.
 * "gid://shopify/Product/12345" -> "12345"
 */
export function extractId(gid: string | null | undefined): string {
  if (!gid) return "";
  const match = gid.match(/\/(\d+)$/);
  return match?.[1] ?? "";
}

export interface LineItemNode {
  product: { id: string } | null;
  variant: { id: string } | null;
  quantity: number;
  originalUnitPriceSet: {
    shopMoney: { amount: string };
  } | null;
}

interface LineItemsConnection {
  edges: Array<{ node: LineItemNode }>;
  pageInfo: {
    hasNextPage: boolean;
    endCursor: string | null;
  };
}

export function parseLineItemNodes(nodes: LineItemNode[]): OrderLineItem[] {
  return nodes
    .map((node) => ({
      productId: extractId(node.product?.id),
      variantId: extractId(node.variant?.id),
      quantity: node.quantity,
      price: parseFloat(
        node.originalUnitPriceSet?.shopMoney?.amount ?? "0"
      ),
    }))
    .filter((li) => li.productId !== "");
}

/**
 * Fetch remaining line items for an order using cursor-based pagination.
 * Called when the initial lineItems(first: 50) response indicates more pages.
 */
async function fetchRemainingLineItems(
  shop: string,
  accessToken: string,
  orderId: string,
  initialCursor: string
): Promise<LineItemNode[]> {
  const additionalNodes: LineItemNode[] = [];
  let cursor: string | null = initialCursor;
  let page = 0;

  while (page < MAX_LINE_ITEM_PAGES) {
    const response = await fetch(
      `https://${shop}/admin/api/${apiVersion}/graphql.json`,
      {
        method: "POST",
        headers: {
          "X-Shopify-Access-Token": accessToken,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          query: ORDER_LINE_ITEMS_QUERY,
          variables: { orderId, cursor },
        }),
      }
    );

    if (!response.ok) {
      console.error(
        `[StoreGuard] Order line items API returned ${response.status} for ${shop} order ${orderId}`
      );
      break;
    }

    const data = (await response.json()) as {
      data?: {
        order?: {
          lineItems: LineItemsConnection;
        };
      };
      errors?: Array<{ message: string }>;
    };

    if (data.errors?.length) {
      console.error(
        `[StoreGuard] Order line items GraphQL errors:`,
        data.errors.map((e) => e.message).join(", ")
      );
      break;
    }

    const lineItems = data.data?.order?.lineItems;
    if (!lineItems) break;

    for (const edge of lineItems.edges) {
      additionalNodes.push(edge.node);
    }

    if (!lineItems.pageInfo.hasNextPage || !lineItems.pageInfo.endCursor) {
      break;
    }

    cursor = lineItems.pageInfo.endCursor;
    page++;
  }

  if (page >= MAX_LINE_ITEM_PAGES) {
    console.warn(
      `[StoreGuard] Hit max line item page limit (${MAX_LINE_ITEM_PAGES}) for ${shop} order ${orderId}, some line items may be missing`
    );
  }

  return additionalNodes;
}

/**
 * Fetch orders from Shopify using cursor-based pagination with date-range filtering.
 * Line items within each order are also paginated if they exceed 50 items.
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
              lineItems: LineItemsConnection;
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
      const allNodes: LineItemNode[] = edge.node.lineItems.edges.map((e) => e.node);

      // Paginate remaining line items if the first page was truncated
      const liPageInfo = edge.node.lineItems.pageInfo;
      if (liPageInfo.hasNextPage && liPageInfo.endCursor) {
        console.warn(
          `[StoreGuard] Order ${edge.node.id} has more than 50 line items for ${shop}, fetching additional pages`
        );

        const remaining = await fetchRemainingLineItems(
          shop,
          accessToken,
          edge.node.id,
          liPageInfo.endCursor
        );
        allNodes.push(...remaining);
      }

      const lineItems = parseLineItemNodes(allNodes);

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

    // Evict oldest entries if cache is full
    if (velocityCache.size >= CACHE_MAX_ENTRIES) {
      const firstKey = velocityCache.keys().next().value;
      if (firstKey) velocityCache.delete(firstKey);
    }

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
