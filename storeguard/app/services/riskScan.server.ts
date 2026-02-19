import db from "../db.server";

/**
 * Risk Scan result structure.
 * Cached in Shop.riskScanResult after first scan.
 */
export interface RiskScanResult {
  // Immediate risks
  zeroStockProducts: { id: string; title: string; variantCount: number }[];
  lowStockVariants: {
    id: string;
    productTitle: string;
    variantTitle: string;
    quantity: number;
  }[];
  highDiscounts: { id: string; title: string; value: string; type: string }[];

  // Recent activity
  recentlyModifiedProducts: number;
  recentlyModifiedCollections: number;
  themeLastPublished: { name: string; daysAgo: number } | null;

  // Totals
  totalProducts: number;
  totalVariants: number;
  totalDiscounts: number;
  totalCollections: number;

  // Scan metadata
  scannedAt: string;
}

/**
 * Progress updates emitted during scan steps.
 */
export interface ScanProgress {
  productsScanned: number;
  variantsAnalyzed: number;
  inventoryChecked: number;
  discountsReviewed: number;
  themeChecked: boolean;
}

interface DiscountNode {
  id: string;
  title: string;
  discount:
    | {
        __typename: "DiscountCodeBasic";
        customerGets?: {
          value?: { percentage?: number; amount?: { amount?: string } };
        };
      }
    | {
        __typename: "DiscountCodeBxgy";
      }
    | {
        __typename: "DiscountCodeFreeShipping";
      }
    | {
        __typename: "DiscountAutomaticBasic";
        customerGets?: {
          value?: { percentage?: number; amount?: { amount?: string } };
        };
      }
    | {
        __typename: "DiscountAutomaticBxgy";
      }
    | {
        __typename: "DiscountAutomaticFreeShipping";
      }
    | Record<string, unknown>;
  status: string;
}

interface DiscountsResponse {
  data?: {
    discountNodes: {
      edges: Array<{ node: DiscountNode }>;
    };
  };
  errors?: Array<{ message: string }>;
}

interface CollectionsResponse {
  data?: {
    collections: {
      edges: Array<{
        node: {
          id: string;
          title: string;
          updatedAt: string;
        };
      }>;
    };
  };
  errors?: Array<{ message: string }>;
}

interface ThemesResponse {
  data?: {
    themes: {
      edges: Array<{
        node: {
          id: string;
          name: string;
          role: string;
          updatedAt: string;
        };
      }>;
    };
  };
  errors?: Array<{ message: string }>;
}

/**
 * Run the risk scan for a shop.
 * Uses local VariantSnapshot data (from product sync) + Shopify GraphQL for discounts/collections/themes.
 */
