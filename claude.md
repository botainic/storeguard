# StoreGuard - Project Intelligence File

> This file is the single source of truth for AI assistants working on this project.
> It tracks architecture decisions, progress, patterns, and critical context.

## Project Overview

**StoreGuard** is a Shopify app that monitors store changes and sends daily digest alerts.
This is a rebuild/simplification of InsightOps, focusing on change detection and alerting.

### Value Proposition
Store owners lose revenue when unauthorized or accidental changes happen:
- Prices silently changed
- Products unpublished
- Inventory hits zero without notice
- Theme published unexpectedly

StoreGuard watches for these changes and sends a daily digest email.

---

## Architecture Decision: Leverage Existing Codebase

**Decision Date**: 2026-01-30

### Why Leverage (Not Rebuild):
1. **70% infrastructure reuse** - Auth, webhooks, job queue, sessions production-ready
2. **StoreGuard is simpler** - No analytics, no charts, just detection + alerts
3. **Proven patterns** - Webhook deduplication, retries, multi-tenancy already solved
4. **Modern stack** - React Router v7, Prisma 6, TypeScript strict, Shopify latest API
5. **Time to market** - Weeks vs. months for fresh build

### What We Keep:
- Shopify OAuth + App Bridge integration
- Background job queue with retries (`jobQueue.server.ts`, `jobProcessor.server.ts`)
- Prisma + PostgreSQL schema (evolving it)
- Webhook infrastructure (`webhooks/*.tsx`)
- Session storage (`shopify.server.ts`)

### What We Remove:
- Sales impact analysis (`productSales.server.ts`, `impactAnalysis.ts`)
- ShopifyQL analytics (`analytics.server.ts`)
- Sales charts in UI (`app._index.tsx` - significant portion)
- Product sales aggregation (`ProductSalesPoint` model)

### What We Add:
- Theme webhook handler (`themes/publish`)
- Daily digest generator + email templates
- Settings page with toggles
- `change_events` table (cleaner than EventLog for alerts)
- Free/Pro feature gates with Stripe

---

## Tech Stack

| Layer | Technology | Version | Notes |
|-------|------------|---------|-------|
| **Runtime** | Node.js | 20.19+ or 22.12+ | Required by Shopify CLI |
| **Framework** | React Router v7 | 7.x | SSR + API routes |
| **Language** | TypeScript | 5.9 | Strict mode enabled |
| **Database** | PostgreSQL | 15+ | Via Prisma ORM |
| **ORM** | Prisma | 6.16 | Type-safe queries |
| **UI** | Shopify Polaris | Web Components | Official Shopify design |
| **Icons** | Lucide React | 0.556 | Lightweight icon set |
| **Testing** | Vitest | 4.0 | Unit + integration |
| **Shopify API** | Admin API | 2025-10 | Latest stable |
| **Email** | TBD | - | Resend or Postmark recommended |

---

## Database Schema (Target State)

### Existing Models (Keep)
```prisma
model Session {
  // Shopify OAuth sessions - DO NOT MODIFY
}

model ProductCache {
  // Product name cache for delete events - KEEP
}

model WebhookJob {
  // Background job queue - KEEP
}

model ShopSync {
  // Product sync progress - KEEP
}
```

### Modified Models
```prisma
model Shop {
  id               String   @id @default(uuid())
  shopifyDomain    String   @unique
  plan             String   @default("free") // "free" | "pro"
  alertEmail       String?
  trackPrices      Boolean  @default(true)
  trackVisibility  Boolean  @default(true)
  trackInventory   Boolean  @default(true)
  trackThemes      Boolean  @default(false) // Pro only
  installedAt      DateTime @default(now())
  uninstalledAt    DateTime?
}

model ChangeEvent {
  id           String   @id @default(uuid())
  shop         String
  entityType   String   // "product" | "variant" | "theme"
  entityId     String   // Shopify ID of the entity
  eventType    String   // "price_change" | "visibility_change" | "inventory_zero" | "theme_publish"
  resourceName String   // Human-readable name for display
  beforeValue  String?  // Previous value
  afterValue   String?  // New value
  detectedAt   DateTime @default(now())
  digestedAt   DateTime? // When included in daily digest
  source       String   @default("webhook") // "webhook" | "sync_job" | "manual"
  importance   String   @default("medium") // "high" | "medium" | "low"
  groupId      String?  // For grouping related changes (bulk edits)
  webhookId    String   @unique // Deduplication

  @@index([shop])
  @@index([shop, detectedAt])
  @@index([shop, eventType])
  @@index([digestedAt])
  @@index([shop, entityType, entityId])
}

model ProductSnapshot {
  id          String   @id // Shopify product ID
  shop        String
  title       String
  status      String   // "active" | "draft" | "archived"
  variants    String   // JSON: [{id, title, price, inventoryQuantity}]
  updatedAt   DateTime @updatedAt

  @@unique([shop, id])
  @@index([shop])
}
```

