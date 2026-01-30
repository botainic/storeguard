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
  accessToken      String   // Encrypted
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
  id          String   @id @default(uuid())
  shop        String
  eventType   String   // "price_change" | "status_change" | "inventory_zero" | "theme_publish"
  resourceId  String   // Product/Theme ID
  resourceName String  // Product/Theme title
  beforeValue String?  // JSON or simple value
  afterValue  String?  // JSON or simple value
  detectedAt  DateTime @default(now())
  digestedAt  DateTime? // When included in daily digest
  webhookId   String   @unique // Deduplication

  @@index([shop])
  @@index([shop, detectedAt])
  @@index([shop, eventType])
  @@index([digestedAt])
}

model ProductSnapshot {
  id          String   @id // Shopify product ID
  shop        String
  title       String
  status      String   // "active" | "draft" | "archived"
  variants    String   // JSON: [{id, title, price, inventory}]
  updatedAt   DateTime @updatedAt

  @@unique([shop, id])
  @@index([shop])
}
```

### Removed Models
- `EventLog` - Replaced by `ChangeEvent` (cleaner, purpose-built)
- `ProductSalesPoint` - Not needed (no analytics)

---

## Implementation Plan (GitHub Issues Order)

### Milestone 0: Project & Environment Setup
- [x] Existing Shopify app scaffold (done in InsightOps)
- [ ] **ISSUE #1**: Rebrand to StoreGuard (app name, config, UI)
- [ ] **ISSUE #2**: Database schema migration (new models)

### Milestone 1: Shopify Auth & Webhooks
- [x] OAuth flow (existing)
- [ ] **ISSUE #3**: Shop model persistence on install
- [ ] **ISSUE #4**: Register `themes/publish` webhook

### Milestone 2: State Snapshot Engine
- [x] Product snapshot storage (existing, needs migration)
- [ ] **ISSUE #5**: Migrate ProductSnapshot model

### Milestone 3: Change Detection (Core Value)
- [ ] **ISSUE #6**: Price change detection
- [ ] **ISSUE #7**: Product visibility change detection
- [ ] **ISSUE #8**: Inventory zero detection
- [ ] **ISSUE #9**: Theme publish detection

### Milestone 4: Settings & Controls
- [ ] **ISSUE #10**: Settings page (Polaris UI)
- [ ] **ISSUE #11**: Free vs Pro feature gates

### Milestone 5: Daily Digest (The Product)
- [ ] **ISSUE #12**: Daily digest generator
- [ ] **ISSUE #13**: Email template (HTML)
- [ ] **ISSUE #14**: Daily cron job

### Milestone 6: Billing & Monetization
- [ ] **ISSUE #15**: Stripe subscription integration ($19/month)

### Milestone 7: Polish & Launch
- [ ] **ISSUE #16**: Recent alerts list (UI)
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

### In Progress
- [ ] Awaiting user approval to begin implementation

### Blocked
- None

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
