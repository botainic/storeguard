```markdown
# 📘 StoreGuard – Phase 1 Retention Architecture Spec
**Timeframe:** 30 Days  
**Objective:** Guarantee immediate first-session value + recurring perceived vigilance  
**Scope:** Strictly limited to three core improvements  

---

# 🎯 Phase 1 Goals

1. Eliminate empty-dashboard problem
2. Create emotional impact within first 2 minutes
3. Prevent “forgotten app” syndrome
4. Increase early retention
5. Improve Pro conversion readiness
6. Avoid feature creep

---

# 🧱 Architectural Principles

- No new monitoring categories
- No advanced dashboards
- No historical diff reconstruction
- Reuse existing data models
- Optimize perceived protection, not feature count
- Keep implementation lightweight

---

# ✅ Feature 1 — Install Protection Scan

## Purpose

Create an immediate emotional “first win” moment after installation.

Replace:
> “Sync complete.”

With:
> “Protection Baseline Established.”

---

## Flow

### Step 1 — Minimal Setup (≤10 seconds)

Inputs:
- Alert email
- Monitor toggles (default ON)

Single CTA:
```

Run Protection Scan

```

No multi-step wizard.

---

### Step 2 — Protection Scan (30–60 seconds)

Display live progress indicators:

- Products scanned
- Variants analyzed
- Inventory levels checked
- Prices verified
- Discounts analyzed
- Collections reviewed
- Theme status verified

Must feel active and dynamic.

No static loading screens.

---

### Step 3 — Protection Baseline Results

Three sections only.

---

## Section A — 🚨 Immediate Exposure

High-tension, risk-first language.

### Detection Rules

#### 1️⃣ Zero Inventory
```

inventory_quantity == 0

```
Display:
> 🚨 12 products cannot be purchased right now (inventory = 0)

CTA:
```

View Products

```

---

#### 2️⃣ Low Stock
```

inventory_quantity <= lowStockThreshold

```
Display:
> ⚠️ 5 variants are close to selling out

---

#### 3️⃣ Zero Price (Critical)
```

variant.price == 0

```
Display:
> 🚨 2 products are currently priced at $0  
> Customers can check out without paying.

---

#### 4️⃣ Extremely Low Price
```

variant.price < 1

```
Display:
> ⚠️ 3 products priced under $1  
> Verify these are intentional.

---

#### 5️⃣ High Discount Exposure
Active discount > 40%

Display:
> ⚠️ 2 active discounts above 40%

---

If no issues:

Display:
> ✅ No Immediate Risks Detected

Relief is still value.

---

## Section B — 📈 Recent Activity Snapshot

Purpose: Demonstrate store volatility and justify monitoring.

Data sources:
- products.updatedAt
- collections.updatedAt
- theme publish date
- active discount count

Display examples:

- 47 products modified in the last 30 days
- 8 collections updated recently
- Live theme last published 4 days ago
- 3 active discounts running

Tone: Informative but reinforcing change frequency.

---

## Section C — 🛡 Monitoring Activated

Clear statement:

> StoreGuard is now monitoring your store 24/7.  
> You will be alerted immediately if:
> - Prices change  
> - Inventory hits zero  
> - Products go invisible  
> - Collections are edited  
> - Themes are published  
> - Discounts are modified  

CTA:
```

Go to Dashboard

```

---

# ✅ Feature 2 — Strong Risk Language (Global Copy Update)

## Purpose

Shift all messaging from neutral monitoring tone to protection-first narrative.

---

## Tone Guidelines

- Clear
- Calm
- Direct
- Serious
- Never sensational
- Never overly analytical

---

## Language Examples

Replace:

> “X products have zero inventory”

With:

> “X products cannot be purchased right now”

Replace:

> “Theme updated”

With:

> “Your live theme was replaced”

Replace:

> “Variant price anomaly detected”

With:

> “Product priced at $0”

Applies to:
- Dashboard
- Email alerts
- Weekly summary
- Upgrade prompts

---

# ✅ Feature 3 — Weekly Health Summary Email

## Purpose

Maintain ongoing perceived vigilance.

Even if no changes occur.

---

## Schedule

- Sent every 7 days
- Sent regardless of activity volume
- Lightweight queries only
- No full re-sync

---

## Email Structure

### Subject Examples

- Your StoreGuard Weekly Health Report
- StoreGuard checked your store this week

---

### Section 1 — Activity This Week

Examples:

- 3 price changes detected
- 2 products hit zero stock
- 1 collection modified
- 0 high-risk issues currently open

If zero events:

> Good news — no critical changes detected this week.

---

### Section 2 — Current Exposure Snapshot

Reuse logic from Install Scan:

- X products currently out of stock
- X variants below threshold
- X products priced at $0
- X active high-discount codes

---

### Section 3 — Protection Reminder

> StoreGuard is continuously monitoring your store for revenue-impacting changes.

CTA:
```

View Full Report

```

---

# 📊 Success Metrics

Track:

1. % installs completing Protection Scan
2. % installs with ≥1 Immediate Exposure finding
3. Weekly email open rate
4. Day 7 retention
5. Day 14 retention
6. Pro conversion rate

---

# 🚫 Explicitly Out of Scope

Do NOT build in Phase 1:

- Slack integration
- SMS alerts
- AI summaries
- Multi-store dashboard
- Agency features
- New monitoring categories
- Revenue attribution engine
- Advanced analytics panels

---

# 🏁 Definition of Done

Phase 1 is complete when:

- Every new install experiences visible first-session impact
- Empty-dashboard problem eliminated
- Weekly summary email live
- Risk-first language applied globally
- App feels active even without frequent webhooks
- Focus can shift 80% toward distribution

---

# 🎯 Strategic Outcome

StoreGuard must feel:

- Vigilant
- Protective
- Active
- Necessary

Not passive.

Not invisible.

Not optional.

---
```