### Removed Models
- `EventLog` - Replaced by `ChangeEvent` (cleaner, purpose-built)
- `ProductSalesPoint` - Not needed (no analytics)

---

## Change Detection Rules (Explicit)

### Price Change Detection (ISSUE #6)
- **Rule**: `price_before !== price_after`
- **Granularity**: One event per variant that changed
- **Entity**: `variant`
- **Importance**: Based on change magnitude (>=50% = high, >=20% = medium, <20% = low)
- **Ignore**: No-op updates where Shopify sends same price

### Visibility Change Detection (ISSUE #7)
- **Rule**: Specific status transitions only
- **Tracked Transitions**:
  - `active -> draft` (hidden from store) - HIGH importance
  - `active -> archived` (hidden from store) - HIGH importance
  - `draft -> active` (visible on store) - MEDIUM importance
  - `archived -> active` (visible on store) - MEDIUM importance
- **Ignored**: `draft <-> archived` (both hidden, not meaningful)
- **Entity**: `product`

### Inventory Zero Detection (ISSUE #8)
- **Rule**: Only trigger on transition `>0 -> 0`
- **Ignore**:
  - `0 -> 0` (no change)
  - `negative -> 0` (edge case)
  - `null -> 0` (unknown previous state)
- **Entity**: `variant` (uses inventory_item_id)
- **Importance**: Always `high`
- **Dedup**: 24-hour window per variant to prevent spam

### Theme Publish Detection (ISSUE #9)
- **Rule**: Only when `theme.role === "main"` (became live theme)
- **Entity**: `theme`
- **Importance**: Always `high`
- **Note**: themes/publish webhook only fires on publish, but we explicitly check role

---

## Sanity Checklist

- [x] We know **what changed** (eventType)
- [x] We know **what entity** (entityType: product/variant/theme)
- [x] We know **which entity** (entityId)
- [x] We know **where** (resourceName for human display)
- [x] We know **when** (detectedAt)
- [x] We can show **before/after** in human-readable way
- [x] We log in a way that's **easy to query** (per shop, indexed)
- [x] We have **importance** for future prioritization
- [x] We have **groupId** for bulk edit correlation

---

## Implementation Plan (GitHub Issues Order)

### Milestone 0: Project & Environment Setup ✅
- [x] Existing Shopify app scaffold (done in InsightOps)
- [x] **ISSUE #1**: Rebrand to StoreGuard (app name, config, UI) - commit `0685820`
- [x] **ISSUE #2**: Database schema migration (new models) - commit `0685820`

### Milestone 1: Shopify Auth & Webhooks ✅
- [x] OAuth flow (existing)
- [x] **ISSUE #3**: Shop model persistence on install - commit `bdaa3cb`
- [x] **ISSUE #4**: Register `themes/publish` webhook - commit `0685820`

### Milestone 2: State Snapshot Engine ✅
- [x] Product snapshot storage
- [x] **ISSUE #5**: Migrate ProductSnapshot model

### Milestone 3: Change Detection (Core Value) ✅
- [x] **ISSUE #6**: Price change detection (per-variant, importance scoring)
- [x] **ISSUE #7**: Product visibility change detection (significant transitions only)
- [x] **ISSUE #8**: Inventory zero detection (>0 -> 0 rule)
- [x] **ISSUE #9**: Theme publish detection (role === "main" only)
- [x] **ISSUE #10**: Recent Changes page (debug UI at /app/changes)

### Milestone 4: Settings & Controls
- [ ] **ISSUE #11**: Settings page (Polaris UI)
- [ ] **ISSUE #12**: Free vs Pro feature gates

### Milestone 5: Daily Digest (The Product)
- [ ] **ISSUE #13**: Daily digest generator
- [ ] **ISSUE #14**: Email template (HTML)
- [ ] **ISSUE #15**: Daily cron job

### Milestone 6: Billing & Monetization
- [ ] **ISSUE #16**: Stripe subscription integration ($19/month)

