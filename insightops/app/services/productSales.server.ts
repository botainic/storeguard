import db from "../db.server";

export type DateRange = "today" | "yesterday" | "7d" | "30d" | "90d";
type BucketType = "hour" | "day";

export interface ProductSalesSeriesPoint {
  timestamp: number; // bucket start (ms)
  revenue: number; // dollars
  units: number;
}

export interface ProductSalesSeriesResult {
  productId: string;
  bucketType: BucketType;
  currency: string | null;
  isComplete: boolean;
  points: ProductSalesSeriesPoint[];
  // If false, we likely hit Shopify's 60-day Orders API limit without read_all_orders.
  completenessNote?: string;
}

export interface ProductImpactResult {
  productId: string;
  currency: string | null;
  immediate: {
    windowHours: number;
    currentRevenuePerHour: number;
    typicalRevenuePerHour: number | null; // same window last week
    currentUnitsPerHour: number;
    typicalUnitsPerHour: number | null;
    status: "measuring" | "normal" | "high_drop" | "high_lift";
    confidence: "low" | "medium" | "high";
    note: string;
  };
  sustained: null | {
    preDailyAvgRevenue: number;
    postDailyAvgRevenue: number;
    preDailyAvgUnits: number;
    postDailyAvgUnits: number;
    status: "measuring" | "normal" | "high_drop" | "high_lift";
    confidence: "low" | "medium" | "high";
    note: string;
  };
}

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

function startOfHour(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), 0, 0, 0);
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}

function getRangeBounds(range: DateRange, now: Date): { start: Date; end: Date; bucketType: BucketType } {
  if (range === "today") {
    return { start: startOfDay(now), end: now, bucketType: "hour" };
  }
  if (range === "yesterday") {
    const y = new Date(now);
    y.setDate(y.getDate() - 1);
    const start = startOfDay(y);
    const end = startOfDay(now); // exclusive-ish
    return { start, end, bucketType: "hour" };
  }
  if (range === "7d") {
    return { start: new Date(now.getTime() - 7 * DAY_MS), end: now, bucketType: "day" };
  }
  if (range === "30d") {
    return { start: new Date(now.getTime() - 30 * DAY_MS), end: now, bucketType: "day" };
  }
  return { start: new Date(now.getTime() - 90 * DAY_MS), end: now, bucketType: "day" };
}

function buildEmptySlots(start: Date, end: Date, bucketType: BucketType): Map<number, { revenueCents: number; units: number }> {
  const slots = new Map<number, { revenueCents: number; units: number }>();
  if (bucketType === "hour") {
    let ts = startOfHour(start).getTime();
    const endTs = end.getTime();
    for (; ts <= endTs; ts += HOUR_MS) {
      slots.set(ts, { revenueCents: 0, units: 0 });
    }
  } else {
    let ts = startOfDay(start).getTime();
    const endTs = startOfDay(end).getTime();
    for (; ts <= endTs; ts += DAY_MS) {
      slots.set(ts, { revenueCents: 0, units: 0 });
    }
  }
  return slots;
}

function productGid(productId: string): string {
  return `gid://shopify/Product/${productId}`;
}

function toCents(amount: string | number | null | undefined): number {
  const n = typeof amount === "number" ? amount : parseFloat(amount ?? "0");
  if (!isFinite(n)) return 0;
  return Math.round(n * 100);
}

type OrderLineItem = {
  quantity: number;
  productId: string | null; // GID
  amount: string; // stringified
  currencyCode: string | null;
};

type OrderNode = {
  createdAt: string;
  lineItems: OrderLineItem[];
};

