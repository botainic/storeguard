import type { LoaderFunctionArgs, HeadersFunction } from "react-router";
import { useLoaderData, useSearchParams, useNavigate, useFetcher, useRevalidator } from "react-router";
import { authenticate, PRO_MONTHLY_PLAN, ADMIN_SHOPS } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import db from "../db.server";
import { fetchSalesData, generateDemoData } from "../services/analytics.server";
import { getSyncStatus } from "../services/productSync.server";
import { useState, useMemo, useRef, useCallback, useEffect } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";
import { Bot, TrendingUp, TrendingDown, Lock, X, RefreshCw } from "lucide-react";

interface EventLog {
  id: string;
  shop: string;
  shopifyId: string;
  topic: string;
  author: string | null;
  message: string;
  diff: string | null;
  timestamp: Date;
  webhookId: string | null;
}

interface SalesDataPoint {
  hour: string; // Server-formatted label (may have timezone issues)
  sales: number;
  timestamp: number; // Unix timestamp in ms - use for client-side formatting
}

type ProductSeriesPoint = {
  timestamp: number;
  revenue: number;
  units: number;
};

// Format timestamp to local time string for chart display
function formatChartTime(timestamp: number, isHourly: boolean): string {
  const date = new Date(timestamp);
  if (isHourly) {
    return date.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
    });
  }
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

interface ImpactAnalysis {
  baselineSales: number; // What we compare against (smart or naive)
  postSales: number; // Sales after the event
  percentChange: number;
  diff: number; // Raw dollar difference
  isNegative: boolean;
  isZeroBaseline: boolean; // True when baseline is $0
  isSmartBaseline: boolean; // True if using week-over-week comparison
  analysisType: "immediate" | "sustained" | "none"; // Type of analysis performed
  storyContext?: {
    authorName: string;
    changeType: string; // "price", "title", "images", etc.
    changeDescription: string; // "dropped from $149 to $49"
    productName: string;
  };
}

type DateRange = "today" | "yesterday" | "7d" | "30d" | "90d";

// Custom tooltip component for the chart
function CustomTooltip({
  active,
  payload,
  label,
  isHourly,
  valueLabel,
}: {
  active?: boolean;
  payload?: Array<{ value: number }>;
  label?: string | number;
  isHourly?: boolean;
  valueLabel?: string;
}) {
  if (!active || !payload || !payload.length) return null;
  const shownLabel =
    typeof label === "number"
      ? formatChartTime(label, !!isHourly)
      : (label ?? "");
  const title = valueLabel ?? "Revenue";
  return (
    <div
      style={{
        backgroundColor: "#1a1a1a",
        padding: "8px 12px",
        borderRadius: "6px",
        border: "none",
        boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
      }}
    >
      <div style={{ color: "#fff", fontSize: "13px", fontWeight: "600" }}>
        {title}: ${payload[0].value.toFixed(2)}
      </div>
      <div style={{ color: "#919eab", fontSize: "11px", marginTop: "2px" }}>{shownLabel}</div>
    </div>
  );
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin, billing } = await authenticate.admin(request);
  const url = new URL(request.url);
  const range = (url.searchParams.get("range") as DateRange) || "today";
  const isDemo = url.searchParams.get("demo") === "true";
  const forceFree = url.searchParams.get("free") === "true"; // For testing Free tier

  // Check if user has Pro plan or is an admin shop
  const isAdminShop = ADMIN_SHOPS.includes(session.shop) && !forceFree;
  let isPro = isAdminShop;

  if (!isAdminShop) {
    try {
      const { hasActivePayment } = await billing.check({
        plans: [PRO_MONTHLY_PLAN],
        isTest: true, // Set to false in production
      });
      isPro = hasActivePayment;
    } catch (error) {
      console.error("[StoreGuard] Billing check failed:", error);
      isPro = false;
    }
  }

  // Free users can only access today/yesterday
  // If they try to access 7d/30d/90d, reset to "today"
  const FREE_RANGES: DateRange[] = ["today", "yesterday"];
  const effectiveRange = isPro ? range : (FREE_RANGES.includes(range) ? range : "today");

  // Calculate date range
  const now = new Date();
  let startDate: Date;

  if (effectiveRange === "today") {
    startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
  } else if (effectiveRange === "yesterday") {
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    startDate = new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate(), 0, 0, 0);
  } else if (effectiveRange === "7d") {
    startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  } else if (effectiveRange === "30d") {
    startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  } else if (effectiveRange === "90d") {
    startDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
  } else {
    startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
  }

  // Fetch events for this shop within date range
  // Exclude baseline snapshot events (internal use only for diff comparison)
  console.log(`[StoreGuard] Fetching events for shop: "${session.shop}" since ${startDate.toISOString()}`);

  // Debug: Check total events in db
  const totalEventsInDb = await db.eventLog.count();
  console.log(`[StoreGuard] Total events in database: ${totalEventsInDb}`);

  // Debug: Check events for this shop (no filters)
  const eventsForShop = await db.eventLog.count({ where: { shop: session.shop } });
  console.log(`[StoreGuard] Events for shop "${session.shop}": ${eventsForShop}`);

  // Pro users get more events, free users limited to 50
  // INCREASED LIMIT: To ensure chart interactivity works, we need enough events
  // For "Today" view, we want ALL events to ensure clicking works.
  const isShortRange = effectiveRange === "today" || effectiveRange === "yesterday";
  const eventLimit = isPro ? (isShortRange ? 500 : 200) : (isShortRange ? 100 : 50);

  const events = await db.eventLog.findMany({
    where: {
      shop: session.shop,
      timestamp: { gte: startDate },
      NOT: { topic: "products/snapshot" },
    },
    orderBy: { timestamp: "desc" },
    take: eventLimit,
  });
  console.log(`[StoreGuard] Found ${events.length} events for timeline`);

  // Use demo data for screenshots, or fetch real sales data
  let salesData;
  if (isDemo) {
    // Generate fake but realistic-looking sales data for marketing screenshots
    salesData = generateDemoData(effectiveRange, now);
  } else {
    // Fetch real sales data using ShopifyQL Analytics API (with order-based fallback)
    const result = await fetchSalesData(admin, effectiveRange);
    salesData = result.salesData;
  }

  // --- DEMO MODE: INJECT MOCK EVENTS ---
  // If in demo mode, real DB events won't match our fake sales chart timestamps.
  // We must inject fake events that align with the fake sales spikes/dips.
  let displayedEvents = events;
  if (isDemo) {
    const isHourly = effectiveRange === "today" || effectiveRange === "yesterday";
    const demoEvents: EventLog[] = [];
    
    // Helper to add a fake event relative to now
    const addDemoEvent = (hoursAgo: number, author: string, productId: string, message: string, topic: string, diff: string) => {
      const ts = new Date(now.getTime() - hoursAgo * 60 * 60 * 1000);
      demoEvents.push({
        id: `demo-${hoursAgo}`,
        shop: session.shop,
        shopifyId: productId,
        topic,
        author,
        message,
        diff,
        timestamp: ts,
        webhookId: null,
      });
    };

    // Screenshot-ready demo storyline:
    // 1) A clear product price change (Pink Snowboard) – used for product drilldown screenshot
    // 2) A description change with obvious before/after (Blue Snowboard) – used for diff screenshot
    // 3) An inventory event (noise) and an order for realism

    // Scenario 1: Price increase on Pink Snowboard (6 hours ago)
    addDemoEvent(
      6,
      "Sarah Chen",
      "1001",
      'Sarah Chen updated "Pink Snowboard"',
      "products/update",
      JSON.stringify({
        changes: [{ field: "price", label: "Price", old: "$99.00", new: "$129.00" }],
      })
    );

    // Scenario 2: Description update on Blue Snowboard (4 hours ago)
    addDemoEvent(
      4,
      "Marcus Johnson",
      "1002",
      'Marcus Johnson updated "Blue Snowboard"',
      "products/update",
      JSON.stringify({
        changes: [
          {
            field: "description",
            label: "Description",
            old: "A basic snowboard for beginners. Durable, affordable, and simple.",
            new: "A premium all-mountain snowboard with better edge hold, smoother turns, and faster base.",
          },
        ],
      })
    );

    // Scenario 3: Inventory movement (2 hours ago) – noise
    addDemoEvent(
      2,
      "Inventory Sync",
      "1001",
      'Inventory Sync updated "Pink Snowboard"',
      "inventory_levels/update",
      JSON.stringify({
        inventoryChange: { old: 42, new: 18 },
        available: 18,
      })
    );

    // Scenario 4: Recent Order (30 mins ago)
    addDemoEvent(0.5, "System", "0", '💰 Order #1042 - $148.29', "orders/create", JSON.stringify({
      total: "148.29",
      itemCount: 2,
      itemSummary: "2 items"
    }));

    // Merge with any real events (optional, but prioritize demo ones for the story)
    // We sort by timestamp descending
    displayedEvents = [...demoEvents, ...events].sort((a, b) => 
      new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );
  } else {
    displayedEvents = events;
  }

  // Calculate KPIs
  const totalSales = salesData.reduce((sum, d) => sum + d.sales, 0);
  const totalEvents = displayedEvents.length;

  // Get sync status for first-time users
  const syncStatus = await getSyncStatus(session.shop);

  // IMPORTANT: the UI should always render the *same* events array that we use for KPIs.
  // In demo mode we merge synthetic + real events so the chart and timeline stay in sync.
  return {
    events: displayedEvents,
    salesData,
    shop: session.shop,
    range: effectiveRange,
    totalSales,
    totalEvents,
    isDemo,
    isPro,
    syncStatus,
  };
};

