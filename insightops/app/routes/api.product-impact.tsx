import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { getProductImpact } from "../services/productSales.server";

type DateRange = "today" | "yesterday" | "7d" | "30d" | "90d";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

function startOfHour(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), 0, 0, 0);
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}

function generateDemoSeries(productId: string, range: DateRange, now: Date) {
  // Keep in sync with /api/product-sales demo series so the verdict matches the sparkline.
  const isHourly = range === "today" || range === "yesterday";
  const points =
    range === "today" ? Math.max(now.getHours() + 1, 12) :
    range === "yesterday" ? 24 :
    range === "7d" ? 7 :
    range === "30d" ? 30 : 90;

  const msStep = isHourly ? HOUR_MS : DAY_MS;
  const bucketType: "hour" | "day" = isHourly ? "hour" : "day";

  const isPink = productId === "1001";
  const isBlue = productId === "1002";

  const start = new Date(now.getTime() - (points - 1) * msStep);

  const series = Array.from({ length: points }, (_, i) => {
    const ts = start.getTime() + i * msStep;
    const hoursAgo = (now.getTime() - ts) / HOUR_MS;
    const daysAgo = (now.getTime() - ts) / DAY_MS;

    let revenue = 0;
    let units = 0;

    if (isHourly) {
      const hour = new Date(ts).getHours();
      const base = hour >= 9 && hour <= 18 ? 18 : hour >= 6 && hour <= 22 ? 9 : 2;

      if (isPink) {
        if (hoursAgo >= 5.5 && hoursAgo <= 6.5) revenue = base * 0.6;
        else if (hoursAgo < 5.5 && hoursAgo > 2) revenue = base * 0.85;
        else revenue = base * 1.1;
        units = revenue > 10 ? 1 : revenue > 4 ? 1 : 0;
      } else if (isBlue) {
        revenue = base * (hoursAgo < 4 ? 1.15 : 1.0);
        units = revenue > 12 ? 1 : 0;
      } else {
        revenue = base;
        units = revenue > 12 ? 1 : 0;
      }
    } else {
      const weekday = new Date(ts).getDay();
      const base = (weekday === 0 || weekday === 6) ? 220 : (weekday >= 2 && weekday <= 4) ? 180 : 140;

      if (isBlue) {
        const lift = daysAgo < 4 ? 1.25 : 1.0;
        revenue = base * lift;
      } else if (isPink) {
        revenue = base * (daysAgo < 6 ? 1.05 : 0.95);
      } else {
        revenue = base;
      }
      units = Math.max(0, Math.round(revenue / 90));
    }

    const rounded = Math.round(revenue * 100) / 100;
    return { timestamp: ts, revenue: rounded, units };
  });

  return { productId, bucketType, currency: "USD", isComplete: true, points: series };
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);

  const productId = url.searchParams.get("productId");
  const eventTs = url.searchParams.get("eventTs");
  const isDemo = url.searchParams.get("demo") === "true";

  if (!productId) return json({ error: "Missing productId" }, 400);
  if (!isDemo && !/^\d+$/.test(productId)) return json({ error: "Invalid productId" }, 400);
  if (!eventTs || !/^\d+$/.test(eventTs)) return json({ error: "Missing/invalid eventTs" }, 400);

  if (isDemo) {
    // Compute demo impact from the same deterministic demo series used by /api/product-sales,
    // so the status can never contradict the sparkline.
    const now = new Date();
    const eventTime = new Date(Number(eventTs));
    const range: DateRange =
      startOfDay(eventTime).getTime() === startOfDay(now).getTime()
        ? "today"
        : startOfDay(eventTime).getTime() === startOfDay(new Date(now.getTime() - DAY_MS)).getTime()
          ? "yesterday"
          : "7d";

    const series = generateDemoSeries(productId, range, now);

    const windowHours = 4;
    const windowStart = startOfHour(eventTime).getTime();
    const windowEnd = windowStart + windowHours * HOUR_MS;
    const observedEnd = Math.min(windowEnd, now.getTime());
    const observedPoints = (series.points as Array<{ timestamp: number; revenue: number; units: number }>)
      .filter((p) => p.timestamp >= windowStart && p.timestamp < observedEnd);

    const observedHours = Math.max(0, observedPoints.length);
    const curRevenue = observedPoints.reduce((s, p) => s + (p.revenue ?? 0), 0);
    const curUnits = observedPoints.reduce((s, p) => s + (p.units ?? 0), 0);

    const preStart = windowStart - observedHours * HOUR_MS;
    const prePoints = (series.points as Array<{ timestamp: number; revenue: number; units: number }>)
      .filter((p) => p.timestamp >= preStart && p.timestamp < windowStart);

    const preRevenue = prePoints.reduce((s, p) => s + (p.revenue ?? 0), 0);
    const preUnits = prePoints.reduce((s, p) => s + (p.units ?? 0), 0);

    const curRph = observedHours > 0 ? curRevenue / observedHours : 0;
    const curUph = observedHours > 0 ? curUnits / observedHours : 0;

    const typRph = prePoints.length === observedHours && observedHours > 0 ? preRevenue / observedHours : null;
    const typUph = prePoints.length === observedHours && observedHours > 0 ? preUnits / observedHours : null;

    const ratio = typRph && typRph > 0 ? curRph / typRph : null;
    const status =
      observedHours < 1
        ? "measuring"
        : ratio === null
          ? "normal"
          : ratio <= 0.3 && typRph >= 5
            ? "high_drop"
            : ratio >= 1.7 && typRph >= 5
              ? "high_lift"
              : "normal";

    const confidence = observedHours < 1 ? "low" : observedHours < 2 ? "medium" : "high";
    const note =
      status === "measuring"
        ? "Measuring sales velocity (need at least ~1 hour of post-change data)."
        : typRph === null
          ? "Baseline not available yet (not enough pre-change hours in this demo window)."
          : `Compared to the previous ${observedHours}h in this demo series.`;

    return json({
      productId,
      currency: series.currency,
      immediate: {
        windowHours,
        currentRevenuePerHour: Math.round(curRph * 100) / 100,
        typicalRevenuePerHour: typRph === null ? null : Math.round(typRph * 100) / 100,
        currentUnitsPerHour: Math.round(curUph * 100) / 100,
        typicalUnitsPerHour: typUph === null ? null : Math.round(typUph * 100) / 100,
        status,
        confidence,
        note,
      },
      sustained: null,
    });
  }

  const { session, admin } = await authenticate.admin(request);
  const result = await getProductImpact({
    shop: session.shop,
    admin,
    productId,
    eventTimestamp: Number(eventTs),
  });

  return json(result);
};

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);


