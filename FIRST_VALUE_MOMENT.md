# First Value Moment — "Risk Scan" Onboarding

## Problem
New installs see an empty dashboard. No alerts, no signal, no reason to stay.
Retention dies in the first 2 minutes.

## Solution
Replace the current 5-step onboarding wizard with a 2-step setup + live Risk Scan.
The merchant sees immediate value: out-of-stock products, recent activity, active discounts.

## Constraints
- Shopify has NO historical change diff API
- We only get current state on install
- But we CAN detect: current inventory levels, `updated_at` timestamps, active discounts, theme publish date
- Shopify Events API (`/admin/api/events.json`) gives admin action logs (limited but useful)

---

## New Onboarding Flow

### Step 1 — Ultra Fast Setup (10 seconds)
- Email for alerts (pre-filled if available)
- Monitor toggles (all on by default, greyed-out Pro ones visible)
- Single "Start Monitoring" button
- NO welcome screen, NO "what is StoreGuard" fluff

### Step 2 — Live Risk Scan (30-60 seconds)
Progress bar with live counters:
```
🔍 Scanning your store...
   Products scanned: 142 ✓
   Variants analyzed: 387 ✓
   Inventory checked: 387 ✓
   Discounts reviewed: 3 ✓
   Theme status: checked ✓
```
Make it feel active. Each line appears as the scan progresses.

### Step 3 — Risk Scan Results (the dopamine hit)

Three sections, tension-first language:

#### 🚨 Immediate Risks
```
⚠️ 12 products cannot be purchased right now (inventory = 0)
⚠️ 5 variants are below your low-stock threshold (< 5 units)
⚠️ 3 active discounts over 40% off
```
If no risks: "✅ No immediate risks detected. Your store looks healthy."
(Even that is relief — and still valuable.)

#### 📈 Recent Activity
```
47 products were edited in the last 30 days
  → Changes happen more often than most owners realize.
8 collections were modified
Your live theme was changed 4 days ago
  → If that wasn't intentional, we would have alerted you instantly.
```
Source: `updated_at` timestamps from products/collections, theme `updated_at`.

#### 🛡️ Monitoring Activated
```
From this moment forward, StoreGuard will alert you when:
• Prices change unexpectedly
• Inventory hits zero
• Products go invisible
• Collections are edited
• Themes are published
• Discounts are modified
```
Explicit. Concrete. No ambiguity about what they're getting.

---

## Technical Implementation

### Data Sources (all available at sync time)

| Signal | Source | Query |
|--------|--------|-------|
| Zero inventory variants | ProductVariant.inventoryQuantity | Already in sync |
| Low stock variants | ProductVariant.inventoryQuantity < threshold | Already in sync |
| Recently modified products | Product.updatedAt | Already in sync |
| Active discounts | `discounts` GraphQL query | New query needed |
| Discount amounts | PriceRule/DiscountNode value | New query needed |
| Theme last published | `themes` GraphQL query | New query needed |
| Collections modified | Collection.updatedAt | New query needed |
| Total products/variants | Count from sync | Already available |

### New Service: `riskScan.server.ts`

```typescript
interface RiskScanResult {
  // Immediate risks
  zeroStockProducts: { id: string; title: string; variantCount: number }[];
  lowStockVariants: { id: string; productTitle: string; variantTitle: string; quantity: number }[];
  highDiscounts: { id: string; title: string; value: string; type: string }[];

  // Recent activity
  recentlyModifiedProducts: number; // count modified in last 30 days
  recentlyModifiedCollections: number;
  themeLastPublished: { name: string; daysAgo: number } | null;

  // Totals
  totalProducts: number;
  totalVariants: number;
  totalDiscounts: number;
  totalCollections: number;

  // Scan metadata
  scannedAt: string;
}
```

### DB Changes
- Add `riskScanResult: Json?` to Shop model (cache the initial scan)
- Add `riskScannedAt: DateTime?` to Shop model

### Route Changes
- `app._index.tsx`: Rewrite onboarding to 2 steps + risk scan
- New loader data: risk scan results after sync completes
- SSE or polling for live scan progress (reuse existing sync status pattern)

### Scope
- Discounts query: `discountNodes(first: 50)` — get active discounts, filter >40%
- Collections query: `collections(first: 250)` — get `updatedAt` for activity count
- Theme query: `themes(first: 10, roles: MAIN)` — get live theme publish date
- These queries run ONCE at onboarding, results cached in Shop record

---

## What Changes vs Current Code

### Remove
- 5-step wizard (Welcome → Email → Monitors → Sync → Done)
- `onboarding.utils.ts` ONBOARDING_STEPS enum (simplify to 2 steps)
- "Sync complete" messaging

### Keep
- Email input + monitor toggles (compress into step 1)
- Product sync logic (step 2 runs it)
- `completeOnboarding()` (called after risk scan)

### Add
- `riskScan.server.ts` — orchestrates the additional queries
- Risk scan results UI (the 3 sections)
- Live scan progress indicators
- Risk-framed copy throughout

---

## Success Metric
- Time to first "oh shit" moment: < 60 seconds from install
- Retention: merchant returns within 48 hours (currently unknown baseline)

---

## Priority: P0
This is more important than any remaining feature. An unused feature is a zero.
