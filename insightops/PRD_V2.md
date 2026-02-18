# StoreGuard PRD V2
**A security camera for Shopify stores that catches money-costing changes before they add up**

---

## 1. Product Vision

### What It Is
StoreGuard is the only app that comprehensively monitors your entire Shopify store for changes that can cost you money. Think "security camera for your business" — it watches everything, alerts you immediately when something dangerous happens, and keeps a permanent record.

### Who It's For
Every single Shopify store owner (5M+ stores). Not just multi-staff stores. Solo owners make typos. Apps make silent changes. Webhooks fail. Things slip through cracks. Everyone needs this.

### The "Why Now"
**The Problem**: Store owners wake up to disasters. Bestseller priced at $5 instead of $50. Homepage collection emptied by a broken app. Theme replaced overnight. Stock ran out days ago. Each incident costs hundreds to thousands in lost revenue.

**The Solution**: StoreGuard catches these issues the moment they happen and tells you exactly what changed, why it matters, and how much money is at stake.

**The Hook**: "StoreGuard protected $2,847 this month by catching 6 issues before they cost you money."

---

## 2. What We Monitor & Why

### Revenue Protection
**Price Changes** (products/update)
- Why: Accidental price drops cost immediate revenue. Apps can silently modify prices.
- Context: "Your #1 seller dropped from $59 to $5.90 — 90% drop, likely an error"

**Inventory Depletion** (inventory_levels/update)
- Zero Stock: Why: You can't sell what you don't have. Stockouts = lost sales.
- Low Stock: Why: Running low on bestsellers risks stockouts during peak hours.
- Context: "Your top seller has 0 stock — you sold 12 yesterday" / "Winter Coat down to 3 units — restock before weekend rush?"

### Store Integrity
**Product Visibility** (products/update)
- Why: Hidden products generate zero revenue. Mass status changes often indicate app bugs.
- Context: "Blue Jacket went from active → draft — no longer visible on your store"

**Collection Changes** (collections/update, collections/delete)
- Why: Products removed from collections become invisible on storefront navigation. Deleted collections break site structure.
- Context: "3 products removed from Homepage collection — customers can't find them" / "Winter Sale collection deleted — broken links on your site"

**Theme Publishes** (themes/publish)
- Why: Unintended theme changes can break checkout, hide products, or ruin site design.
- Context: "Your live theme was replaced at 3:17 AM — probably not intentional"

### Security & Control
**App Permission Changes** (app/scopes_update)
- Why: Apps expanding permissions without notice is a red flag. New access to customer data, orders, or products requires your attention.
- Context: "Klaviyo just expanded permissions to access your orders — review what they can do now"

**Domain Changes** (domains/create, domains/update, domains/destroy)
- Why: Domain changes can break SSL, redirect traffic, or take your store offline.
- Context: "Primary domain changed from yourstore.com to yourstore.myshopify.com — customers may get confused"

---

## 3. Context-Rich Alerts

**The Differentiator**: Every alert includes business impact that makes you ACT, not just read.

### Price Change Examples
- **Bad**: "Product price changed"
- **Good**: "Blue Winter Jacket price dropped from $89 to $8.90 (90% decrease) — probably a typo, fix before customers notice"
- **Context Added**: Product name, old price, new price, percentage change, sales velocity

### Visibility Change Examples
- **Bad**: "Product status updated"
- **Good**: "Red Sneakers went from active → draft — no longer visible on your store (sold 5 yesterday)"
- **Context Added**: Product name, status transition, sales history, revenue impact

### Inventory Examples
- **Bad**: "Inventory updated"
- **Good**: "Black Hoodie hit zero stock — you've been selling 8/day, lost sales start now"
- **Context Added**: Product name, previous quantity, sales velocity, urgency level

### Collection Examples
- **Bad**: "Collection updated"
- **Good**: "3 products removed from Featured collection — customers landing on /collections/featured won't see them"
- **Context Added**: Collection name, number of products affected, customer impact

### Theme Examples
- **Bad**: "Theme published"
- **Good**: "Theme 'Minimal v2' went live at 3:17 AM, replacing 'Dawn Custom' — double-check your site looks right"
- **Context Added**: Theme names, publish time, suggestion for action

---

## 4. The "Money Saved" Engine

**Purpose**: Justify $19/month forever by quantifying protection value.

### Calculation Algorithm
For each caught issue, estimate revenue impact using:

**Price Error Impact**:
```
Daily Sales Rate × Hours Until Discovery × Price Difference
Example: Bestseller at $5 instead of $50
- Normal: 10 sales/day = 0.4 sales/hour
- Lost Revenue: 0.4 × 2 hours × $45 difference = $36 saved
```

