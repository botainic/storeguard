# StoreGuard — App Overview

**Tagline:** Know every change before it costs you money.

**Category:** Store Protection & Change Monitoring
**Platform:** Shopify App Store (Embedded App)
**Developer:** MintBird Studio
**URL:** https://storeguard-app.onrender.com
**Email:** alerts@mintbird.io

---

## What StoreGuard Does

StoreGuard monitors a Shopify store for changes that cost merchants money — prices modified unexpectedly, products going out of stock, items hidden from customers, collections deleted, discounts changed, themes swapped — and alerts them before the damage adds up.

It works by listening to Shopify webhooks in real time, comparing current state against stored snapshots, classifying each change by severity, and presenting everything in a timeline. Merchants also get email alerts (daily digest + weekly health report) so they don't have to check the app constantly.

---

## The Problem

Shopify stores experience constant changes from staff edits, app integrations, bulk operations, and theme updates. Most merchants have zero visibility into what changed and when. A mispriced product can run for hours. A hidden bestseller can go unnoticed for days. An out-of-stock product loses sales silently.

---

## How It Works

### Install Protection Scan

On first install, StoreGuard runs an immediate risk scan of the store:

- **Zero inventory** — products that can't be purchased right now
- **Low stock** — variants below a configurable threshold
- **Zero price** — products priced at $0 (customers can check out without paying)
- **Low price** — products under $1 (likely errors)
- **Recent activity** — how many products were edited in the last 30 days
- **Theme status** — when the live theme was last changed
- **Discount exposure** — active high-value discounts (40%+ or $50+)

Results are presented as a "Protection Baseline" — the merchant sees their store's risk profile in under 60 seconds, before they configure anything.

### Real-Time Change Detection

After onboarding, StoreGuard monitors via Shopify webhooks:

| What's Monitored | Severity | Plan |
|---|---|---|
| Price changes (shows old → new) | Varies | Free |
| Inventory hitting zero ("Cannot Be Purchased") | High | Free |
| Low stock warnings | Medium | Free |
| Products hidden/archived ("Product Hidden") | High | Free |
| Products restored to active | Low | Free |
| Collection created/updated/deleted | Medium | Free |
| Discount created/changed/deleted | Medium | Pro |
| Live theme replaced | High | Pro |
| App permission expansions | High | Pro |
| Domain added/changed/removed | High | Pro |

All webhooks ACK within 500ms. Processing happens in a background job queue with atomic job claiming (no duplicates, no race conditions).

### Changes Tab

The main view shows all detected changes in chronological order. Each event has:

- Event type badge with color coding
- Importance level (High/Medium/Low)
- Resource name
- Date
- Before → After values where applicable

Risk-first language throughout: "Cannot Be Purchased" instead of "Out of Stock," "Live Theme Replaced" instead of "Theme Published," "Product Hidden" instead of "Visibility Change."

### Settings Tab

Merchants can:

- Toggle each monitor type on/off
- Set low stock threshold (default: 5 units)
- Add/remove email recipients
- Enable instant alerts (Pro)
- View and manage their plan

### Email Alerts

Three types:

1. **Daily Digest** — summary of all changes from the past 24 hours, sent at ~8am UTC
2. **Weekly Health Report** — sent every Monday regardless of activity, with three sections:
   - Activity This Week (change counts by type)
   - Current Exposure Snapshot (zero stock, low stock, zero price, high discounts)
   - Protection Reminder with CTA back to the app
3. **Instant Alerts** (Pro) — immediate email for critical changes (price drops, out of stock, products hidden, domain removals, permission expansions)

All emails are responsive HTML, tested in Gmail, Outlook, and Apple Mail. Sent from `alerts@mintbird.io` via Resend. Clean text branding, no emoji.

### Revenue Impact

Each change event includes an estimated revenue impact using sales velocity data and a conservative 50% factor. Shown per-event in the changes timeline.

---

## Pricing