### Milestone 7: Polish & Launch
- [ ] **ISSUE #17**: App uninstall cleanup
- [ ] **ISSUE #18**: App Store submission prep

---

## File Structure (Target State)

```
insightops/                   # Will rename to storeguard/
├── app/
│   ├── routes/
│   │   ├── _index/           # Auth page (keep)
│   │   ├── app._index.tsx    # Main dashboard (simplify to alerts list)
│   │   ├── app.settings.tsx  # NEW: Settings page
│   │   ├── app.billing.tsx   # Billing (modify for Stripe)
│   │   ├── api.digest.tsx    # NEW: Trigger daily digest
│   │   ├── api.jobs.*.tsx    # Job processing (keep)
│   │   └── webhooks.*.tsx    # Webhook handlers (modify)
│   ├── services/
│   │   ├── changeDetection.server.ts  # NEW: Core detection logic
│   │   ├── dailyDigest.server.ts      # NEW: Digest generator
│   │   ├── emailService.server.ts     # NEW: Email sending
│   │   ├── jobProcessor.server.ts     # MODIFY: Process change events
│   │   ├── jobQueue.server.ts         # KEEP
│   │   └── productSync.server.ts      # KEEP (simplified)
│   ├── utils/
│   │   └── featureGates.ts            # NEW: Free/Pro checks
│   ├── emails/
│   │   └── dailyDigest.tsx            # NEW: Email template
│   ├── db.server.ts          # Keep
│   └── shopify.server.ts     # Keep
├── prisma/
│   └── schema.prisma         # MODIFY: New models
└── shopify.app.toml          # MODIFY: Add themes/publish webhook
```

---

## Critical Patterns & Conventions

### 1. Webhook Processing Pattern
```typescript
// ALWAYS: ACK immediately, process in background
export const action = async ({ request }) => {
  const { shop, topic, payload } = await authenticate.webhook(request);

  // Return immediately (< 5 seconds to avoid Shopify timeout)
  await queueWebhookJob({ shop, topic, payload, delayMs: 2000 });
  return new Response();
};
```

### 2. Change Event Creation
```typescript
// ALWAYS: Check feature gates before creating events
async function createChangeEvent(event: ChangeEventInput) {
  const shop = await getShop(event.shop);

  // Feature gate check
  if (event.eventType === 'theme_publish' && shop.plan !== 'pro') {
    return; // Theme tracking is Pro-only
  }

  if (event.eventType === 'price_change' && !shop.trackPrices) {
    return; // User disabled price tracking
  }

  // Deduplication via webhookId
  await prisma.changeEvent.upsert({...});
}
```

### 3. Snapshot Comparison
```typescript
// ALWAYS: Compare against snapshot, then update snapshot
async function detectChanges(product: Product, snapshot: ProductSnapshot) {
  const changes: ChangeEvent[] = [];

  // Price changes (per variant)
  for (const variant of product.variants) {
    const oldVariant = snapshot.variants.find(v => v.id === variant.id);
    if (oldVariant && oldVariant.price !== variant.price) {
      changes.push({
        eventType: 'price_change',
        beforeValue: oldVariant.price,
        afterValue: variant.price,
        // ...
      });
    }
  }

  // Status changes
  if (product.status !== snapshot.status) {
    changes.push({
      eventType: 'status_change',
      beforeValue: snapshot.status,
      afterValue: product.status,
      // ...
    });
  }

  // Update snapshot AFTER detection
  await updateSnapshot(product);

  return changes;
}
```

### 4. Free vs Pro Gates
```typescript
// Free Plan Limits
const FREE_LIMITS = {
  maxProducts: 50,
  historyDays: 7,
  themeTracking: false,
};

// Check in UI
function SettingsPage() {
  const { plan } = useShop();
  return (
    <Toggle
      label="Track theme changes"
      disabled={plan !== 'pro'}
      helpText={plan !== 'pro' ? 'Upgrade to Pro' : undefined}
    />
  );
}
```

### 5. Daily Digest Query
```typescript
// Get undigested events from last 24 hours
const events = await prisma.changeEvent.findMany({
  where: {
    shop: shopDomain,
    digestedAt: null,
    detectedAt: { gte: twentyFourHoursAgo }
  },
  orderBy: { detectedAt: 'desc' },
  take: 50, // Cap for email sanity
});

// Mark as digested AFTER email sent successfully
await prisma.changeEvent.updateMany({
  where: { id: { in: events.map(e => e.id) } },
  data: { digestedAt: new Date() }
});
```

---

## Environment Variables