**Stock-Out Impact**:
```
Daily Sales Rate × Hours Out of Stock × Average Order Value
Example: Popular item hits zero, would stay out 24 hours
- Normal: 5 sales/day × 1 day × $35 AOV = $175 saved
```

**Visibility Impact**:
```
Product Sales Rate × Days Hidden × Average Order Value
Example: Product hidden from homepage for 1 day
- Normal: 3 sales/day × 1 day × $40 AOV = $120 saved
```

### Display Strategy
- **Monthly Counter**: "StoreGuard protected $2,847 this month"
- **Per-Alert**: "This alert saved you ~$156 by catching it early"
- **Historical**: "Total protected since install: $8,491"

### Conservative Estimation
Always underestimate. Better to surprise upward than disappoint. Use 50% of calculated impact to account for natural discovery timing.

---

## 5. Current State & Critical Fixes

### V1 Broken Things (Must Fix)
**Scalability Issues**:
- Hard 1,000 product limit breaks large stores
- 250 order limit makes sales data useless for high-volume merchants
- No pagination handling causes crashes

**Mock Data Problem**:
- Fake random sales numbers destroy merchant trust
- Must show "No data" instead of fabricated metrics

**Webhook Timeouts**:
- 2-second inline delays will cause Shopify to retry/delist us
- Must use background job queue for all processing

**Naive Attribution**:
- Correlation ≠ causation in sales impact analysis
- Need time-of-day normalization and better baselines

---

## 6. V2 Feature Priorities

### P0: Fix the Broken (Week 1)
- Remove all mock data generation
- Implement proper pagination for products/orders
- Background job queue for webhook processing
- Fix product sync to handle unlimited products

### P1: New Monitoring Capabilities (Weeks 2-4)
- Collections webhook monitoring (products removed/added, collections deleted)
- Discount code monitoring (codes created/changed/deleted)
- App permission monitoring (scope expansions)
- Domain change monitoring
- Low stock threshold alerts (configurable per shop)

### P2: Context Engine & Retention (Weeks 5-8)
- Business context calculation for all alert types
- Money saved engine with conservative impact estimation
- Instant alerts for Pro users (email immediately)
- Historical "money saved" dashboard
- Mobile-optimized email templates

---

## 7. Technical Specifications

### New Webhook Subscriptions Needed
- `collections/create` — New collection monitoring
- `collections/update` — Collection changes (products added/removed)
- `collections/delete` — Collection deletion detection
- `discounts/create` — New discount tracking
- `discounts/update` — Discount changes
- `discounts/delete` — Discount deletion
- `domains/create` — Domain additions
- `domains/update` — Domain changes
- `domains/destroy` — Domain removal
- `app_scopes/update` — App permission changes