async function fetchOrdersWithLineItems(
  admin: { graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response> },
  startISO: string,
  endISO: string | null
): Promise<OrderNode[]> {
  // Only paid orders. Intentionally NO customer fields requested.
  const query = endISO
    ? `financial_status:paid created_at:>=${startISO} created_at:<${endISO}`
    : `financial_status:paid created_at:>=${startISO}`;

  const orders: OrderNode[] = [];
  let cursor: string | null = null;

  for (;;) {
    const resp = await admin.graphql(
      `#graphql
      query OrdersForProductSeries($query: String!, $after: String) {
        orders(first: 250, query: $query, after: $after, sortKey: CREATED_AT) {
          pageInfo { hasNextPage endCursor }
          edges {
            node {
              createdAt
              lineItems(first: 100) {
                edges {
                  node {
                    quantity
                    discountedTotalSet { shopMoney { amount currencyCode } }
                    product { id }
                  }
                }
              }
            }
          }
        }
      }`,
      { variables: { query, after: cursor } }
    );

    const data = (await resp.json()) as any;
    const container = data?.data?.orders;
    if (!container?.edges?.length) break;

    for (const edge of container.edges) {
      const node = edge?.node;
      if (!node?.createdAt) continue;

      const lineItems: OrderLineItem[] = (node.lineItems?.edges ?? []).map((e: any) => ({
        quantity: Number(e?.node?.quantity ?? 0) || 0,
        productId: e?.node?.product?.id ?? null,
        amount: String(e?.node?.discountedTotalSet?.shopMoney?.amount ?? "0"),
        currencyCode: e?.node?.discountedTotalSet?.shopMoney?.currencyCode ?? null,
      }));

      orders.push({ createdAt: node.createdAt, lineItems });
    }

    const pageInfo = container?.pageInfo;
    if (!pageInfo?.hasNextPage) break;
    cursor = pageInfo.endCursor ?? null;
    if (!cursor) break;
  }

  return orders;
}

async function upsertPointsToDb(args: {
  shop: string;
  productId: string;
  bucketType: BucketType;
  currency: string | null;
  points: Map<number, { revenueCents: number; units: number }>;
}) {
  const { shop, productId, bucketType, currency, points } = args;
  const entries = Array.from(points.entries());

  for (const [ts, val] of entries) {
    await db.productSalesPoint.upsert({
      where: {
        shop_productId_bucketType_bucketStart: {
          shop,
          productId,
          bucketType,
          bucketStart: new Date(ts),
        },
      },
      create: {
        shop,
        productId,
        bucketType,
        bucketStart: new Date(ts),
        revenueCents: val.revenueCents,
        units: val.units,
        currency,
      },
      update: {
        revenueCents: val.revenueCents,
        units: val.units,
        currency,
      },
    });
  }
}

async function getCustomProductSeries(args: {
  shop: string;
  admin: { graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response> };
  productId: string;
  start: Date;
  end: Date;
  bucketType: BucketType;
}): Promise<{ currency: string | null; points: ProductSalesSeriesPoint[] }> {
  const { shop, admin, productId, start, end, bucketType } = args;
  const slots = buildEmptySlots(start, end, bucketType);
  const targetProductGid = productGid(productId);

  const orders = await fetchOrdersWithLineItems(admin, start.toISOString(), end.toISOString());
  let currency: string | null = null;

  for (const order of orders) {
    const orderTime = new Date(order.createdAt);
    const bucketStartTs =
      bucketType === "hour" ? startOfHour(orderTime).getTime() : startOfDay(orderTime).getTime();

    for (const li of order.lineItems) {
      if (!li.productId || li.productId !== targetProductGid) continue;
      currency = currency ?? li.currencyCode ?? null;
      const cur = slots.get(bucketStartTs);
      if (!cur) continue;
      cur.revenueCents += toCents(li.amount);
      cur.units += li.quantity;
    }
  }

  await upsertPointsToDb({
    shop,
    productId,
    bucketType,
    currency,
    points: slots,
  });

  const points: ProductSalesSeriesPoint[] = Array.from(slots.entries())
    .sort(([a], [b]) => a - b)
    .map(([timestamp, v]) => ({
      timestamp,
      revenue: Math.round(v.revenueCents) / 100,
      units: v.units,
    }));

  return { currency, points };
}

