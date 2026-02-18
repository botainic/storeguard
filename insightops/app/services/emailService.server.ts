/**
 * Email Service for StoreGuard
 *
 * Sends emails via Resend API.
 * Environment variables required:
 * - RESEND_API_KEY: Your Resend API key
 * - DIGEST_FROM_EMAIL: Sender email (e.g., alerts@storeguard.app)
 */

import {
  type DigestSummary,
  formatEventType,
  formatEventForEmail,
} from "./dailyDigest.server";

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL = process.env.DIGEST_FROM_EMAIL || "StoreGuard <alerts@storeguard.app>";

interface SendEmailResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

/**
 * Send an email via Resend API
 */
async function sendEmail(
  to: string,
  subject: string,
  html: string
): Promise<SendEmailResult> {
  if (!RESEND_API_KEY) {
    console.error("[StoreGuard] RESEND_API_KEY not configured");
    return { success: false, error: "Email service not configured" };
  }

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: [to],
        subject,
        html,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const errorMessage = (errorData as { message?: string }).message || `HTTP ${response.status}`;
      console.error(`[StoreGuard] Resend API error: ${errorMessage}`);
      return { success: false, error: errorMessage };
    }

    const data = await response.json() as { id: string };
    console.log(`[StoreGuard] Email sent successfully: ${data.id}`);
    return { success: true, messageId: data.id };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(`[StoreGuard] Failed to send email: ${message}`);
    return { success: false, error: message };
  }
}

/**
 * Generate HTML email for daily digest
 */
