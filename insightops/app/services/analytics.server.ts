/**
 * Analytics service using ShopifyQL for efficient sales data queries.
 * This replaces the naive approach of fetching individual orders.
 *
 * ShopifyQL provides aggregated data directly, avoiding the need to:
 * 1. Fetch potentially thousands of orders
 * 2. Manually aggregate them by hour/day
 * 3. Deal with pagination limits
 *
 * Requires: read_reports scope
 *
 * @see https://shopify.dev/docs/api/admin-graphql/latest/queries/shopifyqlQuery
 */

interface ShopifyQLResponse {
  data?: {
    shopifyqlQuery: {
      tableData: {
        columns: Array<{
          name: string;
          dataType: string;
          displayName: string;
        }>;
        rows: string[][]; // Each row is an array of stringified values
      } | null;
      parseErrors: string[];
    };
  };
  errors?: Array<{ message: string }>;
}

interface SalesDataPoint {
  hour: string; // Display label - NOW DEPRECATED, kept for backwards compatibility
  sales: number;
  timestamp: number; // Unix timestamp in ms - use this for client-side formatting
}

type DateRange = "today" | "yesterday" | "7d" | "30d" | "90d";

/**
 * Build ShopifyQL query for sales data based on date range
 */
function buildSalesQuery(range: DateRange): string {
  // ShopifyQL uses relative date syntax like -1d, -7d, etc.
  // For daily/multi-day views, group by day
  // For today/yesterday, we'd ideally group by hour but ShopifyQL has limitations

  switch (range) {
    case "today":
      // Today's sales by hour (if supported) or just total
      return `FROM sales SHOW total_sales BY hour SINCE -1d UNTIL today ORDER BY hour`;
    case "yesterday":
      return `FROM sales SHOW total_sales BY hour SINCE -2d UNTIL -1d ORDER BY hour`;
    case "7d":
      return `FROM sales SHOW total_sales BY day SINCE -7d ORDER BY day`;
    case "30d":
      return `FROM sales SHOW total_sales BY day SINCE -30d ORDER BY day`;
    case "90d":
      return `FROM sales SHOW total_sales BY day SINCE -90d ORDER BY day`;
    default:
      return `FROM sales SHOW total_sales BY day SINCE -7d ORDER BY day`;
  }
}

/**
 * Fetch sales data using ShopifyQL Analytics API
 * Falls back to order-based fetching if ShopifyQL fails
 */
export async function fetchSalesData(
  admin: {
    graphql: (
      query: string,
      options?: { variables?: Record<string, unknown> }
    ) => Promise<Response>;
  },
  range: DateRange
): Promise<{ salesData: SalesDataPoint[]; usedAnalytics: boolean }> {
  const now = new Date();
  const isHourly = range === "today" || range === "yesterday";

  // For "today", always use Orders API for real-time data
  // ShopifyQL Analytics has a 15-30 minute data lag which makes recent sales invisible
  if (range === "today") {
    console.log("[StoreGuard] Using Orders API for real-time 'today' view");
    return fetchSalesFromOrders(admin, range, now);
  }

  try {
    const shopifyqlQuery = buildSalesQuery(range);

    const response = await admin.graphql(
      `#graphql
        query GetSalesAnalytics($query: String!) {
          shopifyqlQuery(query: $query) {
            tableData {
              columns {
                name
                dataType
                displayName
              }
              rows
            }
            parseErrors
          }
        }
      `,
      {
        variables: { query: shopifyqlQuery },
      }
    );

    const data: ShopifyQLResponse = await response.json();

    // Check for errors
    if (data.errors?.length) {
      console.error("[StoreGuard] ShopifyQL errors:", data.errors);
      throw new Error(data.errors[0].message);
    }

    if (data.data?.shopifyqlQuery.parseErrors?.length) {
      console.error("[StoreGuard] ShopifyQL parse errors:", data.data.shopifyqlQuery.parseErrors);
      throw new Error(data.data.shopifyqlQuery.parseErrors[0]);
    }

    const tableData = data.data?.shopifyqlQuery.tableData;
    if (!tableData?.rows?.length) {
      console.log("[StoreGuard] No analytics data returned");
      return { salesData: generateEmptyData(range, now), usedAnalytics: true };
    }

    // Parse the response
    // Columns are typically: [day/hour, total_sales]
    // ShopifyQL returns times in the store's timezone
    const salesData: SalesDataPoint[] = tableData.rows.map((row) => {
      const dateStr = row[0]; // e.g., "2024-12-10" or "2024-12-10T14:00:00Z"
      const sales = parseFloat(row[1]) || 0;

      // Remove Z suffix if present to parse as local time
      // ShopifyQL data is typically in store timezone, not UTC
      const normalizedDateStr = dateStr.replace(/Z$/, "");
      const date = new Date(normalizedDateStr);
      const timestamp = date.getTime();

      const hour = isHourly
        ? date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
        : date.toLocaleDateString("en-US", { month: "short", day: "numeric" });

      return {
        hour,
        sales: Math.round(sales * 100) / 100,
        timestamp,
      };
    });

    console.log(`[StoreGuard] Fetched ${salesData.length} data points via ShopifyQL`);
    return { salesData, usedAnalytics: true };
  } catch (error) {
    console.error("[StoreGuard] ShopifyQL failed, falling back to orders:", error);

    // Fallback to order-based fetching
    return fetchSalesFromOrders(admin, range, now);
  }
}

