import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { getProductSalesSeries } from "../services/productSales.server";

type DateRange = "today" | "yesterday" | "7d" | "30d" | "90d";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function generateDemoSeries(productId: string, range: DateRange, now: Date) {
  // Deterministic-ish series for screenshots (no external dependencies).
  const isHourly = range === "today" || range === "yesterday";
  const points =
    range === "today" ? Math.max(now.getHours() + 1, 12) :
    range === "yesterday" ? 24 :
    range === "7d" ? 7 :
    range === "30d" ? 30 : 90;

  const msStep = isHourly ? 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
  const bucketType: "hour" | "day" = isHourly ? "hour" : "day";

  // Seed behavior by productId: Pink Snowboard (1001) improves after change, Blue Snowboard (1002) slowly trends up.
  const isPink = productId === "1001";
  const isBlue = productId === "1002";

  const start = new Date(now.getTime() - (points - 1) * msStep);

  const series = Array.from({ length: points }, (_, i) => {
    const ts = start.getTime() + i * msStep;
    const hoursAgo = (now.getTime() - ts) / (60 * 60 * 1000);
    const daysAgo = (now.getTime() - ts) / (24 * 60 * 60 * 1000);

    let revenue = 0;
    let units = 0;

    if (isHourly) {
      // Baseline pattern
      const hour = new Date(ts).getHours();
      const base = hour >= 9 && hour <= 18 ? 18 : hour >= 6 && hour <= 22 ? 9 : 2;

      if (isPink) {
        // Price increased ~6h ago: slight dip right after, then recovery
        if (hoursAgo >= 5.5 && hoursAgo <= 6.5) revenue = base * 0.6;
        else if (hoursAgo < 5.5 && hoursAgo > 2) revenue = base * 0.85;
        else revenue = base * 1.1;
        units = revenue > 10 ? 1 : revenue > 4 ? 1 : 0;
      } else if (isBlue) {
        // Description improved ~4h ago: slow burn (no immediate spike)
        revenue = base * (hoursAgo < 4 ? 1.15 : 1.0);
        units = revenue > 12 ? 1 : 0;
      } else {
        revenue = base;
        units = revenue > 12 ? 1 : 0;
      }
    } else {
      // Daily view: make it look like a real store trend
      const weekday = new Date(ts).getDay();
      const base = (weekday === 0 || weekday === 6) ? 220 : (weekday >= 2 && weekday <= 4) ? 180 : 140;

      if (isBlue) {
        // Gradual improvement after the change (4 days ago in this synthetic world)
        const lift = daysAgo < 4 ? 1.25 : 1.0;
        revenue = base * lift;
      } else if (isPink) {
        // Slight volatility, overall stable
        revenue = base * (daysAgo < 6 ? 1.05 : 0.95);
      } else {
        revenue = base;
      }
      units = Math.max(0, Math.round(revenue / 90));
    }

    // Round to cents precision (as dollars)
    const rounded = Math.round(revenue * 100) / 100;
    return { timestamp: ts, revenue: rounded, units };
  });

  return {
    productId,
    bucketType,
    currency: "USD",
    isComplete: true,
    points: series,
  };
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);

  const productId = url.searchParams.get("productId");
  const range = (url.searchParams.get("range") as DateRange) || "today";
  const isDemo = url.searchParams.get("demo") === "true";

  if (!productId) return json({ error: "Missing productId" }, 400);
  if (!isDemo && !/^\d+$/.test(productId)) return json({ error: "Invalid productId" }, 400);
  if (!["today", "yesterday", "7d", "30d", "90d"].includes(range)) {
    return json({ error: "Invalid range" }, 400);
  }

  if (isDemo) {
    return json(generateDemoSeries(productId, range, new Date()));
  }

  const { session, admin } = await authenticate.admin(request);
  const result = await getProductSalesSeries({
    shop: session.shop,
    productId,
    range,
    admin,
  });

  // NOTE: we intentionally return only aggregated product metrics (no PII).
  return json(result);
};

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
