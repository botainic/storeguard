/**
 * Email Templates for StoreGuard
 *
 * Responsive HTML email templates compatible with Gmail, Apple Mail, and Outlook.
 * - Table-based layout (Outlook uses Word renderer, no CSS flex/grid)
 * - All CSS inline (Gmail strips <style> blocks)
 * - 320px minimum width, single column
 * - 14px body font, proper line-heights
 * - StoreGuard branding (clean text wordmark)
 */

import type { DigestSummary, DigestEvent } from "./dailyDigest.server";

// ============================================
// SHARED CONSTANTS
// ============================================

const BRAND_COLOR = "#111827";
const BODY_BG = "#f3f4f6";
const CARD_BG = "#ffffff";
const TEXT_PRIMARY = "#111827";
const TEXT_SECONDARY = "#6b7280";
const TEXT_MUTED = "#9ca3af";
const BORDER_COLOR = "#e5e7eb";
const BORDER_LIGHT = "#f3f4f6";
const HIGH_PRIORITY_BG = "#fef2f2";
const HIGH_PRIORITY_TEXT = "#dc2626";
const FONT_STACK = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

/** Clean text wordmark — no emoji, no images */

/** Event type display config: title, color, display order */
export const EVENT_TYPE_CONFIG: Record<string, { title: string; color: string; order: number }> = {
  price_change: { title: "Price Changes", color: "#f59e0b", order: 1 },
  visibility_change: { title: "Visibility Changes", color: "#8b5cf6", order: 2 },
  inventory_low: { title: "Low Stock", color: "#f97316", order: 3 },
  inventory_zero: { title: "Cannot Be Purchased", color: "#ef4444", order: 4 },
  theme_publish: { title: "Live Theme Replaced", color: "#06b6d4", order: 5 },
  collection_created: { title: "Collection Created", color: "#10b981", order: 6 },
  collection_updated: { title: "Collection Updated", color: "#10b981", order: 7 },
  collection_deleted: { title: "Collection Deleted", color: "#ef4444", order: 8 },
  discount_created: { title: "Discount Created", color: "#8b5cf6", order: 9 },
  discount_changed: { title: "Discount Changed", color: "#8b5cf6", order: 10 },
  discount_deleted: { title: "Discount Deleted", color: "#ef4444", order: 11 },
  app_permissions_changed: { title: "App Permissions Changed", color: "#6366f1", order: 12 },
  domain_changed: { title: "Domain Changed", color: "#0891b2", order: 13 },
  domain_removed: { title: "Domain Removed", color: "#ef4444", order: 14 },
};

// ============================================
// SHARED HELPERS
// ============================================

