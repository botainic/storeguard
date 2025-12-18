Here is the comprehensive Product Requirements Document (PRD) for **InsightOps**, tailored for your engineering team. This document synthesizes your "History Layer" strategy with the technical constraints and workarounds identified in our research.

-----

# Product Requirements Document: InsightOps (MVP)

**Internal Codename:** Project Flight Recorder
**Version:** 1.0
**Status:** Ready for Build
**Target Launch:** Shopify App Store (Organic ASO Strategy)

-----

## 1\. Executive Summary

**InsightOps** is a "Flight Recorder" for Shopify stores. While standard analytics tools tell merchants *what* happened (e.g., "Sales dropped 20%"), InsightOps tells them *why* (e.g., "Steve changed the Free Shipping threshold 2 hours ago").

  * **The Problem:** Shopify’s native "Activity Log" is buried, limited to \~250 entries, and often fails to attribute changes to specific staff members. Merchants fear "Phantom Changes" where settings break silently, and existing apps like Logify suffer from poor reliability and lack of detail.
  * **The Solution:** An app that creates a real-time, Twitter-style "Feed" of store changes, identifies the staff member responsible via a proprietary API workaround, and correlates these events with sales data to prove causality.

-----

## 2\. Target Audience

  * **Primary Segment:** Merchants on "Shopify" ($79/mo) or "Advanced" ($399/mo) plans.
  * **Profile:** Stores with 2–15 staff members/collaborators. Solopreneurs (Basic plan) generally don't have the "who did this?" pain point.
  * **User Persona:** The Store Owner or Operations Manager who is tired of asking, "Who touched this product?"

-----

## 3\. Core Value Proposition (The Wedge)

1.  **Radical Transparency:** "See exactly who changed a price, theme, or setting in real-time."
2.  **Causality:** "Stop guessing why sales dropped. See the event that caused it."
3.  **Accountability:** A "Blame" system that acts as a deterrent for careless errors.

-----

## 4\. MVP Feature Scope (Phase 1)

### A. The "Flight Recorder" (Backend)

  * **Objective:** Ingest events from Shopify and attribute them to a specific User ID.
  * **Constraint:** Standard Shopify webhooks (e.g., `products/update`) do *not* contain the user ID of the staff member who made the change.
  * **Solution: "Trigger & Fetch" Architecture**
    1.  **Trigger:** Listen for Webhooks (`products/update`, `themes/update`, `script_tags/create`).
    2.  **Delay:** Wait \~2 seconds to allow Shopify's internal logging to propagate.
    3.  **Fetch:** Query the Shopify Events API (`/admin/products/{id}/events.json`) for the specific resource.
    4.  **Match:** Extract the `author` field (e.g., "John Smith") from the event log.
    5.  **Store:** Save to our database (`EventLog`) with timestamp, resource ID, User Name, and specific Diff.

### B. The "Activity Feed" (Frontend Dashboard)

  * **Style:** Chronological feed (Twitter/X style). Clean, fast, and searchable.
  * **Card Design:**
      * **Avatar:** Staff member initials.
      * **Headline:** "Steve updated **Blue T-Shirt**."
      * **Detail:** "Price changed: \~\~$20.00~~ → **$15.00\*\*."
      * **Time:** "2 hours ago."
      * **Tag:** Badge for "Price," "Inventory," "Theme," or "App."

### C. The "Sales Pulse" (Context Layer)

  * **Objective:** Show the *impact* of the change immediately, addressing the "correlation vs causation" gap.
  * **Feature:** A simple Sparkline chart (last 24h sales) pinned to the top of the dashboard.
  * **Interaction:** When a user hovers over a "Price Change" event in the feed, a vertical line appears on the sparkline at that specific timestamp, visually linking the action to the sales trend.

-----

## 5\. Technical Specifications

### Architecture

  * **Platform:** Shopify App (Node.js) using **Remix** framework.
  * **Language:** **TypeScript** (Mandatory for strict type safety on API payloads).
  * **Database:** Prisma (SQLite for Dev / PostgreSQL for Prod).
  * **Hosting:** Shopify Managed Hosting (App Bridge).

### Data Schema (Draft)

```typescript
model EventLog {
  id          String   @id @default(uuid())
  shop        String   // The store URL
  shopifyId   String   // The Resource ID (e.g., Product ID)
  topic       String   // e.g., "products/update"
  author      String?  // The "Blame" retrieved via Events API
  message     String   // Description of change
  diff        Json?    // { old: 20, new: 15 }
  timestamp   DateTime @default(now())
}
```

### Critical Implementation Detail: The "Blame" Workaround

The Engineering team must implement a `setTimeout` delay (approx 2000ms) after receiving the webhook before calling the `events` REST endpoint.

  * **Why:** The Events API is slightly lagging behind the Webhook fire.
  * **Fallback:** If the Events API returns no author (rare, or if done by an app), log the author as "System/App."
  * **Note:** We acknowledge that strictly granular theme edits might be harder to attribute than products. For MVP, prioritize **Product** and **Inventory** changes where the API is most reliable.

-----

## 6\. User Stories (Acceptance Criteria)

| Story ID | Role | Action | Outcome |
| :--- | :--- | :--- | :--- |
| **US-1** | Store Owner | I change a product price in Shopify Admin. | The app dashboard shows a new card: "Owner updated Product Price" with the old vs. new price. |
| **US-2** | Store Owner | My staff member "Steve" changes a Product. | The feed logs: "Steve updated Product." The system correctly identifies "Steve" as the author via the API workaround. |
| **US-3** | Store Owner | I view the "Activity Feed." | I see a chronological list of changes sorted by newest first. |
| **US-4** | Developer | A webhook fires. | The system waits 2s, fetches the Author from Events API, and writes to DB. |

-----

## 7\. Go-to-Market & ASO Strategy

  * **App Name:** InsightOps: Activity Audit Log
  * **Subtitle:** Track staff changes, price edits, and profit impact.
  * **Keywords:** Target niche terms like "Audit Trail," "Staff Activity," "History Log," and "Price Tracker" rather than broad terms like "Analytics".
  * **Pricing Strategy:**
      * **Free Plan:** View last 50 events (Retention Hook).
      * **Pro Plan ($29/mo):** Unlimited History + Sales Pulse Correlation.

-----

## 8\. Out of Scope (For MVP)

  * **"Undo" Button:** Research indicates this is technically complex and high-risk for V1.
  * **Gamification/Badges:** While gamification increases engagement, we will prioritize trust and utility for V1.
  * **Theme Code Diffs:** We will log *that* a theme was changed, but not the specific line-of-code diffs for MVP, as this is a known API limitation.

-----

## 9\. Immediate Next Steps

1.  **Initialize Project:** Set up Shopify App CLI with **Remix + TypeScript**.
2.  **Database Setup:** Configure Prisma with the `EventLog` schema.
3.  **Prototype Logic:** Implement the `webhooks.tsx` listener with the **Delay + Fetch** logic pattern.
4.  **Validation:** Run the "Weekend Test" to confirm we can print "WHO: [Your Name]" in the terminal logs when a price is changed.