### New Scopes Required
- `read_discounts` — Access discount codes for monitoring
- (collections, domains, app_scopes don't need explicit scopes)

### Schema Additions
```sql
-- Extend ChangeEvent for new types
ALTER TABLE ChangeEvent ADD COLUMN contextData JSONB;
ALTER TABLE ChangeEvent ADD COLUMN revenueImpact DECIMAL(10,2);
ALTER TABLE ChangeEvent ADD COLUMN severity VARCHAR(20); -- 'critical', 'high', 'medium', 'low'

-- Add money saved tracking
CREATE TABLE MoneyImpact (
  id UUID PRIMARY KEY,
  shop VARCHAR NOT NULL,
  changeEventId UUID REFERENCES ChangeEvent(id),
  estimatedSavings DECIMAL(10,2) NOT NULL,
  calculationMethod VARCHAR(50) NOT NULL,
  calculatedAt TIMESTAMP DEFAULT NOW()
);

-- Low stock configuration
ALTER TABLE Shop ADD COLUMN lowStockThreshold INTEGER DEFAULT 5;
ALTER TABLE Shop ADD COLUMN trackCollections BOOLEAN DEFAULT TRUE;
ALTER TABLE Shop ADD COLUMN trackDiscounts BOOLEAN DEFAULT FALSE; -- Pro only
ALTER TABLE Shop ADD COLUMN trackDomains BOOLEAN DEFAULT FALSE; -- Pro only
ALTER TABLE Shop ADD COLUMN trackAppPermissions BOOLEAN DEFAULT FALSE; -- Pro only
```

### Context Data Sources
- **Product Performance**: Last 30-day sales velocity from orders API
- **Collection Traffic**: Referral data from Analytics API (if available)
- **Business Hours**: Infer peak hours from historical order timestamps
- **Price History**: Track in ProductSnapshot for trend analysis
- **Inventory Velocity**: Calculate from inventory_levels/update frequency

---

## 8. Monetization Strategy

### Free Plan: The Hook ($0/month)
**Limits**:
- 50 products monitored
- Core monitoring only (prices, visibility, inventory, basic themes)
- Daily digest emails only
- 7-day alert history

**Purpose**: Get merchants hooked, build trust, prove value

### Pro Plan: The Revenue ($19/month)
**Limits**:
- Unlimited products monitored
- All monitoring types (collections, discounts, domains, app permissions)
- Instant alerts (email immediately)
- 90-day alert history
- Money saved dashboard
- Priority support

**Upgrade Triggers**:
- Hit 50 product limit → "Upgrade to monitor your full catalog"
- Miss a collection/discount change → "Pro monitoring would have caught this"
- Want instant alerts → "Get alerts immediately, not just daily"
- Want money saved tracking → "See exactly how much we've protected"

### Value Justification
- **Customer pays**: $19/month = $228/year
- **Customer saves**: One caught pricing error = $200-2000 saved
- **ROI**: Pays for itself with first major catch

---

## 9. Go-to-Market Strategy

### App Store Positioning
**Primary Keywords**: "store monitoring", "change alerts", "price protection", "inventory alerts"
**Secondary Keywords**: "security", "store safety", "mistake prevention", "revenue protection"

**Avoid**: "analytics", "insights", "activity log" (too generic/competitive)

### Emotional Hook
**Fear**: "What changed in your store while you were sleeping?"
**Relief**: "StoreGuard watches your store 24/7 so you don't have to"
**Pride**: "Protected $2,847 this month by catching issues early"

### Landing Page Copy
**Headline**: "The security camera your Shopify store needs"
**Subhead**: "Catch price errors, inventory issues, and store changes before they cost you money"
**Social Proof**: "Protected over $1.2M for 2,000+ stores"

### Content Marketing
- **Blog**: "5 Shopify changes that cost merchants $10,000 overnight"
- **Case Study**: "How StoreGuard caught a $3,000 pricing error in 12 minutes"
- **Guides**: "Complete checklist: What to monitor in your Shopify store"

---

## 10. Metrics & Milestones

### 3-Month Build Timeline
**Month 1**: Fix V1 issues, core monitoring expansion
- Remove scalability blocks
- Add collections, discounts monitoring
- Background job queue implementation

**Month 2**: Context engine and Pro features
- Money saved calculation engine
- Instant alerts for Pro users
- Advanced context for all alert types

**Month 3**: Polish and growth features
- Mobile email optimization
- Historical money saved dashboard
- Onboarding flow improvement

### Success Metrics
**Technical**:
- Zero webhook timeouts (100% success rate)
- <200ms average alert generation time
- Support for 100,000+ product stores

**Business**:
- 1,000 free installs in first 3 months
- 10% free-to-Pro conversion rate
- $5,000 MRR by month 6
- 4.8+ App Store rating

**Validation**:
- Merchant feedback: "This saved me $___"
- Support tickets <5% of installs
- Uninstall rate <10% after 30 days

### Monthly Targets (Solo Dev)
- **Month 1**: 50 installs, 2 Pro subscribers
- **Month 2**: 200 installs, 15 Pro subscribers
- **Month 3**: 500 installs, 50 Pro subscribers
- **Month 6**: 1,500 installs, 150 Pro subscribers ($2,850 MRR)

### Key Assumptions to Validate
- Merchants will pay $19/month for comprehensive monitoring
- Context-rich alerts drive higher engagement than basic notifications
- "Money saved" messaging resonates more than "issues caught"
- Solo merchants value protection as much as multi-staff stores

---

## Launch Readiness Checklist

### Technical
- [ ] All V1 scalability issues resolved
- [ ] All 8 monitoring types implemented and tested
- [ ] Money saved calculation working accurately
- [ ] Email deliverability optimized
- [ ] Error handling and edge cases covered

### Business
- [ ] Stripe Pro plan configured ($19/month)
- [ ] App Store listing optimized with screenshots
- [ ] Support documentation created
- [ ] Privacy policy and terms updated
- [ ] GDPR compliance verified

### Marketing
- [ ] Landing page live with social proof
- [ ] First 3 blog posts published
- [ ] Email sequences for onboarding and conversion
- [ ] App Store keywords researched and implemented

**Success Definition**: When a store owner installs StoreGuard and says "I wish I had this sooner" within 24 hours.