/**
 * Fallback: Fetch sales from individual orders
 * Used when ShopifyQL is not available (e.g., missing scope)
 */
async function fetchSalesFromOrders(
  admin: {
    graphql: (
      query: string,
      options?: { variables?: Record<string, unknown> }
    ) => Promise<Response>;
  },
  range: DateRange,
  now: Date
): Promise<{ salesData: SalesDataPoint[]; usedAnalytics: boolean }> {
  const isHourly = range === "today" || range === "yesterday";

  // Calculate start and end dates in LOCAL time
  let startDate: Date;
  let endDate: Date = now;

  if (range === "today") {
    // Midnight today local time
    startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
  } else if (range === "yesterday") {
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    startDate = new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate(), 0, 0, 0);
    // End at midnight today (exclusive of today)
    endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
  } else if (range === "7d") {
    startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  } else if (range === "30d") {
    startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  } else {
    startDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
  }

  try {
    const response = await admin.graphql(
      `#graphql
        query GetOrders($query: String!) {
          orders(first: 250, query: $query) {
            edges {
              node {
                id
                createdAt
                totalPriceSet {
                  shopMoney {
                    amount
                  }
                }
              }
            }
          }
        }
      `,
      {
        variables: {
          query: `created_at:>=${startDate.toISOString()}`,
        },
      }
    );

    const data = await response.json();
    const orders = data.data?.orders?.edges || [];

    console.log(`[StoreGuard] Fetched ${orders.length} orders since ${startDate.toISOString()} (${startDate.toLocaleString()})`);

    // Use timestamp-based slots (milliseconds) for precise matching
    // This avoids timezone string parsing issues
    const slotData: Map<number, number> = new Map();
    const HOUR_MS = 60 * 60 * 1000;
    const DAY_MS = 24 * HOUR_MS;

    if (isHourly) {
      // Create hourly slots from startDate to endDate
      // Round startDate to start of hour
      const slotStart = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate(), startDate.getHours(), 0, 0).getTime();
      const slotEnd = endDate.getTime();

      for (let ts = slotStart; ts <= slotEnd; ts += HOUR_MS) {
        slotData.set(ts, 0);
      }

      // Aggregate orders into hourly slots
      for (const edge of orders) {
        const order = edge.node;
        const orderDate = new Date(order.createdAt);
        // IMPORTANT: bucket in *local* start-of-hour so chart labels match the Activity Timeline.
        // (If we bucket in UTC but render labels in local time, we can drift by 1 hour or more.)
        const hourTs = new Date(
          orderDate.getFullYear(),
          orderDate.getMonth(),
          orderDate.getDate(),
          orderDate.getHours(),
          0,
          0,
          0
        ).getTime();
        const amount = parseFloat(order.totalPriceSet.shopMoney.amount);

        if (slotData.has(hourTs)) {
          slotData.set(hourTs, (slotData.get(hourTs) || 0) + amount);
        } else {
          // Order falls outside our slots - might be before startDate
          console.log(`[StoreGuard] Order at ${orderDate.toISOString()} outside slots`);
        }
      }
    } else {
      // Daily slots - use midnight local time for each day
      const startDay = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate()).getTime();
      const endDay = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate()).getTime();

      for (let ts = startDay; ts <= endDay; ts += DAY_MS) {
        slotData.set(ts, 0);
      }

      // Aggregate orders into daily slots
      for (const edge of orders) {
        const order = edge.node;
        const orderDate = new Date(order.createdAt);
        // Get midnight of the order date in local time
        const dayTs = new Date(orderDate.getFullYear(), orderDate.getMonth(), orderDate.getDate()).getTime();
        const amount = parseFloat(order.totalPriceSet.shopMoney.amount);

        if (slotData.has(dayTs)) {
          slotData.set(dayTs, (slotData.get(dayTs) || 0) + amount);
        }
      }
    }

    // Convert to sorted array
    const salesData: SalesDataPoint[] = Array.from(slotData.entries())
      .sort(([a], [b]) => a - b)
      .map(([timestamp, sales]) => ({
        hour: "", // Will be formatted client-side
        sales: Math.round(sales * 100) / 100,
        timestamp,
      }));

    const totalSales = salesData.reduce((sum, d) => sum + d.sales, 0);
    console.log(`[StoreGuard] Created ${salesData.length} time slots, total sales: $${totalSales.toFixed(2)}`);

    return { salesData, usedAnalytics: false };
  } catch (error) {
    console.error("[StoreGuard] Order fetch failed:", error);
    return { salesData: generateEmptyData(range, now), usedAnalytics: false };
  }
}