export async function getProductSalesSeries(args: {
  shop: string;
  admin: { graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response> };
  productId: string;
  range: DateRange;
}): Promise<ProductSalesSeriesResult> {
  const now = new Date();
  const { start, end, bucketType } = getRangeBounds(args.range, now);
  const startISO = start.toISOString();
  const endISO = args.range === "yesterday" ? end.toISOString() : null;

  const slots = buildEmptySlots(start, end, bucketType);
  const targetProductGid = productGid(args.productId);

  // Completeness heuristic (Shopify often limits Orders history unless read_all_orders)
  const sixtyDaysAgo = new Date(now.getTime() - 60 * DAY_MS);
  let isComplete = start >= sixtyDaysAgo;
  let completenessNote: string | undefined;
  if (!isComplete) {
    completenessNote =
      "Requested range extends beyond the Orders API default history window (~60 days) without read_all_orders.";
  }

  const orders = await fetchOrdersWithLineItems(args.admin, startISO, endISO);

  let currency: string | null = null;
  for (const order of orders) {
    const orderTime = new Date(order.createdAt);
    const bucketStartTs =
      bucketType === "hour" ? startOfHour(orderTime).getTime() : startOfDay(orderTime).getTime();

    for (const li of order.lineItems) {
      if (!li.productId || li.productId !== targetProductGid) continue;
      currency = currency ?? li.currencyCode ?? null;

      const cur = slots.get(bucketStartTs);
      if (!cur) continue;
      cur.revenueCents += toCents(li.amount);
      cur.units += li.quantity;
    }
  }

  await upsertPointsToDb({
    shop: args.shop,
    productId: args.productId,
    bucketType,
    currency,
    points: slots,
  });

  const points: ProductSalesSeriesPoint[] = Array.from(slots.entries())
    .sort(([a], [b]) => a - b)
    .map(([timestamp, v]) => ({
      timestamp,
      revenue: Math.round(v.revenueCents) / 100,
      units: v.units,
    }));

  return {
    productId: args.productId,
    bucketType,
    currency,
    isComplete,
    completenessNote,
    points,
  };
}

