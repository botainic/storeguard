/**
 * Email Service for StoreGuard
 *
 * Sends emails via Resend API. Template generation is in emailTemplates.server.ts.
 * Environment variables required:
 * - RESEND_API_KEY: Your Resend API key
 * - DIGEST_FROM_EMAIL: Sender email (e.g., alerts@storeguard.app)
 */

import type { DigestSummary } from "./dailyDigest.server";
import type { WeeklyHealthSummary } from "./weeklyHealthSummary.server";
import {
  generateDigestEmailHtml,
  generateInstantAlertHtml,
  generateWeeklyHealthSummaryHtml,
  getInstantAlertSubject,
  type InstantAlertEvent,
} from "./emailTemplates.server";

// Re-export template functions for consumers that import from here
export { generateDigestEmailHtml, generateInstantAlertHtml, generateWeeklyHealthSummaryHtml, type InstantAlertEvent };

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
 * Send daily digest email for a shop
 */
export async function sendDigestEmail(digest: DigestSummary): Promise<SendEmailResult> {
  const shopName = digest.shop.replace(".myshopify.com", "");
  const subject = `StoreGuard: ${digest.totalChanges} change${digest.totalChanges !== 1 ? "s" : ""} detected on ${shopName}`;

  const html = generateDigestEmailHtml(digest);

  return sendEmail(digest.alertEmail, subject, html);
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

/**
 * Send weekly health summary email for a shop
 */
export async function sendWeeklySummary(
  summary: WeeklyHealthSummary
): Promise<SendEmailResult> {
  const subject = "Your StoreGuard Weekly Health Report";
  const html = generateWeeklyHealthSummaryHtml(summary);

  console.log(`[StoreGuard] Sending weekly summary to ${summary.alertEmail} for ${summary.shop}`);

  return sendEmail(summary.alertEmail, subject, html);
}