// Helper to get initials from author name
function getInitials(name: string | null): string {
  if (!name || name === "System/App") return "S";
  const parts = name.trim().split(" ");
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

// Helper to format time for timeline
function formatTime(date: Date): string {
  return new Date(date).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}

// Helper to format relative time
function formatTimeAgo(date: Date): string {
  const now = new Date();
  const timestamp = new Date(date);
  const seconds = Math.floor((now.getTime() - timestamp.getTime()) / 1000);

  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

// Helper to get badge color
function getBadgeStyle(topic: string): { bg: string; color: string; label: string } {
  const lowerTopic = topic.toLowerCase();
  // Orders are the most important - they represent money!
  if (lowerTopic.includes("orders_create") || lowerTopic.includes("orders/create")) {
    return { bg: "#d4edda", color: "#155724", label: "💰 Sale" };
  }
  if (lowerTopic.includes("inventory")) return { bg: "#e0f0ff", color: "#0070f3", label: "Inventory" };
  if (lowerTopic.includes("collection") && lowerTopic.includes("create")) return { bg: "#e8f5e9", color: "#2e7d32", label: "Collection Created" };
  if (lowerTopic.includes("collection") && lowerTopic.includes("update")) return { bg: "#e3f2fd", color: "#1565c0", label: "Collection Updated" };
  if (lowerTopic.includes("collection") && lowerTopic.includes("delete")) return { bg: "#ffebee", color: "#c62828", label: "Collection Deleted" };
  if (lowerTopic.includes("create")) return { bg: "#e3f1df", color: "#008060", label: "Created" };
  if (lowerTopic.includes("update")) return { bg: "#fff3cd", color: "#8a6d3b", label: "Updated" };
  if (lowerTopic.includes("delete")) return { bg: "#fbeae5", color: "#d82c0d", label: "Deleted" };
  return { bg: "#f4f6f8", color: "#637381", label: "Event" };
}

// Interface for parsed change
interface ParsedChange {
  field: string;
  label: string;
  old?: string | number;
  new?: string | number;
}

// Minimal product snapshot shape stored inside EventLog.diff.snapshot (see `jobProcessor.server.ts`)
type ProductSnapshotClient = {
  title?: string;
  description?: string | null;
  variants?: Array<{
    id?: number;
    title?: string;
    price?: string;
    compareAtPrice?: string | null;
    inventory?: number;
    sku?: string | null;
  }>;
};

// Helper to strip HTML tags and clean up text
function stripHtml(text: string | number | undefined | null): string {
  if (text === undefined || text === null) return "";
  const str = String(text);
  return str.replace(/<\/?[^>]+(>|$)/g, "").trim();
}

// Helper to truncate long text
function truncate(text: string, maxLength: number = 40): string {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength) + "...";
}

function snapshotFromDiff(diff: string | null): ProductSnapshotClient | null {
  if (!diff) return null;
  try {
    const parsed = JSON.parse(diff);
    return parsed?.snapshot ?? null;
  } catch {
    return null;
  }
}

function computeProductChangesFromSnapshots(
  oldSnap: ProductSnapshotClient | null,
  newSnap: ProductSnapshotClient | null
): ParsedChange[] {
  if (!oldSnap || !newSnap) return [];
  const changes: ParsedChange[] = [];

  const oldTitle = oldSnap.title ?? "";
  const newTitle = newSnap.title ?? "";
  if (oldTitle && newTitle && oldTitle !== newTitle) {
    changes.push({ field: "title", label: "Title", old: oldTitle, new: newTitle });
  }

  const oldDescRaw = oldSnap.description ?? "";
  const newDescRaw = newSnap.description ?? "";
  if (oldDescRaw !== newDescRaw) {
    changes.push({
      field: "description",
      label: "Description",
      old: truncate(stripHtml(oldDescRaw), 50) || "(empty)",
      new: truncate(stripHtml(newDescRaw), 50) || "(empty)",
    });
  }

  const oldVariants = oldSnap.variants ?? [];
  const newVariants = newSnap.variants ?? [];
  const keyFor = (v: any, idx: number) => (typeof v?.id === "number" ? `id:${v.id}` : `idx:${idx}`);
  const oldByKey = new Map<string, any>();
  oldVariants.forEach((v, idx) => oldByKey.set(keyFor(v, idx), v));

  const priceChanges: Array<{ old: string; new: string; title?: string }> = [];
  newVariants.forEach((v, idx) => {
    const k = keyFor(v, idx);
    const ov = oldByKey.get(k);
    const oldPrice = ov?.price;
    const newPrice = v?.price;
    if (typeof oldPrice === "string" && typeof newPrice === "string" && oldPrice !== newPrice) {
      priceChanges.push({ old: `$${oldPrice}`, new: `$${newPrice}`, title: v?.title });
    }
  });

  if (priceChanges.length === 1) {
    const c = priceChanges[0];
    changes.push({ field: "price", label: "Price", old: c.old, new: c.new });
  } else if (priceChanges.length > 1) {
    // Avoid spamming if many variants changed; show a clear summary.
    changes.push({
      field: "price",
      label: "Prices",
      old: `${priceChanges.length} variants`,
      new: "updated",
    });
  }

  // Sort in a consistent priority order for readability.
  const priorityFields = ["price", "title", "description", "inventory", "status", "images"];
  return changes.sort((a, b) => {
    const aIdx = priorityFields.indexOf(a.field);
    const bIdx = priorityFields.indexOf(b.field);
    return (aIdx === -1 ? 99 : aIdx) - (bIdx === -1 ? 99 : bIdx);
  });
}

// Helper to parse diff JSON into structured changes
function parseDiffChanges(diff: string | null): ParsedChange[] | null {
  if (!diff) return null;
  try {
    const parsed = JSON.parse(diff);

    // New format with changes array
    if (parsed.changes && Array.isArray(parsed.changes)) {
      if (parsed.changes.length === 0) return null;

      // Sort by priority
      const priorityFields = ["price", "inventory", "title", "status", "images", "description"];
      return [...parsed.changes].sort((a, b) => {
        const aIdx = priorityFields.indexOf(a.field);
        const bIdx = priorityFields.indexOf(b.field);
        return (aIdx === -1 ? 99 : aIdx) - (bIdx === -1 ? 99 : bIdx);
      });
    }

    // Legacy format (backwards compatible)
    const changes: ParsedChange[] = [];
    if (parsed.priceChange) {
      changes.push({
        field: "price",
        label: "Price",
        old: `$${parsed.priceChange.old}`,
        new: `$${parsed.priceChange.new}`,
      });
    }
    if (parsed.inventoryChange) {
      changes.push({
        field: "inventory",
        label: "Stock",
        old: parsed.inventoryChange.old,
        new: parsed.inventoryChange.new,
      });
    }
    return changes.length > 0 ? changes : null;
  } catch {
    return null;
  }
}

// Component to render clean, structured diff cards
function DiffViewer({ changes }: { changes: ParsedChange[] }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "4px", marginTop: "6px" }}>
      {changes.map((change, index) => {
        const oldValue = truncate(stripHtml(change.old));
        const newValue = truncate(stripHtml(change.new));
        const hasValues = change.old !== undefined && change.new !== undefined;

        return (
          <div
            key={index}
            style={{
              display: "flex",
              alignItems: "baseline",
              fontSize: "12px",
              gap: "8px",
            }}
          >
            {/* Field Name */}
            <span
              style={{
                color: "#637381",
                fontWeight: "500",
                minWidth: "70px",
                flexShrink: 0,
              }}
            >
              {change.label}
            </span>

            {/* Values */}
            {hasValues ? (
              <div style={{ display: "flex", alignItems: "baseline", gap: "6px", flexWrap: "wrap" }}>
                <span
                  style={{
                    textDecoration: "line-through",
                    color: "#8c9196",
                  }}
                >
                  {oldValue}
                </span>
                <span style={{ color: "#919eab" }}>→</span>
                <span
                  style={{
                    fontWeight: "600",
                    color: "#1a1a1a",
                    backgroundColor: "#e3f1df",
                    padding: "1px 6px",
                    borderRadius: "4px",
                  }}
                >
                  {newValue}
                </span>
              </div>
            ) : (
              <span style={{ color: "#637381" }}>{change.label}</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

// Extract item name from message (product or collection)
function getItemName(message: string, topic: string): string {
  // For orders, extract the order name and amount from the message
  // Message format: "💰 Order #1001 - $100.00"
  if (topic.toLowerCase().includes("orders")) {
    const orderMatch = message.match(/Order\s+(#\d+)\s*-\s*(\$[\d,.]+)/);
    if (orderMatch) {
      return `${orderMatch[1]} (${orderMatch[2]})`;
    }
    // Fallback: just extract order number
    const numMatch = message.match(/#\d+/);
    return numMatch ? numMatch[0] : "Order";
  }

  // For other events, look for text in quotes
  const match = message.match(/"([^"]+)"/);
  return match ? match[1] : "Unknown";
}

// Extract action from message
function getAction(message: string, topic: string): string {
  // Orders are "placed", not "created" or "updated"
  if (topic.toLowerCase().includes("orders")) return "placed";
  if (topic.includes("delete")) return "deleted";
  if (topic.includes("create")) return "created";
  return "updated";
}

// Get item type from topic
function getItemType(topic: string): string {
  if (topic.includes("orders")) return "order";
  if (topic.includes("collection")) return "collection";
  if (topic.includes("inventory")) return "inventory for";
  return "product";
}

export default function Dashboard() {
  const { events, salesData, range, totalSales, totalEvents, isDemo, isPro, syncStatus } = useLoaderData<typeof loader>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const revalidator = useRevalidator();
  const productSalesFetcher = useFetcher<{
    productId: string;
    bucketType: "hour" | "day";
    currency: string | null;
    isComplete: boolean;
    completenessNote?: string;
    points: Array<{ timestamp: number; revenue: number; units: number }>;
  }>();
  const productImpactFetcher = useFetcher<{
    productId: string;
    currency: string | null;
    immediate: {
      windowHours: number;
      currentRevenuePerHour: number;
      typicalRevenuePerHour: number | null;
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
  }>();
  const [hoveredEventId, setHoveredEventId] = useState<string | null>(null);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [highlightedEventId, setHighlightedEventId] = useState<string | null>(null);
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const timelineRef = useRef<HTMLDivElement>(null);
  const lastChartTimestampRef = useRef<number | null>(null);
  const chartWrapperRef = useRef<HTMLDivElement>(null);

  const [dayPicker, setDayPicker] = useState<{
    dayStartTs: number;
    anchorX: number;
    anchorY: number;
    eventIds: string[];
  } | null>(null);
  const [dayPickerQuery, setDayPickerQuery] = useState("");

  const dayStartLocal = useCallback((ts: number) => {
    const d = new Date(ts);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0).getTime();
  }, []);

  // Make `?resync=1` a one-shot trigger: once the request has been made, remove it from the URL.
  // Otherwise our auto-revalidation would keep re-triggering sync repeatedly.
  useEffect(() => {
    if (!searchParams.get("resync")) return;
    const params = new URLSearchParams(searchParams);
    params.delete("resync");
    navigate(`?${params.toString()}`, { replace: true });
  }, [searchParams, navigate]);

  // While sync is running, auto-refresh the loader so progress updates without manual reloads.
  useEffect(() => {
    if (syncStatus.status !== "syncing" && syncStatus.status !== "not_started") return;
    const id = setInterval(() => {
      if (revalidator.state === "idle") revalidator.revalidate();
    }, 2500);
    return () => clearInterval(id);
  }, [syncStatus.status, revalidator]);

  // Active event is either selected (clicked) or hovered
  const activeEventId = selectedEventId || hoveredEventId;

  // Scroll to and highlight an event in the timeline
  const scrollToEvent = useCallback((eventId: string) => {
    const element = document.getElementById(`event-${eventId}`);
    const container = timelineRef.current;
    if (element && container) {
      // Always set selection/highlight first so clicks never feel "dead" even if scrolling fails.
      setHighlightedEventId(eventId);
      setSelectedEventId(eventId);
      setTimeout(() => setHighlightedEventId(null), 2000);

      // Prefer scrolling the timeline container directly.
      // In embedded apps with outer overflow hidden, scrollIntoView can behave inconsistently.
      const containerRect = container.getBoundingClientRect();
      const elementRect = element.getBoundingClientRect();
      const currentScrollTop = container.scrollTop;
      const elementOffsetWithinContainer = (elementRect.top - containerRect.top) + currentScrollTop;
      const targetScrollTop = Math.max(
        0,
        elementOffsetWithinContainer - (container.clientHeight / 2) + (elementRect.height / 2)
      );

      try {
        // Some embedded browser contexts can throw on smooth scroll options.
        container.scrollTo({ top: targetScrollTop, behavior: "smooth" });
      } catch {
        container.scrollTop = targetScrollTop;
      }
      return;
    }

    // Fallback (should be rare)
    if (element) {
      element.scrollIntoView({ behavior: "smooth", block: "center" });
      setHighlightedEventId(eventId);
      setSelectedEventId(eventId);
      setTimeout(() => setHighlightedEventId(null), 2000);
    }
  }, []);

  // Handle click on chart to find and scroll to nearest event
  const extractChartTimestamp = useCallback((maybeState: any): number | null => {
    if (!maybeState) return null;
    const tsFromPayload = maybeState?.activePayload?.[0]?.payload?.timestamp;
    if (typeof tsFromPayload === "number") return tsFromPayload;
    const idx = maybeState?.activeTooltipIndex;
    if (typeof idx === "number" && idx >= 0 && idx < (salesData as SalesDataPoint[]).length) {
      const ts = (salesData as SalesDataPoint[])[idx]?.timestamp;
      return typeof ts === "number" ? ts : null;
    }
    const label = maybeState?.activeLabel;
    if (typeof label === "number") return label;
    if (typeof label === "string") {
      const ts = (salesData as SalesDataPoint[]).find((d) => d.hour === label)?.timestamp;
      return typeof ts === "number" ? ts : null;
    }

    // Fallback: if Recharts didn't resolve an active point (common when clicking the line, not the dot),
    // derive a timestamp from the cursor X position using the x-axis scale.
    const chartX = maybeState?.activeCoordinate?.x ?? maybeState?.chartX;
    const xAxisMap = maybeState?.xAxisMap;
    const firstAxis: any = xAxisMap ? Object.values(xAxisMap)[0] : null;
    const scale: any = firstAxis?.scale;
    if (typeof chartX === "number" && scale && typeof scale.invert === "function") {
      const inverted = scale.invert(chartX);
      const ts = typeof inverted === "number" ? inverted : Number(inverted);
      return Number.isFinite(ts) ? ts : null;
    }

    return null;
  }, [salesData]);

  // Determine time window for matching events to chart data points
  // For daily views (7d/30d/90d), use 24-hour window; for hourly views (today/yesterday), use 1-hour window
  const isHourlyView = range === "today" || range === "yesterday";
  const matchThreshold = isHourlyView ? 60 * 60 * 1000 : 24 * 60 * 60 * 1000; // 1 hour or 24 hours in ms

  const handleChartInteraction = useCallback((maybeState: any, maybeEvent?: any) => {
    // Recharts passes different args across versions:
    // - (state) or (state, event) or (event, state)
    const state =
      maybeState?.activePayload || maybeState?.activeTooltipIndex !== undefined || maybeState?.activeLabel
        ? maybeState
        : maybeEvent;
    const ts = extractChartTimestamp(state);
    if (typeof ts === "number") lastChartTimestampRef.current = ts;
  }, [extractChartTimestamp]);

  const handleChartClick = useCallback((a: any, b?: any) => {
    // Try to extract from either arg (Recharts versions differ).
    const tsA = extractChartTimestamp(a);
    const tsB = extractChartTimestamp(b);
    const clickedTimestamp = tsA ?? tsB ?? lastChartTimestampRef.current;

    if (!clickedTimestamp) return;

    // Daily views: a click can correspond to MANY events on the same day.
    // Instead of guessing "which one", show a picker overlay when > 1.
    if (!isHourlyView) {
      const clickedDay = dayStartLocal(clickedTimestamp);
      const dayEvents = (events as EventLog[])
        .filter((e) => dayStartLocal(new Date(e.timestamp).getTime()) === clickedDay)
        .sort((x, y) => new Date(y.timestamp).getTime() - new Date(x.timestamp).getTime());

      if (dayEvents.length > 1) {
        const coord =
          a?.activeCoordinate ??
          b?.activeCoordinate ??
          a?.chartX?.x ??
          b?.chartX?.x ??
          null;
        const x = (a?.activeCoordinate?.x ?? b?.activeCoordinate?.x) as number | undefined;
        const y = (a?.activeCoordinate?.y ?? b?.activeCoordinate?.y) as number | undefined;
        const fallbackX = typeof (a?.chartX) === "number" ? a.chartX : (typeof (b?.chartX) === "number" ? b.chartX : undefined);
        const fallbackY = typeof (a?.chartY) === "number" ? a.chartY : (typeof (b?.chartY) === "number" ? b.chartY : undefined);

        const wrapperRect = chartWrapperRef.current?.getBoundingClientRect();
        const anchorX = wrapperRect ? ((x ?? fallbackX ?? wrapperRect.width / 2) - 0) : 320;
        const anchorY = wrapperRect ? ((y ?? fallbackY ?? 24) - 0) : 24;

        setDayPickerQuery("");
        setDayPicker({
          dayStartTs: clickedDay,
          anchorX,
          anchorY,
          eventIds: dayEvents.map((e) => e.id),
        });
        return;
      }
      // If only 0/1 event on that day, fall through to normal nearest-event behavior.
    }

    // Reverted: keep matching sane. If there isn't an event near that bucket, do nothing.
    const threshold = matchThreshold;

    // First try: strategic events (priority)
    // Filter out "noise" to prioritize meaningful clicks
    const strategicEvents = (events as EventLog[]).filter(e =>
      isStrategicEvent(e.topic, e.diff)
    );
    
    // Second try: all events (fallback)
    const allEvents = (events as EventLog[]);

    let closestEvent: EventLog | null = null;
    let closestDistance = Infinity;

    // Try finding closest strategic event first
    for (const event of strategicEvents) {
      const eventTime = new Date(event.timestamp).getTime();
      const distance = Math.abs(eventTime - clickedTimestamp);
      if (distance < threshold && distance < closestDistance) {
        closestDistance = distance;
        closestEvent = event;
      }
    }

    // If no strategic event found within threshold, try ANY event
    // This ensures that if a user clicks *exactly* on a spike that is just inventory, 
    // we still show it rather than doing nothing.
    if (!closestEvent) {
      closestDistance = Infinity;
      for (const event of allEvents) {
        const eventTime = new Date(event.timestamp).getTime();
        const distance = Math.abs(eventTime - clickedTimestamp);
        if (distance < threshold && distance < closestDistance) {
          closestDistance = distance;
          closestEvent = event;
        }
      }
    }

    if (closestEvent) {
      scrollToEvent(closestEvent.id);
    }
  }, [events, scrollToEvent, extractChartTimestamp, isHourlyView, dayStartLocal, matchThreshold]);

  // Format chart times client-side using timestamps to ensure timezone consistency
  // This fixes the discrepancy where server-formatted times could differ from browser timezone
  const formattedSalesData = useMemo(() => {
    return salesData.map((d) => ({
      ...d,
      hour: formatChartTime(d.timestamp, isHourlyView),
    }));
  }, [salesData, isHourlyView]);

  // Compute robust product diffs from snapshots (so multi-field edits show ALL changes even if server diff was incomplete).
  const computedProductDiffByEventId = useMemo(() => {
    const map = new Map<string, ParsedChange[]>();
    const lastSnapshotByProductId = new Map<string, ProductSnapshotClient>();

    // Events are newest -> oldest. Iterate oldest -> newest to compute incremental diffs.
    const list = events as EventLog[];
    for (let i = list.length - 1; i >= 0; i--) {
      const e = list[i];
      if (!e?.topic?.toLowerCase().includes("products/")) continue;
      if (!e.shopifyId) continue;
      const snap = snapshotFromDiff(e.diff);
      if (!snap) continue;
      const prev = lastSnapshotByProductId.get(e.shopifyId) ?? null;
      const computed = computeProductChangesFromSnapshots(prev, snap);
      if (computed.length) map.set(e.id, computed);
      lastSnapshotByProductId.set(e.shopifyId, snap);
    }
    return map;
  }, [events]);

  const activeEvent = useMemo(() => {
    if (!activeEventId) return null;
    return (events as EventLog[]).find((e) => e.id === activeEventId) || null;
  }, [activeEventId, events]);

  const selectedEvent = useMemo(() => {
    if (!selectedEventId) return null;
    return (events as EventLog[]).find((e) => e.id === selectedEventId) || null;
  }, [selectedEventId, events]);

  // Fetch product-level series when the user intentionally selects a product event.
  useEffect(() => {
    const e = selectedEvent;
    if (!e) return;
    const isProductEvent = e.topic.toLowerCase().includes("products/");
    if (!isProductEvent) return;
    if (!e.shopifyId) return;
    // Only fetch product-level series for real Shopify numeric product IDs
    // In demo mode we use numeric IDs too, but still gate non-numeric for safety.
    if (!/^\d+$/.test(e.shopifyId)) return;

    // Avoid refetch loops if we already have the series for this product.
    if (productSalesFetcher.data?.productId === e.shopifyId) return;

    productSalesFetcher.load(
      `/api/product-sales?productId=${encodeURIComponent(e.shopifyId)}&range=${encodeURIComponent(range)}${isDemo ? "&demo=true" : ""}`
    );
  }, [selectedEvent, range, productSalesFetcher]);

  // Fetch product impact verdict: "Sales velocity" (panic check + growth check).
  useEffect(() => {
    const e = selectedEvent;
    if (!e) return;
    const isProductEvent = e.topic.toLowerCase().includes("products/");
    if (!isProductEvent) return;
    if (!e.shopifyId) return;
    if (!/^\d+$/.test(e.shopifyId)) return;
    const ts = new Date(e.timestamp).getTime();
    productImpactFetcher.load(
      `/api/product-impact?productId=${encodeURIComponent(e.shopifyId)}&eventTs=${encodeURIComponent(String(ts))}${isDemo ? "&demo=true" : ""}`
    );
  }, [selectedEvent, productImpactFetcher, isDemo]);

  const productSalesData: SalesDataPoint[] | null = useMemo(() => {
    if (!productSalesFetcher.data?.points?.length) return null;
    return productSalesFetcher.data.points.map((p) => ({
      hour: formatChartTime(p.timestamp, isHourlyView),
      sales: p.revenue,
      timestamp: p.timestamp,
    }));
  }, [productSalesFetcher.data, isHourlyView]);

  const productSeriesPoints: ProductSeriesPoint[] | null = useMemo(() => {
    const pts = productSalesFetcher.data?.points;
    if (!pts?.length) return null;
    return pts.map((p: any) => ({
      timestamp: Number(p.timestamp),
      revenue: Number(p.revenue ?? 0),
      units: Number(p.units ?? 0),
    }));
  }, [productSalesFetcher.data]);

  const hasProductSales = useMemo(() => {
    const pts = productSalesFetcher.data?.points;
    if (!pts?.length) return false;
    return pts.some((p) => (p.revenue ?? 0) > 0 || (p.units ?? 0) > 0);
  }, [productSalesFetcher.data]);

  // Use product-level series when available and the active event is a product event.
  const impactSalesSeries = useMemo(() => {
    const e = activeEvent;
    if (!e) return salesData;
    const isProductEvent = e.topic.toLowerCase().includes("products/");
    if (isProductEvent && productSalesData) return productSalesData;
    return salesData;
  }, [activeEvent, productSalesData, salesData]);

  const isProductSeriesActive = useMemo(() => {
    const e = activeEvent;
    if (!e) return false;
    const isProductEvent = e.topic.toLowerCase().includes("products/");
    return isProductEvent && !!productSalesData;
  }, [activeEvent, productSalesData]);

  // Check if an event is a "strategic" event that warrants impact analysis
  // Strategic: Price changes, title updates, description edits - things merchants DECIDE to do
  // Consequential: Inventory updates, orders - these are RESULTS of sales, not causes
  const isStrategicEvent = (topic: string, diff: string | null): boolean => {
    const lowerTopic = topic.toLowerCase();

    // Orders are strategic for click/select purposes (they're meaningful and should be navigable).
    if (lowerTopic.includes("orders")) return true;

    // Skip inventory updates - these are consequences, not causes
    if (lowerTopic.includes("inventory")) return false;

    // For product updates, check if it's just a stock change (not strategic)
    // vs. an actual attribute change like price/title (strategic)
    if (lowerTopic.includes("products") && diff) {
      try {
        const diffData = JSON.parse(diff);
        const changes = diffData.changes || [];
        // If the only change is inventory/stock, it's not strategic
        if (changes.length > 0) {
          const hasNonStockChange = changes.some(
            (c: { field: string }) => c.field !== "inventory" && c.field !== "stock"
          );
          if (!hasNonStockChange) return false;
        }
      } catch {
        // If we can't parse diff, assume it's strategic
      }
    }

    return true;
  };

  const impactEvidence = useMemo(() => {
    const e = activeEvent;
    if (!e) return null;
    if (!e.topic.toLowerCase().includes("products/")) return null;
    if (!productSeriesPoints?.length) return null;
    if (!isStrategicEvent(e.topic, e.diff)) return null;

    const eventTime = new Date(e.timestamp).getTime();
    const idx = productSeriesPoints.findIndex((p) => Math.abs(p.timestamp - eventTime) < matchThreshold);
    if (idx === -1) return null;

    const windowBuckets = isHourlyView ? 2 : 3;
    const preStart = Math.max(0, idx - windowBuckets);
    const preEnd = idx; // exclusive
    const postStart = idx + 1;
    const postEnd = Math.min(productSeriesPoints.length, idx + 1 + windowBuckets);

    const pre = productSeriesPoints.slice(preStart, preEnd);
    const post = productSeriesPoints.slice(postStart, postEnd);

    const sum = (arr: ProductSeriesPoint[], key: "revenue" | "units") => arr.reduce((s, p) => s + (p[key] ?? 0), 0);
    const preRevenue = sum(pre, "revenue");
    const postRevenue = sum(post, "revenue");
    const preUnits = sum(pre, "units");
    const postUnits = sum(post, "units");

    const revenueDelta = postRevenue - preRevenue;
    const unitsDelta = postUnits - preUnits;

    // Confidence heuristics:
    // - Need at least 1 post bucket
    // - Low sample if units are tiny
    const postBuckets = post.length;
    const totalUnits = preUnits + postUnits;
    const confidence =
      postBuckets < 1 ? "low" : totalUnits < 2 ? "low" : totalUnits < 5 ? "medium" : "high";

    const note =
      postBuckets < 1
        ? "Waiting for post-change sales data."
        : totalUnits < 2
          ? "Low sample size (few purchases)."
          : totalUnits < 5
            ? "Some signal, but still a small sample."
            : "Good sample size for a directional read.";

    return {
      windowLabel: isHourlyView ? "Last 2 hours vs next 2 hours" : "Prev 3 days vs next 3 days",
      preRevenue,
      postRevenue,
      revenueDelta,
      preUnits,
      postUnits,
      unitsDelta,
      confidence,
      note,
    };
  }, [activeEvent, productSeriesPoints, isHourlyView, matchThreshold]);

  // Extract story context from an event for business narrative
  const extractStoryContext = (event: EventLog): ImpactAnalysis["storyContext"] | undefined => {
    const authorName = event.author || "Someone";
    const productName = getItemName(event.message, event.topic);

    // Try to parse the diff for specific change details
    if (event.diff) {
      try {
        const diffData = JSON.parse(event.diff);
        const changes = diffData.changes || [];
        if (changes.length > 0) {
          const primaryChange = changes[0];
          const changeType = primaryChange.field || "attribute";
          const oldVal = stripHtml(primaryChange.old);
          const newVal = stripHtml(primaryChange.new);
          const changeDescription = oldVal && newVal
            ? `changed ${primaryChange.label || changeType} from ${oldVal} to ${newVal}`
            : `updated ${primaryChange.label || changeType}`;
          return { authorName, changeType, changeDescription, productName };
        }
      } catch {
        // Ignore parse errors
      }
    }

    // Fallback based on topic
    const action = event.topic.includes("create") ? "created" : event.topic.includes("delete") ? "deleted" : "updated";
    return {
      authorName,
      changeType: "product",
      changeDescription: `${action} "${productName}"`,
      productName,
    };
  };

  const impactAnalysis = useMemo((): ImpactAnalysis | null => {
    if (!activeEvent || impactSalesSeries.length < 4) return null;

    // Only show impact for STRATEGIC events (merchant decisions)
    // Skip CONSEQUENTIAL events (inventory drops, orders, stock-only changes)
    if (!isStrategicEvent(activeEvent.topic, activeEvent.diff)) return null;

    const eventTime = new Date(activeEvent.timestamp).getTime();
    const eventIndex = impactSalesSeries.findIndex(
      (d) => Math.abs(d.timestamp - eventTime) < matchThreshold
    );

    if (eventIndex === -1) return null;

    // Guardrail: if the user *just* made a change, we usually don't have any post-change buckets yet.
    // Showing "sales dropped X%" in the first minutes after a change is misleading.
    // For hourly views, require at least 1 full hour after the event time before we compute "immediate impact".
    if (isHourlyView) {
      const ONE_HOUR_MS = 60 * 60 * 1000;
      const nowMs = Date.now();
      const hasAtLeastOnePostBucket = eventIndex + 1 < impactSalesSeries.length;
      if (!hasAtLeastOnePostBucket || nowMs - eventTime < ONE_HOUR_MS) {
        return null;
      }
    }

    // Helper to calculate average sales over a window
    const calcAvgSales = (startIdx: number, count: number): number => {
      let sum = 0;
      let validCount = 0;
      for (let i = 0; i < count; i++) {
        const idx = startIdx + i;
        if (idx >= 0 && idx < impactSalesSeries.length) {
          sum += impactSalesSeries[idx].sales;
          validCount++;
        }
      }
      return validCount > 0 ? sum / validCount : 0;
    };

    // --- IMMEDIATE IMPACT (2-4 hour window) ---
    const shortWindow = 2;
    const postSalesImmediate = calcAvgSales(eventIndex + 1, shortWindow);
    const preSalesImmediate = calcAvgSales(eventIndex - shortWindow, shortWindow);

    // --- ORDERS EXCEPTION ---
    // For orders, we just want to show the order itself, not a "change analysis"
    // An order is a result, not a cause. 
    if (activeEvent.topic.toLowerCase().includes("orders")) {
      return null; // Let the fallback renderer handle orders
    }

    // --- SUSTAINED TREND (7-day window, if available) ---
    // For longer timeframes (7d/30d/90d), check if daily averages shifted
    const longWindow = Math.min(7, Math.floor(impactSalesSeries.length / 3)); // At least 7 data points
    const postSalesLong = calcAvgSales(eventIndex + 1, longWindow);
    const preSalesLong = calcAvgSales(Math.max(0, eventIndex - longWindow), longWindow);

    // --- SMART BASELINE: Week-over-Week comparison if available ---
    const oneWeekMs = 7 * 24 * 60 * 60 * 1000;
    const refTime = eventTime - oneWeekMs;
    const refIndex = impactSalesSeries.findIndex(
      (d) => Math.abs(d.timestamp - refTime) < matchThreshold
    );
    const weekAgoSales = refIndex !== -1 ? calcAvgSales(refIndex, shortWindow) : null;

    // --- DECIDE WHICH STORY TO TELL (DUAL-WINDOW INTELLIGENCE) ---
    // Rule: Check immediate impact first. If negligible, check 7-day trend (sustained).
    
    let analysisType: "immediate" | "sustained" | "none" = "immediate";
    let baselineSales: number;
    let postSales: number;
    let isSmartBaseline = false;

    // Safety checks for NaN
    const safePreSalesImmediate = isNaN(preSalesImmediate) ? 0 : preSalesImmediate;
    const safePostSalesImmediate = isNaN(postSalesImmediate) ? 0 : postSalesImmediate;
    const safePreSalesLong = isNaN(preSalesLong) ? 0 : preSalesLong;
    const safePostSalesLong = isNaN(postSalesLong) ? 0 : postSalesLong;

    const immediateDiff = Math.abs(safePostSalesImmediate - safePreSalesImmediate);
    const longTermDiff = Math.abs(safePostSalesLong - safePreSalesLong);
    
    // Check if we even HAVE long term data (index > 0)
    const hasLongTermData = eventIndex >= longWindow;

    // THE SMART DECISION:
    // If immediate change is small (< $5 or < 10%) but long term is significant, tell the Sustained story.
    // Otherwise, default to Immediate story (most common).
    if (immediateDiff < 5 && longTermDiff > 10 && hasLongTermData) {
       // Slow Burn: "No spike, but sales trended up over the week"
       analysisType = "sustained";
       baselineSales = safePreSalesLong;
       postSales = safePostSalesLong;
    } else if (weekAgoSales !== null && weekAgoSales > 0) {
      // Smart Baseline: "Sales vs same time last week"
      analysisType = "immediate";
      baselineSales = weekAgoSales;
      postSales = postSalesImmediate;
      isSmartBaseline = true;
    } else {
      // Standard: "Immediate spike vs previous 2 hours"
      analysisType = "immediate";
      baselineSales = safePreSalesImmediate;
      postSales = safePostSalesImmediate;
    }

    // CADENCE CHECK: If baseline is $0 AND post is $0, this is normal quiet time
    if (baselineSales < 1 && postSales < 1) {
      return null;
    }

    const diff = postSales - baselineSales;
    const isZeroBaseline = baselineSales < 1;

    // Calculate percent only if we have a baseline
    const percentChange = isZeroBaseline
      ? 0
      : Math.round((diff / baselineSales) * 100 * 10) / 10;

    // Build story context
    const storyContext = extractStoryContext(activeEvent);

    return {
      baselineSales: Math.round(baselineSales),
      postSales: Math.round(postSales),
      percentChange: Math.abs(percentChange),
      diff: Math.round(diff),
      isNegative: diff < 0,
      isZeroBaseline,
      isSmartBaseline,
      analysisType,
      storyContext,
    };
  }, [activeEvent, impactSalesSeries, matchThreshold]);

  const impactPendingMessage = useMemo(() => {
    if (!activeEvent) return null;
    if (!isHourlyView) return null;
    if (!isStrategicEvent(activeEvent.topic, activeEvent.diff)) return null;
    if (activeEvent.topic.toLowerCase().includes("orders")) return null;

    const eventTime = new Date(activeEvent.timestamp).getTime();
    const eventIndex = impactSalesSeries.findIndex(
      (d) => Math.abs(d.timestamp - eventTime) < matchThreshold
    );
    if (eventIndex === -1) return null;

    const ONE_HOUR_MS = 60 * 60 * 1000;
    const nowMs = Date.now();
    const hasAtLeastOnePostBucket = eventIndex + 1 < impactSalesSeries.length;
    if (!hasAtLeastOnePostBucket || nowMs - eventTime < ONE_HOUR_MS) {
      return "Measuring impact… (needs ~1 hour of post-change data)";
    }
    return null;
  }, [activeEvent, isHourlyView, impactSalesSeries, matchThreshold]);

  const activeEventX = useMemo(() => {
    if (!activeEvent) return null;
    const eventTime = new Date(activeEvent.timestamp).getTime();
    // For hourly views, show the *exact event minute*.
    // For daily views, snap to local midnight to match the daily buckets.
    if (isHourlyView) return eventTime;
    const d = new Date(eventTime);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0).getTime();
  }, [activeEvent, isHourlyView]);

  const eventTimestamps = (events as EventLog[]).map((e) => new Date(e.timestamp).getTime());
  const eventLineX = useCallback((ts: number): number => {
    if (isHourlyView) return ts;
    const d = new Date(ts);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0).getTime();
  }, [isHourlyView]);

  const dashedEventLineXs = useMemo(() => {
    if (isHourlyView) return eventTimestamps;
    const uniq = new Set<number>();
    for (const ts of eventTimestamps) uniq.add(dayStartLocal(ts));
    return Array.from(uniq.values()).sort((a, b) => a - b);
  }, [eventTimestamps, isHourlyView, dayStartLocal]);

  const dayPickerEvents = useMemo(() => {
    if (!dayPicker) return [];
    const byId = new Map((events as EventLog[]).map((e) => [e.id, e]));
    const list = dayPicker.eventIds.map((id) => byId.get(id)).filter(Boolean) as EventLog[];
    const q = dayPickerQuery.trim().toLowerCase();
    if (!q) return list;
    return list.filter((e) => {
      const hay = `${e.author ?? ""} ${e.topic ?? ""} ${e.message ?? ""}`.toLowerCase();
      return hay.includes(q);
    });
  }, [dayPicker, dayPickerQuery, events]);

  // Close the day picker on escape or outside click.
  useEffect(() => {
    if (!dayPicker) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDayPicker(null);
    };
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (target.closest?.("[data-day-picker]")) return;
      setDayPicker(null);
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("mousedown", onMouseDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("mousedown", onMouseDown);
    };
  }, [dayPicker]);

  // Pro-only ranges
  const PRO_RANGES: DateRange[] = ["7d", "30d", "90d"];

  const handleRangeChange = (newRange: DateRange) => {
    // If user clicks a Pro range but isn't Pro, show upgrade modal
    if (!isPro && PRO_RANGES.includes(newRange)) {
      setShowUpgradeModal(true);
      return;
    }

    const params = new URLSearchParams(searchParams);
    params.set("range", newRange);
    // Preserve demo mode when switching ranges
    if (isDemo) {
      params.set("demo", "true");
    }
    navigate(`?${params.toString()}`);
  };

  const rangeLabels: Record<DateRange, string> = {
    today: "Today",
    yesterday: "Yesterday",
    "7d": "Last 7 Days",
    "30d": "Last 30 Days",
    "90d": "Last 90 Days",
  };

  // Font stack matching Shopify Polaris
  const fontFamily = '-apple-system, BlinkMacSystemFont, "San Francisco", "Segoe UI", Roboto, "Helvetica Neue", sans-serif';

  return (
    <>
      <style>{`
        .recharts-wrapper, .recharts-surface, .recharts-wrapper svg {
          outline: none !important;
        }
        /* Kill the blue focus ring on click and interaction */
        *:focus {
          outline: none !important;
        }
        .recharts-wrapper {
          outline: none !important;
        }
        .recharts-surface {
          outline: none !important;
        }
      `}</style>
      <div
        style={{
          height: "100vh",
          display: "flex",
          flexDirection: "column",
          fontFamily,
          overflow: "hidden",
          backgroundColor: "#f6f6f7",
        }}
      >
      {/* Fixed Header */}
      <div style={{ padding: "16px 20px", flexShrink: 0 }}>
        <div style={{ maxWidth: "1400px", margin: "0 auto" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h1 style={{ fontSize: "20px", fontWeight: "600", margin: 0 }}>Dashboard</h1>
            <div style={{ display: "flex", gap: "4px", backgroundColor: "#fff", padding: "4px", borderRadius: "8px", border: "1px solid #e1e3e5" }}>
              {(["today", "yesterday", "7d", "30d", "90d"] as DateRange[]).map((r) => {
                const isLocked = !isPro && PRO_RANGES.includes(r);
                const label = r === "today" ? "Today" : r === "yesterday" ? "Yesterday" : r === "7d" ? "7D" : r === "30d" ? "30D" : "90D";
                return (
                  <button
                    key={r}
                    onClick={() => handleRangeChange(r)}
                    style={{
                      padding: "6px 12px",
                      borderRadius: "6px",
                      border: "none",
                      backgroundColor: range === r ? "#000" : "transparent",
                      color: range === r ? "#fff" : isLocked ? "#919eab" : "#637381",
                      cursor: "pointer",
                      fontSize: "13px",
                      fontWeight: range === r ? "500" : "400",
                      transition: "all 0.15s ease",
                      display: "flex",
                      alignItems: "center",
                      gap: "4px",
                    }}
                  >
                    {label}
                    {isLocked && <Lock size={10} />}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Sync Status Banner */}
      {(syncStatus.status === "syncing" || syncStatus.status === "not_started") && (
        <div
          style={{
            margin: "0 20px 12px",
            padding: "12px 16px",
            backgroundColor: "#e0f0ff",
            borderRadius: "8px",
            display: "flex",
            alignItems: "center",
            gap: "12px",
            maxWidth: "1200px",
            marginLeft: "auto",
            marginRight: "auto",
            width: "calc(100% - 40px)",
          }}
        >
          <RefreshCw
            size={18}
            color="#0070f3"
            style={{ animation: "spin 1s linear infinite" }}
          />
          <div>
            <div style={{ fontSize: "13px", fontWeight: "600", color: "#0070f3" }}>
              Setting up StoreGuard...
            </div>
            <div style={{ fontSize: "12px", color: "#637381" }}>
              {syncStatus.syncedProducts > 0
                ? `Syncing products (${syncStatus.syncedProducts} done)`
                : "Creating baseline snapshots for your products. This helps us track changes accurately."}
            </div>
          </div>
        </div>
      )}

      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @keyframes pulse-highlight {
          0% { background-color: #fff3cd; }
          50% { background-color: #ffe69c; }
          100% { background-color: #fff3cd; }
        }
      `}</style>

      {/* Main Content Area - Fixed layout, no page scroll */}
      <div style={{ flex: 1, overflow: "hidden", padding: "0 20px 20px", display: "flex", flexDirection: "column" }}>
        <div style={{ maxWidth: "1200px", margin: "0 auto", width: "100%", display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>

          {/* KPI Row - Fixed */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "12px", marginBottom: "12px", flexShrink: 0 }}>
            <div style={{ padding: "12px 16px", backgroundColor: "#fff", borderRadius: "10px", border: "1px solid #e1e3e5" }}>
              <div style={{ fontSize: "11px", color: "#637381", marginBottom: "2px" }}>Total Sales</div>
              <div style={{ fontSize: "20px", fontWeight: "600" }}>${totalSales.toLocaleString()}</div>
            </div>
            <div style={{ padding: "12px 16px", backgroundColor: "#fff", borderRadius: "10px", border: "1px solid #e1e3e5" }}>
              <div style={{ fontSize: "11px", color: "#637381", marginBottom: "2px" }}>Store Changes</div>
              <div style={{ fontSize: "20px", fontWeight: "600" }}>{totalEvents}</div>
            </div>
            <div style={{ padding: "12px 16px", backgroundColor: "#fff", borderRadius: "10px", border: "1px solid #e1e3e5" }}>
              <div style={{ fontSize: "11px", color: "#637381", marginBottom: "2px" }}>Avg / Change</div>
              <div style={{ fontSize: "20px", fontWeight: "600" }}>
                ${totalEvents > 0 ? Math.round(totalSales / totalEvents).toLocaleString() : "0"}
              </div>
            </div>
          </div>

            {/* Main Stage */}
            <div style={{ backgroundColor: "#fff", borderRadius: "10px", border: "1px solid #e1e3e5", padding: "12px 16px", marginBottom: "12px", flexShrink: 0 }}>
                <div style={{ fontSize: "13px", fontWeight: "600", marginBottom: "8px" }}>Sales & Events</div>
                <div ref={chartWrapperRef} style={{ height: "140px", userSelect: "none", cursor: "pointer", outline: "none", position: "relative" }}>
                  <ResponsiveContainer width="100%" height="100%" style={{ outline: "none" }}>
                  <AreaChart
                    data={formattedSalesData}
                    onClick={handleChartClick}
                    onMouseMove={handleChartInteraction}
                    onMouseDown={handleChartInteraction}
                    onTouchStart={handleChartInteraction}
                  >
                    <defs>
                      <linearGradient id="salesGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={impactAnalysis?.isNegative ? "#d82c0d" : "#008060"} stopOpacity={0.3} />
                        <stop offset="95%" stopColor={impactAnalysis?.isNegative ? "#d82c0d" : "#008060"} stopOpacity={0.05} />
                      </linearGradient>
                    </defs>
                    <XAxis
                      dataKey="timestamp"
                      type="number"
                      domain={["dataMin", "dataMax"]}
                      tick={{ fontSize: 10 }}
                      tickLine={false}
                      axisLine={{ stroke: "#e1e3e5" }}
                      tickFormatter={(v) => formatChartTime(Number(v), isHourlyView)}
                    />
                    <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `$${v}`} width={50} tickLine={false} axisLine={false} />
                    <Tooltip content={<CustomTooltip isHourly={isHourlyView} valueLabel="Revenue" />} cursor={{ stroke: "#e1e3e5", strokeWidth: 1 }} />
                    <Area
                      type="monotone"
                      dataKey="sales"
                      stroke={impactAnalysis?.isNegative ? "#d82c0d" : "#008060"}
                      fill="url(#salesGradient)"
                      strokeWidth={2}
                    />
                    {activeEventX && (
                      <ReferenceLine x={activeEventX} stroke="#000" strokeWidth={2} />
                    )}
                    {dashedEventLineXs
                      .filter((ts) => !activeEvent || Math.abs(eventLineX(ts) - eventLineX(new Date(activeEvent.timestamp).getTime())) > matchThreshold)
                      .slice(0, 8)
                      .map((ts, i) => (
                        <ReferenceLine
                          key={i}
                          x={eventLineX(ts)}
                          stroke="#d82c0d"
                          strokeDasharray="4 4"
                          strokeWidth={1}
                          strokeOpacity={activeEvent ? 0.2 : 0.6}
                        />
                      ))}
                  </AreaChart>
                </ResponsiveContainer>

                {dayPicker && (
                  <div
                    data-day-picker
                    style={{
                      position: "absolute",
                      left: Math.max(8, Math.min(dayPicker.anchorX - 180, (chartWrapperRef.current?.clientWidth ?? 520) - 360)),
                      top: Math.max(8, Math.min(dayPicker.anchorY + 8, 140 - 12)),
                      width: 360,
                      background: "#fff",
                      border: "1px solid #e1e3e5",
                      borderRadius: 10,
                      boxShadow: "0 12px 40px rgba(0,0,0,0.12)",
                      zIndex: 5,
                      overflow: "hidden",
                    }}
                  >
                    <div style={{ padding: "10px 12px", borderBottom: "1px solid #e1e3e5", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <div style={{ fontSize: 12, fontWeight: 600 }}>
                        Events on {formatChartTime(dayPicker.dayStartTs, false)}
                        <span style={{ color: "#637381", fontWeight: 500 }}> • {dayPicker.eventIds.length}</span>
                      </div>
                      <button
                        onClick={() => setDayPicker(null)}
                        style={{ border: "none", background: "transparent", cursor: "pointer", color: "#637381", fontSize: 12 }}
                      >
                        Close
                      </button>
                    </div>

                    <div style={{ padding: "8px 12px", borderBottom: "1px solid #e1e3e5" }}>
                      <input
                        value={dayPickerQuery}
                        onChange={(e) => setDayPickerQuery(e.target.value)}
                        placeholder="Search events…"
                        style={{
                          width: "100%",
                          boxSizing: "border-box",
                          border: "1px solid #e1e3e5",
                          borderRadius: 8,
                          padding: "8px 10px",
                          fontSize: 12,
                          outline: "none",
                        }}
                      />
                      <div style={{ marginTop: 6, fontSize: 11, color: "#919eab" }}>
                        Tip: click an event to jump to it in the timeline.
                      </div>
                    </div>

                    <div style={{ maxHeight: 260, overflowY: "auto" }}>
                      {dayPickerEvents.length ? (
                        dayPickerEvents.map((e) => {
                          const ts = new Date(e.timestamp).getTime();
                          const timeLabel = formatChartTime(ts, true);
                          return (
                            <button
                              key={e.id}
                              onClick={() => {
                                setDayPicker(null);
                                scrollToEvent(e.id);
                              }}
                              style={{
                                width: "100%",
                                textAlign: "left",
                                padding: "10px 12px",
                                border: "none",
                                borderBottom: "1px solid #f1f2f3",
                                background: "#fff",
                                cursor: "pointer",
                              }}
                            >
                              <div style={{ display: "flex", gap: 10, alignItems: "baseline" }}>
                                <div style={{ width: 64, flexShrink: 0, fontSize: 11, color: "#637381" }}>{timeLabel}</div>
                                <div style={{ fontSize: 12, color: "#303030", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                  <strong>{e.author || "System"}</strong>{" "}
                                  <span style={{ color: "#637381" }}>{e.topic?.toLowerCase().includes("orders") ? "order" : "changed"}</span>{" "}
                                  <span>{e.message}</span>
                                </div>
                              </div>
                            </button>
                          );
                        })
                      ) : (
                        <div style={{ padding: "12px", fontSize: 12, color: "#637381" }}>No matching events.</div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>

          {/* Impact Banner - Fixed */}
          <div
            style={{
              padding: "12px 16px",
              borderRadius: "10px",
              backgroundColor: activeEvent && impactAnalysis
                ? ((!impactAnalysis.isZeroBaseline && impactAnalysis.diff === 0) ? "#f4f6f8" : (impactAnalysis.isNegative ? "#fbeae5" : "#e3f1df"))
                : "#fff",
              minHeight: "56px",
              display: "flex",
              alignItems: "center",
              transition: "all 0.2s ease",
              border: "1px solid",
              borderColor: activeEvent && impactAnalysis
                ? ((!impactAnalysis.isZeroBaseline && impactAnalysis.diff === 0) ? "#e1e3e5" : (impactAnalysis.isNegative ? "#f5c6cb" : "#c3e6cb"))
                : "#e1e3e5",
              marginBottom: "12px",
              flexShrink: 0,
            }}
          >
            {activeEvent && impactAnalysis ? (
              <div style={{ width: "100%" }}>
                {/* Story-driven headline */}
                {(() => {
                  const absDelta = Math.abs(impactAnalysis.diff);
                  const isHourlyMetric = impactAnalysis.analysisType !== "sustained";
                  const whoCaresThreshold = isHourlyMetric ? 50 : 200; // $/hr vs $/day
                  const shouldShowPercent = absDelta >= whoCaresThreshold && !impactAnalysis.isZeroBaseline;
                  const unit = isHourlyMetric ? "/hr" : "/day";

                  return (
                    <div style={{ fontSize: "14px", fontWeight: "600", display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
                      {(!impactAnalysis.isZeroBaseline && impactAnalysis.diff === 0) ? (
                        <TrendingUp size={18} color="#637381" />
                      ) : impactAnalysis.isNegative ? (
                          <TrendingDown size={18} color="#d82c0d" />
                        ) : (
                          <TrendingUp size={18} color="#008060" />
                        )}
                      <span>
                        {impactAnalysis.storyContext && (
                          <>
                            <strong>{impactAnalysis.storyContext.authorName}</strong>
                            {" "}
                            {impactAnalysis.storyContext.changeDescription}
                            {" "}
                          </>
                        )}
                        {impactAnalysis.isZeroBaseline ? (
                          <>
                            and revenue jumped to{" "}
                            <span style={{ color: "#008060", fontWeight: "700" }}>
                              ${impactAnalysis.postSales}/hr
                            </span>
                          </>
                        ) : impactAnalysis.diff === 0 ? (
                          <>
                            and <span style={{ color: "#637381", fontWeight: "700" }}>sales remained stable</span>
                          </>
                        ) : !shouldShowPercent ? (
                          <>
                            and{" "}
                            <span style={{ color: impactAnalysis.isNegative ? "#d82c0d" : "#008060", fontWeight: "700" }}>
                              sales {impactAnalysis.isNegative ? "decreased" : "increased"} by ${absDelta.toFixed(0)}{unit}
                            </span>
                            <span style={{ color: "#919eab" }}> (low volume)</span>
                          </>
                        ) : (
                          <>
                            and sales{" "}
                            <span style={{ color: impactAnalysis.isNegative ? "#d82c0d" : "#008060", fontWeight: "700" }}>
                              {impactAnalysis.isNegative ? "dropped" : "increased"} {impactAnalysis.percentChange}%
                            </span>
                          </>
                        )}
                      </span>
                    </div>
                  );
                })()}
                {/* Details line - Telling the "Slow Burn" vs "Immediate Spike" story */}
                <div style={{ fontSize: "12px", color: "#637381", display: "flex", alignItems: "center", gap: "16px" }}>
                  <span>
                    {impactAnalysis.analysisType === "sustained"
                       ? `${isProductSeriesActive ? "Product" : "Store"} daily average moved from $${impactAnalysis.baselineSales} → $${impactAnalysis.postSales}`
                       : `${isProductSeriesActive ? "Product" : "Store"} hourly average moved from $${impactAnalysis.baselineSales} → $${impactAnalysis.postSales}`
                    }
                  </span>
                  <span style={{ color: "#919eab", display: "flex", alignItems: "center", gap: "4px" }}>
                    {impactAnalysis.analysisType === "sustained" ? (
                      <>
                        <span>📅</span> 7-day trend (Slow Burn)
                      </>
                    ) : impactAnalysis.isSmartBaseline ? (
                      <>
                        <span>📊</span> vs same time last week
                      </>
                    ) : (
                      <>
                        <span>⚡</span> Immediate impact
                      </>
                    )}
                  </span>
                  {selectedEventId && (
                    <button
                      onClick={() => setSelectedEventId(null)}
                      style={{
                        marginLeft: "auto",
                        padding: "4px 12px",
                        fontSize: "12px",
                        color: "#637381",
                        backgroundColor: "#fff",
                        border: "1px solid #c9cccf",
                        borderRadius: "4px",
                        cursor: "pointer",
                        fontWeight: "500",
                        boxShadow: "0 1px 0 rgba(0,0,0,0.05)"
                      }}
                    >
                      Close Analysis
                    </button>
                  )}
                </div>
              </div>
            ) : activeEvent && !impactAnalysis ? (
              (() => {
                // Check if this is an order event
                const isOrder = activeEvent.topic.toLowerCase().includes("orders");
                if (isOrder) {
                  // Parse order details from diff
                  let orderAmount = "";
                  let itemCount = 0;
                  let itemSummary = "";
                  try {
                    const diffData = JSON.parse(activeEvent.diff || "{}");
                    orderAmount = diffData.total ? `$${parseFloat(diffData.total).toFixed(2)}` : "";
                    itemCount = diffData.itemCount || 0;
                    itemSummary = diffData.itemSummary || "";
                  } catch { /* ignore */ }

                  return (
                    <div style={{ width: "100%" }}>
                      <div style={{ fontSize: "14px", fontWeight: "600", display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
                        <span style={{ fontSize: "16px" }}>💰</span>
                        <span>
                          <strong>Order {getItemName(activeEvent.message, activeEvent.topic)}</strong>
                          {orderAmount && <span style={{ color: "#008060", fontWeight: "700" }}> {orderAmount}</span>}
                        </span>
                      </div>
                      <div style={{ fontSize: "12px", color: "#637381", display: "flex", alignItems: "center", gap: "16px" }}>
                        {itemSummary && <span>{itemSummary}</span>}
                        <span style={{ color: "#919eab" }}>
                          {new Date(activeEvent.timestamp).toLocaleString()}
                        </span>
                        {selectedEventId && (
                          <button
                            onClick={() => setSelectedEventId(null)}
                            style={{
                              marginLeft: "auto",
                              padding: "2px 8px",
                              fontSize: "11px",
                              color: "#637381",
                              backgroundColor: "transparent",
                              border: "1px solid #e1e3e5",
                              borderRadius: "4px",
                              cursor: "pointer",
                            }}
                          >
                            Clear
                          </button>
                        )}
                      </div>
                    </div>
                  );
                }

                // Non-order, non-strategic event (inventory changes, etc.)
                return (
                  <div style={{ color: "#637381", fontSize: "13px", display: "flex", alignItems: "center", width: "100%" }}>
                    <div style={{ flex: 1 }}>
                      <strong>{activeEvent.author || "This change"}</strong> — no measurable sales impact detected
                      <span style={{ color: "#919eab", marginLeft: "8px" }}>(sales remained stable)</span>
                    </div>
                    {selectedEventId && (
                      <button
                        onClick={() => setSelectedEventId(null)}
                        style={{
                          padding: "2px 8px",
                          fontSize: "11px",
                          color: "#637381",
                          backgroundColor: "transparent",
                          border: "1px solid #e1e3e5",
                          borderRadius: "4px",
                          cursor: "pointer",
                        }}
                      >
                        Clear
                      </button>
                    )}
                  </div>
                );
              })()
            ) : impactPendingMessage ? (
              <div style={{ color: "#637381", fontSize: "13px" }}>
                <strong>{impactPendingMessage}</strong>
              </div>
            ) : (
              <div style={{ color: "#637381", fontSize: "13px" }}>
                <strong>Click on an event</strong> or <strong>click the chart</strong> to see its impact on sales
              </div>
            )}
          </div>

          {/* Main Panels: Split Layout (timeline left, insights right) */}
          <div style={{ display: "flex", gap: "12px", flex: 1, minHeight: 0, flexWrap: "nowrap", alignItems: "stretch" }}>
            {/* Activity Feed (primary) */}
            <div
              style={{
                backgroundColor: "#fff",
                borderRadius: "10px",
                border: "1px solid #e1e3e5",
                flex: "2 1 620px",
                minWidth: 0,
                minHeight: 0,
                display: "flex",
                flexDirection: "column",
                overflow: "hidden",
              }}
            >
              {/* Feed Header - Fixed */}
              <div style={{ padding: "10px 16px", borderBottom: "1px solid #e1e3e5", flexShrink: 0 }}>
                <span style={{ fontSize: "13px", fontWeight: "600" }}>Activity Timeline</span>
                <span style={{ fontSize: "11px", color: "#637381", marginLeft: "8px" }}>{events.length} events</span>
              </div>

              {/* Feed Content - Scrollable */}
              {events.length === 0 ? (
                <div style={{ padding: "40px 16px", textAlign: "center", color: "#637381" }}>
                  <div style={{ fontSize: "14px", marginBottom: "4px" }}>No events yet</div>
                  <div style={{ fontSize: "12px" }}>Make a change in your Shopify admin to see it here</div>
                </div>
              ) : (
                <div ref={timelineRef} style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>
                  {(events as EventLog[]).map((event, index) => {
                    const isActive = activeEventId === event.id;
                    const isHighlighted = highlightedEventId === event.id;
                    const isSelected = selectedEventId === event.id;
                    const badge = getBadgeStyle(event.topic);
                    const diffChanges = computedProductDiffByEventId.get(event.id) ?? parseDiffChanges(event.diff);
                    const itemName = getItemName(event.message, event.topic);
                    const action = getAction(event.message, event.topic);
                    const isLast = index === events.length - 1;

                    return (
                      <div
                        key={event.id}
                        id={`event-${event.id}`}
                        onMouseEnter={() => {
                          // If the user has explicitly selected an event, don't let hover move the "active" context.
                          if (selectedEventId) return;
                          setHoveredEventId(event.id);
                        }}
                        onMouseLeave={() => {
                          if (selectedEventId) return;
                          setHoveredEventId(null);
                        }}
                        onClick={() => {
                          if (selectedEventId === event.id) {
                            setSelectedEventId(null);
                            setHighlightedEventId(null);
                            return;
                          }
                          scrollToEvent(event.id);
                        }}
                        style={{
                          display: "flex",
                          padding: "12px 16px",
                          backgroundColor: isHighlighted
                            ? "#fff3cd"
                            : isSelected
                              ? "#e3f1df"
                              : isActive
                                ? "#f8f9fa"
                                : "transparent",
                          borderBottom: isLast ? "none" : "1px solid #f1f1f1",
                          borderLeft: isSelected ? "3px solid #008060" : "3px solid transparent",
                          cursor: "pointer",
                          transition: "all 0.2s ease",
                          animation: isHighlighted ? "pulse-highlight 0.5s ease-in-out 3" : "none",
                        }}
                      >
                        {/* Time column */}
                        <div style={{ width: "60px", flexShrink: 0, paddingTop: "2px" }}>
                          <div style={{ fontSize: "11px", color: "#637381" }}>{formatTime(event.timestamp)}</div>
                        </div>

                        {/* Avatar */}
                        <div style={{ width: "40px", flexShrink: 0, display: "flex", flexDirection: "column", alignItems: "center" }}>
                          <div
                            style={{
                              width: "32px",
                              height: "32px",
                              borderRadius: "50%",
                              backgroundColor: isActive || isSelected ? "#000" : "#e1e3e5",
                              color: isActive || isSelected ? "#fff" : "#637381",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              fontSize: "11px",
                              fontWeight: "600",
                              transition: "all 0.15s ease",
                            }}
                          >
                            {!event.author || event.author === "System/App" ? <Bot size={14} /> : getInitials(event.author)}
                          </div>
                          {!isLast && <div style={{ width: "2px", flex: 1, backgroundColor: "#e1e3e5", marginTop: "4px" }} />}
                        </div>

                        {/* Content */}
                        <div style={{ flex: 1, minWidth: 0, paddingLeft: "12px" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                            <span style={{ fontSize: "13px" }}>
                              <strong>{event.author || "System"}</strong>
                              <span style={{ color: "#637381" }}> {action} </span>
                              <strong>{itemName}</strong>
                            </span>
                            <span
                              style={{
                                fontSize: "10px",
                                padding: "2px 6px",
                                borderRadius: "4px",
                                backgroundColor: badge.bg,
                                color: badge.color,
                                fontWeight: "500",
                              }}
                            >
                              {badge.label}
                            </span>
                          </div>
                          {diffChanges && <DiffViewer changes={diffChanges} />}
                          {!diffChanges &&
                            event.topic?.toLowerCase() === "products/update" &&
                            (syncStatus.status === "not_started" || syncStatus.status === "syncing") && (
                              <div style={{ marginTop: "6px", fontSize: "11px", color: "#919eab" }}>
                                Diff will appear after baseline product sync completes.
                              </div>
                            )}
                          <div style={{ fontSize: "11px", color: "#919eab", marginTop: "4px" }}>{formatTimeAgo(event.timestamp)}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Insights (sticky detail) */}
            <div
              style={{
                backgroundColor: "#fff",
                borderRadius: "10px",
                border: "1px solid #e1e3e5",
                flex: "1 1 360px",
                minWidth: 0,
                minHeight: 0,
                display: "flex",
                flexDirection: "column",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  padding: "10px 16px",
                  borderBottom: "1px solid #e1e3e5",
                  flexShrink: 0,
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 10,
                }}
              >
                <span style={{ fontSize: "13px", fontWeight: "600" }}>Insights</span>
                <span
                  style={{ fontSize: "11px", color: "#637381" }}
                  title="We do not store or display customer-identifying data (name, email, phone, address). This panel shows aggregated revenue/units only."
                >
                  Privacy-safe (no customer PII)
                </span>
              </div>

              <div style={{ padding: "12px 16px", minHeight: 0, overflow: "hidden" }}>
                {selectedEvent?.topic?.toLowerCase().includes("products/") ? (
                  <>
                    {/* Status header (dense, no scrolling) */}
                    <div style={{ border: "1px solid #e1e3e5", borderRadius: 10, padding: "10px 12px", background: "#f8f9fa" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                        <div style={{ fontSize: 12, fontWeight: 800, color: "#303030" }}>Status</div>
                        {productImpactFetcher.state !== "idle" && !productImpactFetcher.data ? (
                          <span style={{ fontSize: 11, color: "#637381" }}>Loading…</span>
                        ) : (
                          (() => {
                            const s = productImpactFetcher.data?.immediate.status ?? "normal";
                            const label =
                              s === "measuring"
                                ? "Measuring…"
                                : s === "high_drop"
                                  ? "High drop detected"
                                  : s === "high_lift"
                                    ? "High lift detected"
                                    : "No alarm";
                            const bg = s === "high_drop" ? "#fbeae5" : s === "high_lift" ? "#e3f1df" : "#f4f6f8";
                            const color = s === "high_drop" ? "#d82c0d" : s === "high_lift" ? "#008060" : "#637381";
                            return (
                              <span style={{ fontSize: 11, fontWeight: 800, padding: "3px 8px", borderRadius: 999, background: bg, color, border: "1px solid #e1e3e5" }}>
                                {label}
                              </span>
                            );
                          })()
                        )}
                      </div>

                      <div style={{ marginTop: 6, fontSize: 12, color: "#637381" }}>
                        <strong style={{ color: "#303030" }}>{getItemName(selectedEvent.message, selectedEvent.topic)}</strong>
                        <span style={{ color: "#919eab" }}> • {rangeLabels[range]} • {isHourlyView ? "hourly" : "daily"}</span>
                      </div>

                      {productImpactFetcher.data && (
                        <>
                          <div style={{ marginTop: 8, fontSize: 12, color: "#303030" }}>
                            {(() => {
                              const cur = productImpactFetcher.data!.immediate.currentRevenuePerHour;
                              const typ = productImpactFetcher.data!.immediate.typicalRevenuePerHour;
                              const delta = typeof typ === "number" ? (cur - typ) : null;
                              const isLowVolume = (cur < 20 && (typ ?? 0) < 20) || (typeof delta === "number" && Math.abs(delta) < 20);
                              return (
                                <>
                                  <strong>${cur.toFixed(0)}/hr</strong>{" "}
                                  {typeof typ === "number" && (
                                    <span style={{ color: "#637381" }}>
                                      ({delta !== null ? `${delta >= 0 ? "+" : "-"}$${Math.abs(delta).toFixed(0)}/hr` : ""})
                                    </span>
                                  )}
                                  {isLowVolume && (
                                    <span style={{ marginLeft: 8, fontSize: 10, fontWeight: 700, padding: "2px 6px", borderRadius: 999, background: "#f4f6f8", color: "#637381", border: "1px solid #e1e3e5" }}>
                                      Low volume
                                    </span>
                                  )}
                                </>
                              );
                            })()}{" "}
                            <span style={{ color: "#637381" }}>
                              vs{" "}
                              {productImpactFetcher.data.immediate.typicalRevenuePerHour === null
                                ? "—"
                                : `$${productImpactFetcher.data.immediate.typicalRevenuePerHour.toFixed(0)}/hr`}{" "}
                              typical
                            </span>
                          </div>

                          {productImpactFetcher.data.sustained && (
                            <div style={{ marginTop: 6, fontSize: 12, color: "#637381" }}>
                              Growth:{" "}
                              <strong style={{ color: "#303030" }}>
                                ${productImpactFetcher.data.sustained.preDailyAvgRevenue.toFixed(0)}
                              </strong>{" "}
                              →{" "}
                              <strong style={{ color: "#303030" }}>
                                ${productImpactFetcher.data.sustained.postDailyAvgRevenue.toFixed(0)}
                              </strong>{" "}
                              <span style={{ color: "#919eab" }}>(7-day trend)</span>
                            </div>
                          )}

                          <div style={{ marginTop: 6, fontSize: 11, color: "#919eab" }}>
                            Confidence: {productImpactFetcher.data.immediate.confidence}
                            {productImpactFetcher.data.sustained?.confidence ? ` / ${productImpactFetcher.data.sustained.confidence}` : ""}
                          </div>
                        </>
                      )}
                    </div>

                    {/* Sparkline (compact) */}
                    <div style={{ marginTop: 10 }}>
                      <div style={{ fontSize: 11, color: "#919eab", marginBottom: 6 }}>
                        {isHourlyView ? "Hourly Trend (Last 24h)" : `Trend (${rangeLabels[range]})`}
                      </div>
                      {productSalesFetcher.state !== "idle" && !productSalesData ? (
                        <div style={{ fontSize: "12px", color: "#637381" }}>Loading sales velocity…</div>
                      ) : productSalesData && hasProductSales ? (
                        <div style={{ height: 72 }}>
                          <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={productSalesData}>
                              <defs>
                                <linearGradient id="sparkGradient" x1="0" y1="0" x2="0" y2="1">
                                  <stop offset="5%" stopColor="#1565c0" stopOpacity={0.25} />
                                  <stop offset="95%" stopColor="#1565c0" stopOpacity={0.05} />
                                </linearGradient>
                              </defs>
                              <XAxis dataKey="timestamp" type="number" domain={["dataMin", "dataMax"]} hide />
                              <YAxis hide />
                              <Tooltip content={<CustomTooltip isHourly={isHourlyView} valueLabel="Sales velocity" />} cursor={{ stroke: "#e1e3e5", strokeWidth: 1 }} />
                              <Area type="monotone" dataKey="sales" stroke="#1565c0" fill="url(#sparkGradient)" strokeWidth={2} dot={false} />
                            </AreaChart>
                          </ResponsiveContainer>
                        </div>
                      ) : (
                        <div style={{ fontSize: "12px", color: "#637381" }}>
                          No sales for this product in the selected range.
                          {productSalesFetcher.data?.completenessNote && (
                            <div style={{ marginTop: 6, fontSize: "11px", color: "#919eab" }}>
                              {productSalesFetcher.data.completenessNote}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </>
                ) : (
                  <div style={{ fontSize: 12, color: "#637381" }}>
                    Select a <strong>product</strong> event in the timeline to see impact and a compact sales-velocity sparkline here.
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    {/* Upgrade Modal */}
    {showUpgradeModal && (
      <div
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: "rgba(0,0,0,0.5)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 1000,
        }}
        onClick={() => setShowUpgradeModal(false)}
      >
        <div
          style={{
            backgroundColor: "#fff",
            borderRadius: "12px",
            padding: "24px",
            maxWidth: "400px",
            width: "90%",
            boxShadow: "0 20px 40px rgba(0,0,0,0.2)",
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "16px" }}>
            <div>
              <h2 style={{ fontSize: "18px", fontWeight: "600", margin: 0 }}>Unlock Historical Data</h2>
              <p style={{ fontSize: "13px", color: "#637381", margin: "4px 0 0 0" }}>
                Upgrade to Pro for deep analysis
              </p>
            </div>
            <button
              onClick={() => setShowUpgradeModal(false)}
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                padding: "4px",
                color: "#637381",
              }}
            >
              <X size={20} />
            </button>
          </div>

          <div style={{ backgroundColor: "#f6f6f7", borderRadius: "8px", padding: "16px", marginBottom: "16px" }}>
            <div style={{ fontSize: "24px", fontWeight: "700", marginBottom: "4px" }}>
              $19<span style={{ fontSize: "14px", fontWeight: "400", color: "#637381" }}>/month</span>
            </div>
            <ul style={{ margin: "12px 0 0 0", padding: "0 0 0 20px", fontSize: "13px", color: "#303030" }}>
              <li style={{ marginBottom: "6px" }}>7, 30, and 90-day historical views</li>
              <li style={{ marginBottom: "6px" }}>Unlimited event history</li>
              <li style={{ marginBottom: "6px" }}>Advanced search & filtering</li>
              <li>CSV export for compliance</li>
            </ul>
          </div>

          <form action="/app/billing" method="post">
            <button
              type="submit"
              style={{
                width: "100%",
                padding: "12px",
                backgroundColor: "#000",
                color: "#fff",
                border: "none",
                borderRadius: "8px",
                fontSize: "14px",
                fontWeight: "600",
                cursor: "pointer",
              }}
            >
              Upgrade to Pro
            </button>
          </form>

          <p style={{ fontSize: "11px", color: "#919eab", textAlign: "center", marginTop: "12px", marginBottom: 0 }}>
            Cancel anytime. Billed through Shopify.
          </p>
        </div>
      </div>
    )}
    </>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