export function generateDigestEmailHtml(digest: DigestSummary): string {
  const shopName = digest.shop.replace(".myshopify.com", "");
  const dateStr = digest.generatedAt.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  // Build sections for each event type
  const sections: string[] = [];

  // Price changes
  if (digest.eventsByType.price_change.length > 0) {
    sections.push(buildEventSection(
      "💰 Price Changes",
      digest.eventsByType.price_change,
      "#f59e0b" // amber
    ));
  }

  // Visibility changes
  if (digest.eventsByType.visibility_change.length > 0) {
    sections.push(buildEventSection(
      "👁️ Visibility Changes",
      digest.eventsByType.visibility_change,
      "#8b5cf6" // purple
    ));
  }

  // Low stock
  if (digest.eventsByType.inventory_low && digest.eventsByType.inventory_low.length > 0) {
    sections.push(buildEventSection(
      "⚠️ Low Stock",
      digest.eventsByType.inventory_low,
      "#f97316" // orange
    ));
  }

  // Out of stock
  if (digest.eventsByType.inventory_zero.length > 0) {
    sections.push(buildEventSection(
      "📦 Out of Stock",
      digest.eventsByType.inventory_zero,
      "#ef4444" // red
    ));
  }

  // Theme publishes
  if (digest.eventsByType.theme_publish.length > 0) {
    sections.push(buildEventSection(
      "🎨 Theme Published",
      digest.eventsByType.theme_publish,
      "#06b6d4" // cyan
    ));
  }

  const sectionsHtml = sections.join("");

  // Summary stats
  const highPriorityBadge = digest.highPriorityCount > 0
    ? `<span style="background: #fef2f2; color: #dc2626; padding: 4px 12px; border-radius: 12px; font-size: 13px; font-weight: 600;">${digest.highPriorityCount} High Priority</span>`
    : "";

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>StoreGuard Daily Digest</title>
</head>
<body style="margin: 0; padding: 0; background: #f3f4f6; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
  <div style="max-width: 600px; margin: 0 auto; padding: 24px;">
    <!-- Header -->
    <div style="background: #000; color: #fff; padding: 24px; border-radius: 12px 12px 0 0; text-align: center;">
      <h1 style="margin: 0; font-size: 24px; font-weight: 600;">🛡️ StoreGuard</h1>
      <p style="margin: 8px 0 0; opacity: 0.8; font-size: 14px;">Daily Digest for ${shopName}</p>
    </div>

    <!-- Summary -->
    <div style="background: #fff; padding: 24px; border-bottom: 1px solid #e5e7eb;">
      <p style="margin: 0 0 12px; color: #6b7280; font-size: 14px;">${dateStr}</p>
      <div style="display: flex; align-items: center; gap: 12px; flex-wrap: wrap;">
        <span style="background: #f3f4f6; color: #374151; padding: 8px 16px; border-radius: 8px; font-size: 16px; font-weight: 600;">
          ${digest.totalChanges} Change${digest.totalChanges !== 1 ? "s" : ""} Detected
        </span>
        ${highPriorityBadge}
      </div>
    </div>

    <!-- Event Sections -->
    <div style="background: #fff;">
      ${sectionsHtml}
    </div>

    <!-- Footer -->
    <div style="background: #fff; padding: 24px; border-radius: 0 0 12px 12px; border-top: 1px solid #e5e7eb; text-align: center;">
      <p style="margin: 0 0 8px; color: #6b7280; font-size: 13px;">
        You're receiving this because you enabled daily digests in StoreGuard.
      </p>
      <p style="margin: 0; color: #9ca3af; font-size: 12px;">
        <a href="https://${digest.shop}/admin/apps/storeguard/settings" style="color: #6b7280;">Manage notification settings</a>
      </p>
    </div>
  </div>
</body>
</html>
`.trim();
}

/**
 * Build HTML section for a group of events
 */
function buildEventSection(
  title: string,
  events: DigestSummary["eventsByType"]["price_change"],
  accentColor: string
): string {
  const eventItems = events
    .map((event) => {
      const importanceDot = event.importance === "high"
        ? `<span style="display: inline-block; width: 8px; height: 8px; background: #ef4444; border-radius: 50%; margin-right: 8px;"></span>`
        : "";

      return `
        <div style="padding: 12px 0; border-bottom: 1px solid #f3f4f6;">
          ${importanceDot}<strong style="color: #111827;">${event.resourceName}</strong>
          <div style="margin-top: 4px; color: #6b7280; font-size: 13px;">
            ${formatChangeDescription(event)}
          </div>
        </div>
      `;
    })
    .join("");

  return `
    <div style="padding: 0 24px;">
      <div style="padding: 16px 0; border-bottom: 2px solid ${accentColor};">
        <h2 style="margin: 0; font-size: 16px; font-weight: 600; color: #111827;">${title}</h2>
        <p style="margin: 4px 0 0; font-size: 13px; color: #6b7280;">${events.length} change${events.length !== 1 ? "s" : ""}</p>
      </div>
      ${eventItems}
    </div>
  `;
}

/**
 * Format change description for email
 */
function formatChangeDescription(event: DigestSummary["eventsByType"]["price_change"][0]): string {
  const time = event.detectedAt.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });

  switch (event.eventType) {
    case "price_change":
      return `${event.beforeValue} → ${event.afterValue} • ${time}`;
    case "visibility_change":
      return `${event.beforeValue} → ${event.afterValue} • ${time}`;
    case "inventory_low":
      return `Stock dropped to ${event.afterValue} units (was ${event.beforeValue}) • ${time}`;
    case "inventory_zero":
      // afterValue may contain location context
      if (event.afterValue && event.afterValue !== "0") {
        return `${event.afterValue} (was ${event.beforeValue} units) • ${time}`;
      }
      return `Now out of stock (was ${event.beforeValue} units) • ${time}`;
    case "theme_publish":
      return `Now your live theme • ${time}`;
    default:
      return `${event.beforeValue} → ${event.afterValue} • ${time}`;
  }
}

/**
 * Send daily digest email for a shop
 */
export async function sendDigestEmail(digest: DigestSummary): Promise<SendEmailResult> {
  const shopName = digest.shop.replace(".myshopify.com", "");
  const subject = `🛡️ StoreGuard: ${digest.totalChanges} change${digest.totalChanges !== 1 ? "s" : ""} detected on ${shopName}`;

  const html = generateDigestEmailHtml(digest);

  return sendEmail(digest.alertEmail, subject, html);
}

// ============================================
// INSTANT ALERTS
// ============================================

interface InstantAlertEvent {
  eventType: string;
  resourceName: string;
  beforeValue: string | null;
  afterValue: string | null;
  importance: string;
  detectedAt: Date;
}

/**
 * Get subject line for instant alert based on event type
 */
function getInstantAlertSubject(event: InstantAlertEvent, shopName: string): string {
  switch (event.eventType) {
    case "price_change":
      return `⚡ Price changed: ${event.resourceName} - ${shopName}`;
    case "visibility_change":
      return `⚡ Product ${event.afterValue === "active" ? "published" : "hidden"}: ${event.resourceName} - ${shopName}`;
    case "inventory_low":
      return `⚠️ Low stock: ${event.resourceName} (${event.afterValue} left) - ${shopName}`;
    case "inventory_zero":
      return `🚨 Out of stock: ${event.resourceName} - ${shopName}`;
    case "theme_publish":
      return `🎨 Theme published: ${event.resourceName} - ${shopName}`;
    default:
      return `⚡ Change detected: ${event.resourceName} - ${shopName}`;
  }
}

/**
 * Get alert icon based on event type
 */
function getAlertIcon(eventType: string): string {
  switch (eventType) {
    case "price_change": return "💰";
    case "visibility_change": return "👁️";
    case "inventory_low": return "⚠️";
    case "inventory_zero": return "🚨";
    case "theme_publish": return "🎨";
    default: return "⚡";
  }
}

/**
 * Get alert color based on event type
 */
function getAlertColor(eventType: string): string {
  switch (eventType) {
    case "price_change": return "#f59e0b";
    case "visibility_change": return "#8b5cf6";
    case "inventory_low": return "#f97316";
    case "inventory_zero": return "#ef4444";
    case "theme_publish": return "#06b6d4";
    default: return "#6b7280";
  }
}

/**
 * Generate HTML for instant alert email
 */
function generateInstantAlertHtml(
  event: InstantAlertEvent,
  shop: string
): string {
  const shopName = shop.replace(".myshopify.com", "");
  const icon = getAlertIcon(event.eventType);
  const color = getAlertColor(event.eventType);
  const time = event.detectedAt.toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });

  // Build change description
  let changeDescription = "";
  switch (event.eventType) {
    case "price_change":
      changeDescription = `Price changed from ${event.beforeValue} to ${event.afterValue}`;
      break;
    case "visibility_change":
      changeDescription = `Status changed from ${event.beforeValue} to ${event.afterValue}`;
      break;
    case "inventory_low":
      // afterValue may contain location context, e.g. "3 (Warehouse NYC has 3 left, 10 units at 2 other locations)"
      changeDescription = `Stock dropped to ${event.afterValue} units (was ${event.beforeValue})`;
      break;
    case "inventory_zero":
      // afterValue may contain location context, e.g. "0 (Warehouse NYC hit zero, but 45 units remain across 2 other locations)"
      changeDescription = event.afterValue && event.afterValue !== "0"
        ? `${event.afterValue} (was ${event.beforeValue} units)`
        : `Now out of stock (was ${event.beforeValue} units)`;
      break;
    case "theme_publish":
      changeDescription = `"${event.resourceName}" is now your live theme`;
      break;
    default:
      changeDescription = `${event.beforeValue || ""} → ${event.afterValue || ""}`;
  }

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>StoreGuard Alert</title>
</head>
<body style="margin: 0; padding: 0; background: #f3f4f6; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
  <div style="max-width: 500px; margin: 0 auto; padding: 24px;">
    <!-- Header -->
    <div style="background: ${color}; color: #fff; padding: 20px; border-radius: 12px 12px 0 0; text-align: center;">
      <div style="font-size: 32px; margin-bottom: 8px;">${icon}</div>
      <h1 style="margin: 0; font-size: 18px; font-weight: 600;">Instant Alert</h1>
      <p style="margin: 4px 0 0; opacity: 0.9; font-size: 13px;">${shopName}</p>
    </div>

    <!-- Content -->
    <div style="background: #fff; padding: 24px; border-radius: 0 0 12px 12px;">
      <h2 style="margin: 0 0 8px; font-size: 18px; font-weight: 600; color: #111827;">
        ${event.resourceName}
      </h2>
      <p style="margin: 0 0 16px; color: #374151; font-size: 15px;">
        ${changeDescription}
      </p>
      <p style="margin: 0; color: #9ca3af; font-size: 13px;">
        Detected at ${time}
      </p>

      <!-- Action -->
      <div style="margin-top: 24px; padding-top: 16px; border-top: 1px solid #e5e7eb;">
        <a href="https://${shop}/admin"
           style="display: inline-block; background: #000; color: #fff; padding: 10px 20px; border-radius: 6px; text-decoration: none; font-size: 14px; font-weight: 500;">
          View in Shopify Admin
        </a>
      </div>
    </div>

    <!-- Footer -->
    <p style="margin: 16px 0 0; text-align: center; color: #9ca3af; font-size: 12px;">
      <a href="https://${shop}/admin/apps/storeguard/settings" style="color: #6b7280;">Manage instant alerts</a>
    </p>
  </div>
</body>
</html>
`.trim();
}

/**
 * Send instant alert email for a single change event
 */
export async function sendInstantAlert(
  event: InstantAlertEvent,
  shop: string,
  alertEmail: string
): Promise<SendEmailResult> {
  const shopName = shop.replace(".myshopify.com", "");
  const subject = getInstantAlertSubject(event, shopName);
  const html = generateInstantAlertHtml(event, shop);

  console.log(`[StoreGuard] Sending instant alert: ${event.eventType} for ${event.resourceName}`);

  return sendEmail(alertEmail, subject, html);
}