| | Free | Pro ($19/mo) |
|---|---|---|
| Products monitored | Up to 50 | Unlimited |
| Price change alerts | Yes | Yes |
| Inventory alerts | Yes | Yes |
| Visibility alerts | Yes | Yes |
| Collection alerts | Yes | Yes |
| Daily digest email | Yes | Yes |
| Weekly health report | Yes | Yes |
| Install protection scan | Yes | Yes |
| Discount monitoring | — | Yes |
| Theme monitoring | — | Yes |
| App permission monitoring | — | Yes |
| Domain monitoring | — | Yes |
| Instant email alerts | — | Yes |
| Revenue impact estimates | — | Yes |
| Context enrichment | — | Yes |

Billing via Shopify Managed Pricing (configured in Partners App Store listing, not via Billing API).

---

## Privacy & GDPR

- No customer PII stored — no names, emails, addresses, phone numbers
- Automatic data deletion on app uninstall (shop/redact webhook)
- 90-day data retention with automatic purge
- Third-party services: Render (hosting), Resend (email)
- Full privacy policy at `/privacy`

---

## Technical Stack

- **Framework:** React Router (Remix) + Shopify App Bridge
- **Language:** TypeScript
- **Database:** PostgreSQL via Prisma ORM
- **Hosting:** Render (Starter web service + basic DB)
- **Email:** Resend (verified domain: mintbird.io)
- **Scopes:** `read_products, read_inventory, read_themes, read_discounts, read_orders`
- **Webhooks:** 17 subscriptions across products, inventory, themes, collections, discounts, domains, app permissions, GDPR

### Key Services

| Service | Purpose |
|---------|---------|
| `riskScan.server.ts` | Install protection scan (inventory, prices, discounts, themes) |
| `jobProcessor.server.ts` | Background webhook job queue |
| `changeDetection.server.ts` | Price, visibility, inventory change detection |
| `contextEnricher.server.ts` | Business context for alerts |
| `moneySaved.utils.ts` | Revenue impact estimation |
| `dailyDigest.server.ts` | Daily email digest compilation |
| `weeklyHealthSummary.server.ts` | Weekly health report generation |
| `emailTemplates.server.ts` | Responsive HTML email templates (digest, instant, weekly) |
| `emailService.server.ts` | Email sending via Resend |
| `scheduler.server.ts` | In-process cron (daily digest + weekly summary) |
| `salesVelocity.server.ts` | Sales velocity for revenue impact |
| `productSync.server.ts` | Initial product sync with cursor-based pagination |
| `shopService.server.ts` | Plan management, feature gating |

### Data Model

| Table | Purpose |
|-------|---------|
| `Shop` | Store settings, plan, alert config, risk scan results |
| `ChangeEvent` | All detected changes (main timeline) |
| `ProductSnapshot` | Latest product state for diff detection |
| `VariantSnapshot` | Per-variant atomic snapshots (price, inventory, visibility) |
| `WebhookJob` | Background job queue with atomic claiming |
| `ProductCache` | Product title cache for display |

---

## Infrastructure

| Component | Details |
|-----------|---------|
| App URL | https://storeguard-app.onrender.com |
| Render Service | srv-d5vmdq1r0fns73ee53v0 (Starter, Oregon) |
| Database | storeguard-db-v2 (basic_256mb, $1/mo) |
| Monthly Cost | $8 (web $7 + DB $1) |
| Repository | github.com/botainic/storeguard |
| Shopify Partners | MintBird Studio (org 4646756) |
| App Store | Published, 2 active merchants |
| Dev Store | insight-ops-dev.myshopify.com |
| Tests | 298 passing across 13 test files |

---

## Current Status

All V2 features and Phase 1 Retention complete:

- 28 V2 tickets (BOT-5 through BOT-28) — Done
- BOT-29: Install Protection Scan — Done
- BOT-30: Enhanced Scan + Risk Language — Done
- BOT-31: Weekly Health Summary Email — Done
- All emails E2E tested (delivered to Gmail inbox)
- App live and serving 2 active merchants

### What's Next

1. Store listing polish (description, screenshots, pricing config)
2. Shopify deploy with latest changes
3. Target "Built for Shopify" badge