export async function runRiskScan(
  shop: string,
  admin: {
    graphql: (
      query: string,
      options?: { variables?: Record<string, unknown> },
    ) => Promise<Response>;
  },
  lowStockThreshold: number = 5,
): Promise<RiskScanResult> {
  console.log(`[StoreGuard] Starting risk scan for ${shop}`);

  // --- 1. Query local snapshots for inventory risks ---
  const totalProducts = await db.productSnapshot.count({ where: { shop } });
  const totalVariants = await db.variantSnapshot.count({ where: { shop } });

  // Zero stock: variants with inventoryQuantity = 0, grouped by product
  const zeroStockVariants = await db.variantSnapshot.findMany({
    where: { shop, inventoryQuantity: 0 },
    include: { productSnapshot: { select: { title: true } } },
  });

  // Group zero-stock variants by product
  const zeroByProduct = new Map<
    string,
    { id: string; title: string; variantCount: number }
  >();
  for (const v of zeroStockVariants) {
    const existing = zeroByProduct.get(v.productSnapshotId);
    if (existing) {
      existing.variantCount++;
    } else {
      zeroByProduct.set(v.productSnapshotId, {
        id: v.productSnapshotId,
        title: v.productSnapshot.title,
        variantCount: 1,
      });
    }
  }
  const zeroStockProducts = Array.from(zeroByProduct.values());

  // Low stock: variants below threshold but above zero
  const lowStockVariants = await db.variantSnapshot.findMany({
    where: {
      shop,
      inventoryQuantity: { gt: 0, lte: lowStockThreshold },
    },
    include: { productSnapshot: { select: { title: true } } },
  });

  const lowStockResult = lowStockVariants.map((v) => ({
    id: v.shopifyVariantId,
    productTitle: v.productSnapshot.title,
    variantTitle: v.title,
    quantity: v.inventoryQuantity,
  }));

  // Recently modified products (updated in last 30 days)
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const recentlyModifiedProducts = await db.productSnapshot.count({
    where: { shop, updatedAt: { gte: thirtyDaysAgo } },
  });

  // --- 2. Query Shopify GraphQL for discounts ---
  let highDiscounts: RiskScanResult["highDiscounts"] = [];
  let totalDiscounts = 0;

  try {
    const discountsRes = await admin.graphql(
      `#graphql
        query GetActiveDiscounts {
          discountNodes(first: 50, query: "status:active") {
            edges {
              node {
                id
                discount {
                  __typename
                  ... on DiscountCodeBasic {
                    title
                    status
                    customerGets {
                      value {
                        ... on DiscountPercentage { percentage }
                        ... on DiscountAmount { amount { amount } }
                      }
                    }
                  }
                  ... on DiscountAutomaticBasic {
                    title
                    status
                    customerGets {
                      value {
                        ... on DiscountPercentage { percentage }
                        ... on DiscountAmount { amount { amount } }
                      }
                    }
                  }
                  ... on DiscountCodeBxgy { title status }
                  ... on DiscountAutomaticBxgy { title status }
                  ... on DiscountCodeFreeShipping { title status }
                  ... on DiscountAutomaticFreeShipping { title status }
                }
              }
            }
          }
        }
      `,
    );

    const discountsData: DiscountsResponse = await discountsRes.json();
    const discountEdges = discountsData.data?.discountNodes?.edges ?? [];
    totalDiscounts = discountEdges.length;

    for (const edge of discountEdges) {
      const node = edge.node;
      const discount = node.discount as Record<string, unknown>;
      const title = (discount.title as string) || "Untitled discount";
      const customerGets = discount.customerGets as
        | { value?: { percentage?: number; amount?: { amount?: string } } }
        | undefined;
      const value = customerGets?.value;

      if (value?.percentage && value.percentage >= 0.4) {
        highDiscounts.push({
          id: node.id,
          title,
          value: `${Math.round(value.percentage * 100)}%`,
          type: "percentage",
        });
      } else if (
        value?.amount?.amount &&
        parseFloat(value.amount.amount) >= 50
      ) {
        highDiscounts.push({
          id: node.id,
          title,
          value: `$${value.amount.amount}`,
          type: "fixed_amount",
        });
      }
    }
  } catch (err) {
    console.error(`[StoreGuard] Risk scan: discounts query failed:`, err);
  }

  // --- 3. Query Shopify GraphQL for collections ---
  let recentlyModifiedCollections = 0;
  let totalCollections = 0;

  try {
    const collectionsRes = await admin.graphql(
      `#graphql
        query GetCollections {
          collections(first: 250) {
            edges {
              node {
                id
                title
                updatedAt
              }
            }
          }
        }
      `,
    );

    const collectionsData: CollectionsResponse = await collectionsRes.json();
    const collectionEdges = collectionsData.data?.collections?.edges ?? [];
    totalCollections = collectionEdges.length;

    for (const edge of collectionEdges) {
      const updatedAt = new Date(edge.node.updatedAt);
      if (updatedAt >= thirtyDaysAgo) {
        recentlyModifiedCollections++;
      }
    }
  } catch (err) {
    console.error(`[StoreGuard] Risk scan: collections query failed:`, err);
  }

  // --- 4. Query Shopify GraphQL for theme ---
  let themeLastPublished: RiskScanResult["themeLastPublished"] = null;

  try {
    const themesRes = await admin.graphql(
      `#graphql
        query GetMainTheme {
          themes(first: 10, roles: MAIN) {
            edges {
              node {
                id
                name
                role
                updatedAt
              }
            }
          }
        }
      `,
    );

    const themesData: ThemesResponse = await themesRes.json();
    const mainTheme = themesData.data?.themes?.edges?.[0]?.node;

    if (mainTheme) {
      const updatedAt = new Date(mainTheme.updatedAt);
      const now = new Date();
      const daysAgo = Math.floor(
        (now.getTime() - updatedAt.getTime()) / (1000 * 60 * 60 * 24),
      );
      themeLastPublished = { name: mainTheme.name, daysAgo };
    }
  } catch (err) {
    console.error(`[StoreGuard] Risk scan: themes query failed:`, err);
  }

  const result: RiskScanResult = {
    zeroStockProducts,
    lowStockVariants: lowStockResult,
    highDiscounts,
    recentlyModifiedProducts,
    recentlyModifiedCollections,
    themeLastPublished,
    totalProducts,
    totalVariants,
    totalDiscounts,
    totalCollections,
    scannedAt: new Date().toISOString(),
  };

  console.log(
    `[StoreGuard] Risk scan complete for ${shop}: ${zeroStockProducts.length} zero-stock, ${lowStockResult.length} low-stock, ${highDiscounts.length} high discounts`,
  );

  return result;
}

/**
 * Get cached risk scan result for a shop, or null if not scanned yet.
 */
export async function getCachedRiskScan(
  shop: string,
): Promise<RiskScanResult | null> {
  const record = await db.shop.findUnique({
    where: { shopifyDomain: shop },
    select: { riskScanResult: true, riskScannedAt: true },
  });

  if (!record?.riskScanResult || !record?.riskScannedAt) return null;
  return record.riskScanResult as unknown as RiskScanResult;
}

/**
 * Save risk scan results to the Shop record.
 */
export async function saveRiskScanResult(
  shop: string,
  result: RiskScanResult,
): Promise<void> {
  await db.shop.update({
    where: { shopifyDomain: shop },
    data: {
      riskScanResult: result as unknown as Record<string, unknown>,
      riskScannedAt: new Date(),
    },
  });
  console.log(`[StoreGuard] Saved risk scan result for ${shop}`);
}