export async function getProductImpact(args: {
  shop: string;
  admin: { graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response> };
  productId: string;
  eventTimestamp: number; // ms
}): Promise<ProductImpactResult> {
  const now = new Date();
  const eventTime = new Date(args.eventTimestamp);

  // --- Panic check: next 4 hours vs same 4 hours last week (sales velocity) ---
  const windowHours = 4;
  const windowStart = startOfHour(eventTime);
  const windowEnd = new Date(windowStart.getTime() + windowHours * HOUR_MS);

  const observedEnd = new Date(Math.min(windowEnd.getTime(), now.getTime()));
  const observedHours = Math.max(0, Math.round((observedEnd.getTime() - windowStart.getTime()) / HOUR_MS));

  const weekAgoStart = new Date(windowStart.getTime() - 7 * DAY_MS);
  const weekAgoEnd = new Date(windowEnd.getTime() - 7 * DAY_MS);

  const [curSeries, typicalSeries] = await Promise.all([
    getCustomProductSeries({
      shop: args.shop,
      admin: args.admin,
      productId: args.productId,
      start: windowStart,
      end: observedEnd,
      bucketType: "hour",
    }),
    getCustomProductSeries({
      shop: args.shop,
      admin: args.admin,
      productId: args.productId,
      start: weekAgoStart,
      end: new Date(Math.min(weekAgoEnd.getTime(), weekAgoStart.getTime() + Math.max(1, observedHours) * HOUR_MS)),
      bucketType: "hour",
    }),
  ]);

  const currency = curSeries.currency ?? typicalSeries.currency ?? null;
  const sumRevenue = (pts: ProductSalesSeriesPoint[]) => pts.reduce((s, p) => s + (p.revenue ?? 0), 0);
  const sumUnits = (pts: ProductSalesSeriesPoint[]) => pts.reduce((s, p) => s + (p.units ?? 0), 0);

  const curRevenue = sumRevenue(curSeries.points);
  const curUnits = sumUnits(curSeries.points);

  const typicalRevenue = typicalSeries.points.length ? sumRevenue(typicalSeries.points) : null;
  const typicalUnits = typicalSeries.points.length ? sumUnits(typicalSeries.points) : null;

  const curRph = observedHours > 0 ? curRevenue / observedHours : 0;
  const curUph = observedHours > 0 ? curUnits / observedHours : 0;
  const typRph = typicalRevenue !== null && observedHours > 0 ? typicalRevenue / observedHours : null;
  const typUph = typicalUnits !== null && observedHours > 0 ? typicalUnits / observedHours : null;

  const ratio = typRph && typRph > 0 ? curRph / typRph : null;
  const immediateStatus: ProductImpactResult["immediate"]["status"] =
    observedHours < 1
      ? "measuring"
      : ratio === null
        ? "normal"
        : ratio <= 0.3 && typRph >= 20
          ? "high_drop"
          : ratio >= 1.7 && typRph >= 20
            ? "high_lift"
            : "normal";

  const immediateConfidence: ProductImpactResult["immediate"]["confidence"] =
    observedHours < 1 ? "low" : observedHours < 2 ? "medium" : "high";

  const immediateNote =
    immediateStatus === "measuring"
      ? "Measuring sales velocity (need at least ~1 hour of post-change data)."
      : typRph === null
        ? "No baseline available for the same window last week."
        : `Compared to the same ${observedHours}h window last week.`;

  // --- Growth check: 7-day daily average pre vs post ---
  const eventDayStart = startOfDay(eventTime);
  const preStart = new Date(eventDayStart.getTime() - 7 * DAY_MS);
  const preEnd = eventDayStart;
  const postStart = eventDayStart;
  const postEnd = new Date(Math.min(startOfDay(now).getTime() + DAY_MS, now.getTime())); // up to today

  const [preDaily, postDaily] = await Promise.all([
    getCustomProductSeries({
      shop: args.shop,
      admin: args.admin,
      productId: args.productId,
      start: preStart,
      end: preEnd,
      bucketType: "day",
    }),
    getCustomProductSeries({
      shop: args.shop,
      admin: args.admin,
      productId: args.productId,
      start: postStart,
      end: postEnd,
      bucketType: "day",
    }),
  ]);

  const preDays = preDaily.points.length;
  const postDays = postDaily.points.length;
  const preAvgRevenue = preDays > 0 ? sumRevenue(preDaily.points) / preDays : 0;
  const postAvgRevenue = postDays > 0 ? sumRevenue(postDaily.points) / postDays : 0;
  const preAvgUnits = preDays > 0 ? sumUnits(preDaily.points) / preDays : 0;
  const postAvgUnits = postDays > 0 ? sumUnits(postDaily.points) / postDays : 0;

  const sustainedConfidence: ProductImpactResult["sustained"]["confidence"] =
    postDays < 3 ? "low" : postDays < 5 ? "medium" : "high";

  const sustainedRatio = preAvgRevenue > 0 ? postAvgRevenue / preAvgRevenue : null;
  const sustainedStatus: ProductImpactResult["sustained"]["status"] =
    postDays < 3
      ? "measuring"
      : sustainedRatio === null
        ? "normal"
        : sustainedRatio <= 0.7
          ? "high_drop"
          : sustainedRatio >= 1.3
            ? "high_lift"
            : "normal";

  const sustainedNote =
    postDays < 3
      ? "Not enough post-change days yet for a stable trend."
      : "Compared 7-day daily averages before vs after the change.";

  return {
    productId: args.productId,
    currency,
    immediate: {
      windowHours,
      currentRevenuePerHour: Math.round(curRph * 100) / 100,
      typicalRevenuePerHour: typRph !== null ? Math.round(typRph * 100) / 100 : null,
      currentUnitsPerHour: Math.round(curUph * 100) / 100,
      typicalUnitsPerHour: typUph !== null ? Math.round(typUph * 100) / 100 : null,
      status: immediateStatus,
      confidence: immediateConfidence,
      note: immediateNote,
    },
    sustained: {
      preDailyAvgRevenue: Math.round(preAvgRevenue * 100) / 100,
      postDailyAvgRevenue: Math.round(postAvgRevenue * 100) / 100,
      preDailyAvgUnits: Math.round(preAvgUnits * 100) / 100,
      postDailyAvgUnits: Math.round(postAvgUnits * 100) / 100,
      status: sustainedStatus,
      confidence: sustainedConfidence,
      note: sustainedNote,
    },
  };
}


