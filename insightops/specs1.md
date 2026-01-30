Perfect. I’ll turn the **final V1 spec** into a **clean, GitHub-ready issue list** that you can literally paste into a repo and start working through without thinking.

Everything below is derived directly from your final spec .
This is **implementation order**, not conceptual order.

---

# 📁 GitHub Issues — StoreGuard V1

## Milestone 0 — Project & Environment Setup

### **ISSUE #1 — Initialize Shopify App Project**

**Type:** chore
**Description:**

* Create Shopify Partner app
* Create dev store for testing
* Scaffold embedded app using Shopify CLI
* Choose stack (Node + Express or FastAPI)
* Verify app runs locally

**Acceptance Criteria:**

* App installs successfully on dev store
* OAuth flow completes
* Embedded app loads inside Shopify Admin

---

### **ISSUE #2 — Database Setup (PostgreSQL)**

**Type:** chore
**Description:**

* Provision PostgreSQL (Supabase / Railway)
* Create tables:

  * `shops`
  * `product_snapshots`
  * `change_events`
* Add indexes on:

  * `shop_id`
  * `event_type`
  * `detected_at`

**Acceptance Criteria:**

* Tables created
* App can read/write to DB
* Migrations committed

---

## Milestone 1 — Shopify Auth & Webhooks

### **ISSUE #3 — Implement Shopify OAuth & Shop Persistence**

**Type:** backend
**Description:**

* Store `shopify_domain`, encrypted `access_token`
* Save default alert email
* Set default tracking toggles (all ON except themes for Free)

**Acceptance Criteria:**

* Shop record created on install
* Token securely stored
* Reinstall handled gracefully

---

### **ISSUE #4 — Register Required Shopify Webhooks**

**Type:** backend
**Description:**
Register webhooks on app install:

* `products/update`
* `products/delete`
* `inventory_levels/update`
* `themes/publish`

**Acceptance Criteria:**

* Webhooks visible in Shopify admin
* Webhook verification (HMAC) working
* Events reach backend endpoint

---

## Milestone 2 — State Snapshot Engine

### **ISSUE #5 — Implement Product Snapshot Storage**

**Type:** backend
**Description:**

* On first `products/update`, store snapshot:

  * product ID
  * title
  * status
  * variants JSON (id, title, price, inventory)
* Update snapshot after every processed event

**Acceptance Criteria:**

* Snapshot saved per product
* Snapshot updated after changes
* No duplicate snapshots

---

## Milestone 3 — Change Detection (Core Value)

### **ISSUE #6 — Detect Price Changes**

**Type:** backend
**Description:**

* Compare incoming variant prices vs snapshot
* Create `price_change` event on difference
* Capture before/after values

**Acceptance Criteria:**

* Price change generates one event
* No false positives
* Event stored correctly

---

### **ISSUE #7 — Detect Product Visibility Changes**

**Type:** backend
**Description:**

* Detect status changes:

  * active ↔ draft
  * active ↔ archived
* Create `status_change` event

**Acceptance Criteria:**

* Unpublish triggers event
* Republish triggers event
* Snapshot updated correctly

---

### **ISSUE #8 — Detect Inventory Hits Zero**

**Type:** backend
**Description:**

* On `inventory_levels/update`
* Trigger only when quantity crosses `>0 → 0`
* Prevent duplicate alerts until restocked

**Acceptance Criteria:**

* One alert per zero event
* No spam on repeated updates
* Restock resets alert state

---

### **ISSUE #9 — Detect Theme Publish Events**

**Type:** backend
**Description:**

* Handle `themes/publish`
* Log theme name + timestamp
* No file-level diffs

**Acceptance Criteria:**

* Theme publish creates event
* No noise from theme edits

---

## Milestone 4 — Settings & Controls

### **ISSUE #10 — Build Settings Page (Polaris UI)**

**Type:** frontend
**Description:**

* Alert email field
* Toggles:

  * Track prices
  * Track visibility
  * Track inventory
  * Track themes (Pro only)
* Save to DB

**Acceptance Criteria:**

* Settings persist
* Toggles respected by backend
* Clean Polaris UI

---

### **ISSUE #11 — Enforce Free vs Pro Feature Gates**

**Type:** backend
**Description:**

* Limit Free plan:

  * max 50 products
  * no theme alerts
  * 7-day history
* Enforce on event creation & UI

**Acceptance Criteria:**

* Free shops blocked correctly
* Pro unlocks features

---

## Milestone 5 — Daily Digest (The Product)

### **ISSUE #12 — Build Daily Digest Generator**

**Type:** backend
**Description:**

* Query undigested events (last 24h)
* Group by event type
* Cap list to max 10 items
* Mark events as digested

**Acceptance Criteria:**

* Correct grouping
* No duplicate sends
* Empty state handled

---

### **ISSUE #13 — Email Template (Daily Digest)**

**Type:** backend
**Description:**

* Clean HTML email
* Sections per event type
* Links to Shopify Admin
* “All calm” fallback

**Acceptance Criteria:**

* Email renders well
* Copy matches spec
* Mobile friendly

---

### **ISSUE #14 — Daily Digest Cron Job**

**Type:** backend
**Description:**

* Run daily (UTC is fine for V1)
* Send digest to all active shops
* Handle failures gracefully

**Acceptance Criteria:**

* Digest sent daily
* No crashes on empty events
* Logs errors cleanly

---

## Milestone 6 — Billing & Monetization

### **ISSUE #15 — Stripe Subscription Integration**

**Type:** backend
**Description:**

* Monthly subscription ($19)
* Handle upgrade/downgrade
* Sync plan to `shops.plan`

**Acceptance Criteria:**

* Subscription activates Pro
* Cancellation reverts to Free
* Webhooks handled

---

## Milestone 7 — Polish & Launch

### **ISSUE #16 — Recent Alerts List (UI)**

**Type:** frontend
**Description:**

* Show last 10 change events
* Read-only
* Sorted newest first

**Acceptance Criteria:**

* Loads fast
* Matches DB events

---

### **ISSUE #17 — App Uninstall Cleanup**

**Type:** backend
**Description:**

* Handle `app/uninstalled`
* Disable cron & webhooks
* Keep data for 30 days (optional)

**Acceptance Criteria:**

* No orphaned jobs
* Safe re-install

---

### **ISSUE #18 — App Store Submission Prep**

**Type:** chore
**Description:**

* App listing copy
* Screenshots (Settings + Digest)
* Privacy policy
* Support email

**Acceptance Criteria:**

* App submitted
* Shopify review passed

---

# 🧭 HOW TO USE THIS

* Create **one GitHub milestone per “Milestone” above**
* Do **issues strictly in order**
* Do **not add new issues** until V1 ships
* If behind → **cut scope**, not quality

This issue list is intentionally:

* small
* boring
* execution-focused
* non-ambiguous

That’s how this one ships.

---