/**
 * Generate demo data for marketing screenshots
 * Creates a realistic sales pattern with a visible dip ~4 hours ago
 */
export function generateDemoData(range: DateRange, now: Date): SalesDataPoint[] {
  const isHourly = range === "today" || range === "yesterday";
  const points =
    range === "today"
      ? Math.max(now.getHours() + 1, 12) // At least 12 hours for good visual
      : range === "yesterday"
      ? 24
      : range === "7d"
      ? 7
      : range === "30d"
      ? 30
      : 90;

  // Base sales pattern - higher during business hours
  const getBaseSales = (hourOfDay: number): number => {
    // Peak at 11am and 3pm, low at night
    if (hourOfDay >= 9 && hourOfDay <= 17) {
      return 150 + Math.random() * 100; // $150-250
    }
    if (hourOfDay >= 6 && hourOfDay <= 21) {
      return 80 + Math.random() * 70; // $80-150
    }
    return 20 + Math.random() * 40; // $20-60 night hours
  };

  // For daily views, vary by day of week
  const getDailySales = (dayOfWeek: number): number => {
    // Weekend bump
    if (dayOfWeek === 0 || dayOfWeek === 6) {
      return 1800 + Math.random() * 600; // $1800-2400
    }
    // Tuesday-Thursday are best
    if (dayOfWeek >= 2 && dayOfWeek <= 4) {
      return 1400 + Math.random() * 500; // $1400-1900
    }
    return 1100 + Math.random() * 400; // $1100-1500
  };

  const HOUR_MS = 60 * 60 * 1000;
  const DAY_MS = 24 * HOUR_MS;
  const endAligned = isHourly
    ? new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), 0, 0, 0).getTime()
    : new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0).getTime();
  const startAligned = endAligned - (points - 1) * (isHourly ? HOUR_MS : DAY_MS);

  return Array.from({ length: points }, (_, i) => {
    const date = new Date(startAligned + i * (isHourly ? HOUR_MS : DAY_MS));

    let sales: number;

    if (isHourly) {
      sales = getBaseSales(date.getHours());

      // THE STORY: Create a noticeable dip 4-5 hours ago (when price was dropped)
      const hoursAgo = (now.getTime() - date.getTime()) / (60 * 60 * 1000);
      if (hoursAgo >= 3.5 && hoursAgo <= 5) {
        sales = sales * 0.35; // 65% drop - very visible
      } else if (hoursAgo >= 2 && hoursAgo < 3.5) {
        sales = sales * 0.6; // Recovering
      } else if (hoursAgo >= 1 && hoursAgo < 2) {
        sales = sales * 0.85; // Almost recovered (after price fix)
      }
    } else {
      sales = getDailySales(date.getDay());

      // Add some variance
      const daysAgo = (now.getTime() - date.getTime()) / (24 * 60 * 60 * 1000);
      if (daysAgo >= 3 && daysAgo <= 4) {
        sales = sales * 0.5; // A bad day mid-week
      }
    }

    return {
      hour: isHourly
        ? date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
        : date.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      sales: Math.round(sales * 100) / 100,
      timestamp: date.getTime(),
    };
  });
}

/**
 * Generate empty data structure (zeros, not fake data)
 */
function generateEmptyData(range: DateRange, now: Date): SalesDataPoint[] {
  const isHourly = range === "today" || range === "yesterday";
  const points =
    range === "today"
      ? now.getHours() + 1
      : range === "yesterday"
      ? 24
      : range === "7d"
      ? 7
      : range === "30d"
      ? 30
      : 90;

  const HOUR_MS = 60 * 60 * 1000;
  const DAY_MS = 24 * HOUR_MS;
  // Always align buckets to the natural boundaries so chart labels and event times match.
  const startAligned = isHourly
    ? range === "yesterday"
      ? new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 0, 0, 0, 0).getTime()
      : new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0).getTime()
    : new Date(now.getFullYear(), now.getMonth(), now.getDate() - (points - 1), 0, 0, 0, 0).getTime();

  return Array.from({ length: points }, (_, i) => {
    const date = new Date(startAligned + i * (isHourly ? HOUR_MS : DAY_MS));
    return {
      hour: isHourly
        ? date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
        : date.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      sales: 0,
      timestamp: date.getTime(),
    };
  });
}