```env
# Shopify (existing)
SHOPIFY_API_KEY=xxx
SHOPIFY_API_SECRET=xxx

# Database (existing)
DATABASE_URL=postgresql://...

# Email Service (NEW)
RESEND_API_KEY=xxx            # or POSTMARK_API_KEY
DIGEST_FROM_EMAIL=alerts@storeguard.app

# Stripe (NEW - replaces Shopify billing)
STRIPE_SECRET_KEY=xxx
STRIPE_WEBHOOK_SECRET=xxx
STRIPE_PRO_PRICE_ID=price_xxx

# Jobs
JOB_PROCESSOR_SECRET=xxx      # Existing
```

---

## Current Progress

### Completed
- [x] Initial InsightOps codebase reviewed
- [x] Architecture decision made (leverage existing)
- [x] claude.md created
- [x] GitHub repository renamed to storeguard
- [x] **Milestone 0 complete** - Rebrand + schema migration (commit `0685820`)
  - Rebranded all files from InsightOps to StoreGuard
  - Added Shop, ChangeEvent, ProductSnapshot models
  - Added themes/publish webhook handler
  - Updated all console log prefixes
- [x] **Milestone 1 complete** - Shop persistence (commit `bdaa3cb`)
  - Created shopService.server.ts with getOrCreateShop
  - Shop record created on first app access
  - Uninstall webhook marks shop as uninstalled
- [x] **Milestones 2-3 complete** - Change Detection (core value)
  - Created changeDetection.server.ts with all detection functions
  - Integrated detection into jobProcessor.server.ts
  - Enhanced ChangeEvent model with entityType, source, importance, groupId
  - Explicit detection rules documented and implemented
  - Created Recent Changes debug page at /app/changes
  - Files changed:
    - `prisma/schema.prisma` - Enhanced ChangeEvent model
    - `app/services/changeDetection.server.ts` - Core detection logic
    - `app/services/jobProcessor.server.ts` - Integration
    - `app/services/shopService.server.ts` - Feature gates
    - `app/routes/webhooks.themes.publish.tsx` - Theme detection
    - `app/routes/app.changes.tsx` - Debug UI
    - `app/routes/app.tsx` - Nav link to Changes

### In Progress
- [ ] Milestone 4: Settings page

### Blocked
- None

### Known Issues (Pre-existing)
- Type errors in `productSales.server.ts` and `api.product-impact.tsx` (will be fixed when analytics code is removed)

---

## Key Decisions Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-01-30 | Leverage existing codebase | 70% reuse, faster time to market |
| 2026-01-30 | Stripe for billing | More flexible than Shopify billing, supports annual plans |
| 2026-01-30 | Separate ChangeEvent model | Cleaner than repurposing EventLog, purpose-built for alerts |
| 2026-01-30 | Resend for email | User confirmed - modern, developer-friendly, great deliverability |
| 2026-01-30 | Stripe for billing | User confirmed - more flexible than Shopify billing |
| 2026-01-30 | UTC for digest timezone | User confirmed - simpler for V1, can add timezone later |

---

## Confirmed Decisions

| Question | Decision | Date |
|----------|----------|------|
| Email Provider | **Resend** | 2026-01-30 |
| Billing | **Stripe** | 2026-01-30 |
| Digest Timezone | **UTC** (V1) | 2026-01-30 |
| Cron Job | TBD - Railway cron or Inngest | - |

---

## Files to Delete (Cleanup)

After migration complete, remove:
- `app/services/analytics.server.ts`
- `app/services/productSales.server.ts`
- `app/utils/impactAnalysis.ts`
- `app/utils/impactAnalysis.test.ts`
- `app/routes/api.product-sales.tsx`
- `app/routes/api.product-impact.tsx`
- `app/routes/api.debug-sales.tsx`

---

## Testing Strategy

### Unit Tests (Vitest)
- Change detection logic
- Feature gate enforcement
- Digest grouping logic

### Integration Tests
- Webhook processing end-to-end
- Email template rendering

### Manual Testing
- Shopify dev store with test products
- Trigger webhooks via Shopify admin
- Verify digest email delivery

---

## Launch Checklist

- [ ] All 18 issues completed
- [ ] App listing copy written
- [ ] Screenshots captured (Settings, Digest email)
- [ ] Privacy policy page
- [ ] Support email configured
- [ ] Production database provisioned
- [ ] Email service verified
- [ ] Stripe products created
- [ ] App submitted to Shopify
- [ ] Marketing site live