/** Wrap content in the standard email document shell */
function emailShell(title: string, body: string): string {
  return `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" lang="en">
<head>
  <meta http-equiv="Content-Type" content="text/html; charset=utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title}</title>
  <!--[if mso]>
  <style type="text/css">
    table { border-collapse: collapse; }
    .button-link { padding: 12px 24px !important; }
  </style>
  <![endif]-->
</head>
<body style="margin: 0; padding: 0; background-color: ${BODY_BG}; font-family: ${FONT_STACK}; font-size: 14px; line-height: 1.5; color: ${TEXT_PRIMARY}; -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%;">
  <!-- Outer wrapper table for full-width background -->
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color: ${BODY_BG};">
    <tr>
      <td align="center" style="padding: 24px 16px;">
        <!-- Inner content table with max-width -->
        <!--[if mso]><table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600"><tr><td><![endif]-->
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width: 600px; min-width: 320px;">
          ${body}
        </table>
        <!--[if mso]></td></tr></table><![endif]-->
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/** Parse contextData JSON safely */
function parseContextData(contextData: string | null | undefined): {
  summary: string | null;
  velocityContext: string | null;
  locationContext: string | null;
  revenueImpact: number | null;
  percentChange: number | null;
  direction: "up" | "down" | null;
} {
  if (!contextData) return { summary: null, velocityContext: null, locationContext: null, revenueImpact: null, percentChange: null, direction: null };
  try {
    const ctx = JSON.parse(contextData) as Record<string, unknown>;
    return {
      summary: typeof ctx.summary === "string" ? ctx.summary : null,
      velocityContext: typeof ctx.velocityContext === "string" ? ctx.velocityContext : null,
      locationContext: typeof ctx.locationContext === "string" ? ctx.locationContext : null,
      revenueImpact: typeof ctx.revenueImpact === "number" ? ctx.revenueImpact : null,
      percentChange: typeof ctx.percentChange === "number" ? ctx.percentChange : null,
      direction: ctx.direction === "up" || ctx.direction === "down" ? ctx.direction : null,
    };
  } catch {
    return { summary: null, velocityContext: null, locationContext: null, revenueImpact: null, percentChange: null, direction: null };
  }
}

/** Get the accent color for an event type */
export function getAlertColor(eventType: string): string {
  return EVENT_TYPE_CONFIG[eventType]?.color ?? "#6b7280";
}

// ============================================
// DAILY DIGEST EMAIL
// ============================================

/** Format a change description for digest email rows */
export function formatDigestChangeDescription(event: DigestEvent): string {
  const time = event.detectedAt.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });

  const ctx = parseContextData(event.contextData);

  // Use enriched summary when available for price, inventory, visibility, theme events
  if (ctx.summary) {
    const revenueNote = ctx.revenueImpact !== null
      ? ` &mdash; ~$${ctx.revenueImpact.toFixed(2)}/hr at risk`
      : "";
    return `${ctx.summary}${revenueNote} &bull; ${time}`;
  }

  // Fallback for events without enriched context (collections, discounts, etc.)
  let suffix = "";
  if (ctx.locationContext) suffix += ` &mdash; ${ctx.locationContext}`;
  if (ctx.velocityContext) suffix += ` &mdash; ${ctx.velocityContext}`;

  switch (event.eventType) {
    case "price_change":
      return `${event.beforeValue} &rarr; ${event.afterValue}${suffix} &bull; ${time}`;
    case "visibility_change":
      return `${event.beforeValue} &rarr; ${event.afterValue}${suffix} &bull; ${time}`;
    case "inventory_low":
      return `Stock dropped to ${event.afterValue} units (was ${event.beforeValue})${suffix} &bull; ${time}`;
    case "inventory_zero":
      return `Cannot be purchased &mdash; inventory hit zero (was ${event.beforeValue} units)${suffix} &bull; ${time}`;
    case "theme_publish":
      return `Live theme replaced &bull; ${time}`;
    case "collection_created":
      return `New collection created &bull; ${time}`;
    case "collection_updated":
      return `Collection updated &bull; ${time}`;
    case "collection_deleted":
      return `Collection deleted &bull; ${time}`;
    case "discount_created":
      return `Discount created &bull; ${time}`;
    case "discount_changed":
      return `${event.beforeValue ?? ""} &rarr; ${event.afterValue ?? ""} &bull; ${time}`;
    case "discount_deleted":
      return `Discount deleted &bull; ${time}`;
    case "app_permissions_changed":
      return `Permissions changed &bull; ${time}`;
    case "domain_changed":
      return `Domain added or changed &bull; ${time}`;
    case "domain_removed":
      return `Domain removed &bull; ${time}`;
    default:
      return `${event.beforeValue ?? ""} &rarr; ${event.afterValue ?? ""}${suffix} &bull; ${time}`;
  }
}

/** Build a single event row for the digest */
function buildEventRow(event: DigestEvent): string {
  const importanceDot = event.importance === "high"
    ? `<td width="12" valign="top" style="padding-top: 4px;"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td width="8" height="8" style="width: 8px; height: 8px; background-color: ${HIGH_PRIORITY_TEXT}; border-radius: 50%; font-size: 1px; line-height: 1px;">&nbsp;</td></tr></table></td>`
    : `<td width="12" style="font-size: 1px; line-height: 1px;">&nbsp;</td>`;

  return `<tr>
  <td style="padding: 12px 0; border-bottom: 1px solid ${BORDER_LIGHT};">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
      <tr>
        ${importanceDot}
        <td style="font-family: ${FONT_STACK};">
          <strong style="color: ${TEXT_PRIMARY}; font-size: 14px;">${event.resourceName}</strong>
          <div style="margin-top: 4px; color: ${TEXT_SECONDARY}; font-size: 13px; line-height: 1.4;">
            ${formatDigestChangeDescription(event)}
          </div>
        </td>
      </tr>
    </table>
  </td>
</tr>`;
}

/** Build a section for a group of events (e.g., "Price Changes") */
function buildEventSection(title: string, events: DigestEvent[], accentColor: string): string {
  const rows = events.map(buildEventRow).join("");

  return `<tr>
  <td style="padding: 0 24px;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
      <tr>
        <td style="padding: 16px 0; border-bottom: 2px solid ${accentColor};">
          <h2 style="margin: 0; font-size: 16px; font-weight: 600; color: ${TEXT_PRIMARY}; font-family: ${FONT_STACK};">${title}</h2>
          <p style="margin: 4px 0 0; font-size: 13px; color: ${TEXT_SECONDARY}; font-family: ${FONT_STACK};">${events.length} change${events.length !== 1 ? "s" : ""}</p>
        </td>
      </tr>
      ${rows}
    </table>
  </td>
</tr>`;
}

/** Generate the full HTML email for a daily digest */
export function generateDigestEmailHtml(digest: DigestSummary): string {
  const shopName = digest.shop.replace(".myshopify.com", "");
  const dateStr = digest.generatedAt.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  // Build sections sorted by display order
  const sortedTypes = Object.entries(digest.eventsByType)
    .filter(([, events]) => events.length > 0)
    .sort(([a], [b]) => {
      const orderA = EVENT_TYPE_CONFIG[a]?.order ?? 99;
      const orderB = EVENT_TYPE_CONFIG[b]?.order ?? 99;
      return orderA - orderB;
    });

  const sectionRows = sortedTypes
    .map(([eventType, events]) => {
      const config = EVENT_TYPE_CONFIG[eventType] ?? {
        title: eventType.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
        color: "#6b7280",
      };
      return buildEventSection(config.title, events, config.color);
    })
    .join("");

  const highPriorityCell = digest.highPriorityCount > 0
    ? `<td style="padding-left: 8px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td style="background-color: ${HIGH_PRIORITY_BG}; color: ${HIGH_PRIORITY_TEXT}; padding: 4px 12px; border-radius: 12px; font-size: 13px; font-weight: 600; font-family: ${FONT_STACK};">${digest.highPriorityCount} High Priority</td>
          </tr>
        </table>
      </td>`
    : "";

  const body = `
<!-- Header -->
<tr>
  <td align="center" bgcolor="${BRAND_COLOR}" style="background-color: ${BRAND_COLOR}; padding: 28px 24px; border-radius: 8px 8px 0 0;">
    <h1 style="margin: 0; font-size: 22px; font-weight: 700; color: #ffffff; font-family: ${FONT_STACK};">StoreGuard</h1>
    <p style="margin: 8px 0 0; font-size: 14px; color: #a1a1aa; font-family: ${FONT_STACK};">Daily Digest for ${shopName}</p>
  </td>
</tr>
<!-- Summary -->
<tr>
  <td bgcolor="${CARD_BG}" style="background-color: ${CARD_BG}; padding: 24px; border-bottom: 1px solid ${BORDER_COLOR};">
    <p style="margin: 0 0 12px; color: ${TEXT_SECONDARY}; font-size: 14px; font-family: ${FONT_STACK};">${dateStr}</p>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0">
      <tr>
        <td style="background-color: ${BORDER_LIGHT}; color: #374151; padding: 8px 16px; border-radius: 8px; font-size: 16px; font-weight: 600; font-family: ${FONT_STACK};">
          ${digest.totalChanges} Change${digest.totalChanges !== 1 ? "s" : ""} Detected
        </td>
        ${highPriorityCell}
      </tr>
    </table>
  </td>
</tr>
<!-- Event Sections -->
<tr>
  <td bgcolor="${CARD_BG}" style="background-color: ${CARD_BG};">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
      ${sectionRows}
    </table>
  </td>
</tr>
<!-- Footer -->
<tr>
  <td bgcolor="${CARD_BG}" style="background-color: ${CARD_BG}; padding: 24px; border-radius: 0 0 8px 8px; border-top: 1px solid ${BORDER_COLOR}; text-align: center;">
    <p style="margin: 0 0 8px; color: ${TEXT_SECONDARY}; font-size: 13px; font-family: ${FONT_STACK};">
      You're receiving this because you enabled daily digests in StoreGuard.
    </p>
    <p style="margin: 0; font-size: 12px; font-family: ${FONT_STACK};">
      <a href="https://${digest.shop}/admin/apps/storeguard/settings" style="color: ${TEXT_SECONDARY}; text-decoration: underline;">Manage notification settings</a>
    </p>
  </td>
</tr>`;

  return emailShell("StoreGuard Daily Digest", body);
}

// ============================================
// INSTANT ALERT EMAIL
// ============================================

export interface InstantAlertEvent {
  eventType: string;
  resourceName: string;
  beforeValue: string | null;
  afterValue: string | null;
  importance: string;
  detectedAt: Date;
  contextData?: string | null;
}

/** Get subject line for instant alert */
export function getInstantAlertSubject(event: InstantAlertEvent, shopName: string): string {
  switch (event.eventType) {
    case "price_change": {
      const afterPrice = parseFloat(event.afterValue ?? "");
      if (afterPrice === 0) return `Product priced at $0: ${event.resourceName} - ${shopName}`;
      return `Price changed: ${event.resourceName} - ${shopName}`;
    }
    case "visibility_change":
      return `Product ${event.afterValue === "active" ? "restored" : "hidden"}: ${event.resourceName} - ${shopName}`;
    case "inventory_low":
      return `Low stock: ${event.resourceName} (${event.afterValue} left) - ${shopName}`;
    case "inventory_zero":
      return `Cannot be purchased: ${event.resourceName} - ${shopName}`;
    case "theme_publish":
      return `Live theme replaced: ${event.resourceName} - ${shopName}`;
    case "collection_created":
      return `Collection created: ${event.resourceName} - ${shopName}`;
    case "collection_updated":
      return `Collection updated: ${event.resourceName} - ${shopName}`;
    case "collection_deleted":
      return `Collection deleted: ${event.resourceName} - ${shopName}`;
    case "discount_created":
      return `Discount created: ${event.resourceName} - ${shopName}`;
    case "discount_changed":
      return `Discount changed: ${event.resourceName} - ${shopName}`;
    case "discount_deleted":
      return `Discount deleted: ${event.resourceName} - ${shopName}`;
    case "app_permissions_changed":
      return `App permissions changed: ${event.resourceName} - ${shopName}`;
    case "domain_changed":
      return `Domain changed: ${event.resourceName} - ${shopName}`;
    case "domain_removed":
      return `Domain removed: ${event.resourceName} - ${shopName}`;
    default:
      return `Change detected: ${event.resourceName} - ${shopName}`;
  }
}

/** Build the change description for an instant alert */
export function buildInstantAlertDescription(event: InstantAlertEvent): string {
  const ctx = parseContextData(event.contextData);

  // Use enriched summary when available
  if (ctx.summary) {
    return ctx.summary;
  }

  // Fallback for events without enriched context
  let description = "";
  switch (event.eventType) {
    case "price_change":
      description = `Price changed from ${event.beforeValue} to ${event.afterValue}`;
      break;
    case "visibility_change":
      description = event.afterValue === "active"
        ? `Product restored &mdash; now visible to customers (was ${event.beforeValue})`
        : `Product hidden &mdash; no longer visible to customers (was ${event.beforeValue}, now ${event.afterValue})`;
      break;
    case "inventory_low":
      description = `Stock dropped to ${event.afterValue} units total (was ${event.beforeValue}) &mdash; close to selling out`;
      break;
    case "inventory_zero":
      description = `Cannot be purchased &mdash; inventory is now zero across all locations (was ${event.beforeValue} units)`;
      break;
    case "theme_publish":
      description = `Your live theme was replaced with &quot;${event.resourceName}&quot;`;
      break;
    case "collection_created":
      description = `Collection &quot;${event.resourceName}&quot; was created`;
      break;
    case "collection_updated":
      description = `Collection &quot;${event.resourceName}&quot; was updated`;
      break;
    case "collection_deleted":
      description = `Collection &quot;${event.resourceName}&quot; was deleted`;
      break;
    case "discount_created":
      description = `Discount &quot;${event.resourceName}&quot; was created`;
      break;
    case "discount_changed":
      description = `Discount &quot;${event.resourceName}&quot; was modified: ${event.beforeValue || ""} &rarr; ${event.afterValue || ""}`;
      break;
    case "discount_deleted":
      description = `Discount &quot;${event.resourceName}&quot; was deleted`;
      break;
    case "app_permissions_changed":
      description = `App permissions were changed: ${event.resourceName}`;
      break;
    case "domain_changed":
      description = `Domain &quot;${event.resourceName}&quot; was added or changed`;
      break;
    case "domain_removed":
      description = `Domain &quot;${event.resourceName}&quot; was removed`;
      break;
    default:
      description = `${event.beforeValue || ""} &rarr; ${event.afterValue || ""}`;
  }

  if (ctx.locationContext) description += ` &mdash; ${ctx.locationContext}`;
  if (ctx.velocityContext) description += ` &mdash; ${ctx.velocityContext}`;

  return description;
}

/** Generate the full HTML for an instant alert email */
export function generateInstantAlertHtml(event: InstantAlertEvent, shop: string): string {
  const shopName = shop.replace(".myshopify.com", "");
  const color = getAlertColor(event.eventType);
  const time = event.detectedAt.toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });

  const { revenueImpact } = parseContextData(event.contextData);
  const changeDescription = buildInstantAlertDescription(event);

  const impactRow = revenueImpact !== null
    ? `<tr><td style="padding: 0 0 16px; color: ${HIGH_PRIORITY_TEXT}; font-size: 14px; font-weight: 500; font-family: ${FONT_STACK};">Estimated impact: ~$${revenueImpact.toFixed(2)}/hr until fixed</td></tr>`
    : "";

  const body = `
<!-- Header -->
<tr>
  <td align="center" bgcolor="${color}" style="background-color: ${color}; padding: 24px; border-radius: 8px 8px 0 0;">
    <h1 style="margin: 0; font-size: 18px; font-weight: 700; color: #ffffff; font-family: ${FONT_STACK};">StoreGuard Alert</h1>
    <p style="margin: 6px 0 0; font-size: 13px; color: #ffffff; font-family: ${FONT_STACK};">${shopName}</p>
  </td>
</tr>
<!-- Content -->
<tr>
  <td bgcolor="${CARD_BG}" style="background-color: ${CARD_BG}; padding: 24px;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
      <tr>
        <td style="padding: 0 0 8px;">
          <h2 style="margin: 0; font-size: 18px; font-weight: 600; color: ${TEXT_PRIMARY}; font-family: ${FONT_STACK};">${event.resourceName}</h2>
        </td>
      </tr>
      <tr>
        <td style="padding: 0 0 16px; color: #374151; font-size: 14px; line-height: 1.5; font-family: ${FONT_STACK};">
          ${changeDescription}
        </td>
      </tr>
      ${impactRow}
      <tr>
        <td style="padding: 0; color: ${TEXT_MUTED}; font-size: 13px; font-family: ${FONT_STACK};">
          Detected at ${time}
        </td>
      </tr>
      <tr>
        <td style="padding: 24px 0 0; border-top: 1px solid ${BORDER_COLOR}; padding-top: 16px; margin-top: 24px;">
          <!--[if mso]>
          <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="https://${shop}/admin" style="height:44px;v-text-anchor:middle;width:200px;" arcsize="14%" stroke="f" fillcolor="${BRAND_COLOR}">
            <w:anchorlock/>
            <center style="color:#ffffff;font-family:${FONT_STACK};font-size:14px;font-weight:bold;">View in Shopify Admin</center>
          </v:roundrect>
          <![endif]-->
          <!--[if !mso]><!-->
          <a href="https://${shop}/admin" style="display: inline-block; background-color: ${BRAND_COLOR}; color: #ffffff; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-size: 14px; font-weight: 600; font-family: ${FONT_STACK}; line-height: 1; mso-hide: all;">View in Shopify Admin</a>
          <!--<![endif]-->
        </td>
      </tr>
    </table>
  </td>
</tr>
<!-- Footer -->
<tr>
  <td bgcolor="${CARD_BG}" style="background-color: ${CARD_BG}; padding: 16px 24px 24px; border-radius: 0 0 8px 8px; border-top: 1px solid ${BORDER_COLOR}; text-align: center;">
    <p style="margin: 0; font-size: 12px; font-family: ${FONT_STACK};">
      <a href="https://${shop}/admin/apps/storeguard/settings" style="color: ${TEXT_SECONDARY}; text-decoration: underline;">Manage instant alerts</a>
    </p>
  </td>
</tr>`;

  return emailShell("StoreGuard Alert", body);
}

// ============================================
// WEEKLY HEALTH SUMMARY EMAIL
// ============================================

import type { WeeklyHealthSummary, WeeklyActivitySummary } from "./weeklyHealthSummary.server";

/** Build the activity rows for the weekly summary */
function buildActivityRows(activity: WeeklyActivitySummary): string {
  const items: { label: string; count: number; color: string }[] = [];

  if (activity.priceChanges > 0)
    items.push({ label: "Price changes detected", count: activity.priceChanges, color: "#f59e0b" });
  if (activity.inventoryZero > 0)
    items.push({ label: "Products hit zero stock", count: activity.inventoryZero, color: "#ef4444" });
  if (activity.inventoryLow > 0)
    items.push({ label: "Low stock warnings", count: activity.inventoryLow, color: "#f97316" });
  if (activity.visibilityChanges > 0)
    items.push({ label: "Visibility changes", count: activity.visibilityChanges, color: "#8b5cf6" });
  if (activity.themePublishes > 0)
    items.push({ label: "Theme publishes", count: activity.themePublishes, color: "#06b6d4" });
  if (activity.collectionChanges > 0)
    items.push({ label: "Collection changes", count: activity.collectionChanges, color: "#10b981" });
  if (activity.discountChanges > 0)
    items.push({ label: "Discount changes", count: activity.discountChanges, color: "#8b5cf6" });
  if (activity.domainChanges > 0)
    items.push({ label: "Domain changes", count: activity.domainChanges, color: "#0891b2" });
  if (activity.appPermissionChanges > 0)
    items.push({ label: "App permission changes", count: activity.appPermissionChanges, color: "#6366f1" });

  if (items.length === 0) {
    return `<tr>
  <td style="padding: 16px 0; color: #059669; font-size: 14px; font-family: ${FONT_STACK};">
    Good news &mdash; no critical changes detected this week.
  </td>
</tr>`;
  }

  return items
    .map(
      (item) => `<tr>
  <td style="padding: 10px 0; border-bottom: 1px solid ${BORDER_LIGHT};">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
      <tr>
        <td style="font-family: ${FONT_STACK}; font-size: 14px; color: ${TEXT_PRIMARY};">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0">
            <tr>
              <td width="10" valign="middle" style="padding-right: 8px;">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                  <tr><td width="8" height="8" style="width: 8px; height: 8px; background-color: ${item.color}; border-radius: 50%; font-size: 1px; line-height: 1px;">&nbsp;</td></tr>
                </table>
              </td>
              <td style="font-family: ${FONT_STACK}; font-size: 14px; color: ${TEXT_PRIMARY};">
                <strong>${item.count}</strong> ${item.label}
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </td>
</tr>`,
    )
    .join("");
}

/** Build the exposure snapshot rows */
function buildExposureRows(exposure: { zeroStockCount: number; lowStockCount: number; zeroPriceCount: number; highDiscountCount: number }, hasData: boolean): string {
  if (!hasData) {
    return `<tr>
  <td style="padding: 16px 0; color: ${TEXT_SECONDARY}; font-size: 14px; font-family: ${FONT_STACK};">
    Run a protection scan from your dashboard to see current exposure data.
  </td>
</tr>`;
  }

  const items: { label: string; count: number; color: string }[] = [];

  if (exposure.zeroStockCount > 0)
    items.push({ label: "products currently cannot be purchased (zero stock)", count: exposure.zeroStockCount, color: "#ef4444" });
  if (exposure.lowStockCount > 0)
    items.push({ label: "variants below stock threshold", count: exposure.lowStockCount, color: "#f97316" });
  if (exposure.zeroPriceCount > 0)
    items.push({ label: "products priced at $0", count: exposure.zeroPriceCount, color: "#ef4444" });
  if (exposure.highDiscountCount > 0)
    items.push({ label: "active high-value discounts (40%+ or $50+)", count: exposure.highDiscountCount, color: "#f59e0b" });

  if (items.length === 0) {
    return `<tr>
  <td style="padding: 16px 0; color: #059669; font-size: 14px; font-family: ${FONT_STACK};">
    No immediate exposure risks detected.
  </td>
</tr>`;
  }

  return items
    .map(
      (item) => `<tr>
  <td style="padding: 10px 0; border-bottom: 1px solid ${BORDER_LIGHT};">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0">
      <tr>
        <td width="10" valign="middle" style="padding-right: 8px;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0">
            <tr><td width="8" height="8" style="width: 8px; height: 8px; background-color: ${item.color}; border-radius: 50%; font-size: 1px; line-height: 1px;">&nbsp;</td></tr>
          </table>
        </td>
        <td style="font-family: ${FONT_STACK}; font-size: 14px; color: ${TEXT_PRIMARY};">
          <strong>${item.count}</strong> ${item.label}
        </td>
      </tr>
    </table>
  </td>
</tr>`,
    )
    .join("");
}

/** Generate the full HTML for a weekly health summary email */
export function generateWeeklyHealthSummaryHtml(summary: WeeklyHealthSummary): string {
  const shopName = summary.shop.replace(".myshopify.com", "");
  const dateRange = `${summary.periodStart.toLocaleDateString("en-US", { month: "short", day: "numeric" })} – ${summary.periodEnd.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;

  const activityRows = buildActivityRows(summary.activity);
  const exposureRows = buildExposureRows(summary.exposure, summary.hasExposureData);

  const body = `
<!-- Header -->
<tr>
  <td align="center" bgcolor="${BRAND_COLOR}" style="background-color: ${BRAND_COLOR}; padding: 28px 24px; border-radius: 8px 8px 0 0;">
    <h1 style="margin: 0; font-size: 22px; font-weight: 700; color: #ffffff; font-family: ${FONT_STACK};">StoreGuard</h1>
    <p style="margin: 8px 0 0; font-size: 14px; color: #a1a1aa; font-family: ${FONT_STACK};">Weekly Health Report for ${shopName}</p>
  </td>
</tr>
<!-- Date range -->
<tr>
  <td bgcolor="${CARD_BG}" style="background-color: ${CARD_BG}; padding: 24px 24px 16px; border-bottom: 1px solid ${BORDER_COLOR};">
    <p style="margin: 0; color: ${TEXT_SECONDARY}; font-size: 14px; font-family: ${FONT_STACK};">${dateRange}</p>
  </td>
</tr>
<!-- Section 1: Activity This Week -->
<tr>
  <td bgcolor="${CARD_BG}" style="background-color: ${CARD_BG}; padding: 0 24px;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
      <tr>
        <td style="padding: 20px 0 8px; border-bottom: 2px solid ${BRAND_COLOR};">
          <h2 style="margin: 0; font-size: 16px; font-weight: 600; color: ${TEXT_PRIMARY}; font-family: ${FONT_STACK};">Activity This Week</h2>
        </td>
      </tr>
      ${activityRows}
    </table>
  </td>
</tr>
<!-- Section 2: Current Exposure Snapshot -->
<tr>
  <td bgcolor="${CARD_BG}" style="background-color: ${CARD_BG}; padding: 0 24px;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
      <tr>
        <td style="padding: 24px 0 8px; border-bottom: 2px solid #ef4444;">
          <h2 style="margin: 0; font-size: 16px; font-weight: 600; color: ${TEXT_PRIMARY}; font-family: ${FONT_STACK};">Current Exposure Snapshot</h2>
        </td>
      </tr>
      ${exposureRows}
    </table>
  </td>
</tr>
<!-- Section 3: Protection Reminder + CTA -->
<tr>
  <td bgcolor="${CARD_BG}" style="background-color: ${CARD_BG}; padding: 24px;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
      <tr>
        <td style="padding: 16px; background-color: ${BORDER_LIGHT}; border-radius: 8px;">
          <p style="margin: 0 0 16px; font-size: 14px; color: ${TEXT_PRIMARY}; line-height: 1.5; font-family: ${FONT_STACK};">
            StoreGuard is continuously monitoring your store for revenue-impacting changes.
          </p>
          <!--[if mso]>
          <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="https://${summary.shop}/admin/apps/storeguard" style="height:44px;v-text-anchor:middle;width:200px;" arcsize="14%" stroke="f" fillcolor="${BRAND_COLOR}">
            <w:anchorlock/>
            <center style="color:#ffffff;font-family:${FONT_STACK};font-size:14px;font-weight:bold;">View Full Report</center>
          </v:roundrect>
          <![endif]-->
          <!--[if !mso]><!-->
          <a href="https://${summary.shop}/admin/apps/storeguard" style="display: inline-block; background-color: ${BRAND_COLOR}; color: #ffffff; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-size: 14px; font-weight: 600; font-family: ${FONT_STACK}; line-height: 1; mso-hide: all;">View Full Report</a>
          <!--<![endif]-->
        </td>
      </tr>
    </table>
  </td>
</tr>
<!-- Footer -->
<tr>
  <td bgcolor="${CARD_BG}" style="background-color: ${CARD_BG}; padding: 16px 24px 24px; border-radius: 0 0 8px 8px; border-top: 1px solid ${BORDER_COLOR}; text-align: center;">
    <p style="margin: 0 0 8px; color: ${TEXT_SECONDARY}; font-size: 13px; font-family: ${FONT_STACK};">
      You're receiving this weekly report because you have alerts configured in StoreGuard.
    </p>
    <p style="margin: 0; font-size: 12px; font-family: ${FONT_STACK};">
      <a href="https://${summary.shop}/admin/apps/storeguard/settings" style="color: ${TEXT_SECONDARY}; text-decoration: underline;">Manage notification settings</a>
    </p>
  </td>
</tr>`;

  return emailShell("StoreGuard Weekly Health Report", body);
}
