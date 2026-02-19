# StoreGuard — App Store Listing Copy

Everything below is ready to paste into the Shopify Partners listing form.
Character limits shown in brackets. Every field is at or under limit.

---

## 1. BASIC APP INFORMATION

### App name [30 chars max]
```
StoreGuard
```
(10 chars)

### App icon
Need: 1200×1200px JPG/PNG. No text in icon. Clean, professional.
Direction: Simple shield or guard symbol. Dark navy/charcoal. Minimal.

---

## 2. APP STORE LISTING CONTENT

### Introduction [100 chars max]
```
Know the moment a price drops, a product disappears, or inventory hits zero.
```
(77 chars)

### App details [500 chars max]
```
Every day, Shopify stores lose money to changes nobody noticed. A price set to $0. A bestseller hidden by accident. Inventory that hit zero while you slept.

StoreGuard watches your store 24/7 and alerts you the moment something changes that could cost you revenue. On install, it scans your entire catalog and shows you exactly what's at risk right now. Then it monitors every price change, stock update, and product edit — so you catch problems in minutes, not days.

Free to start. Nothing to configure.
```
(489 chars)

### Feature 1 [80 chars max]
```
Instant risk scan on install — see what's costing you money right now
```
(70 chars)

### Feature 2 [80 chars max]
```
Real-time alerts for price changes, zero stock, and hidden products
```
(67 chars)

### Feature 3 [80 chars max]
```
Weekly health report with current exposure and activity summary
```
(63 chars)

### Feature 4 [80 chars max]
```
Revenue impact estimates on every detected change
```
(50 chars)

### Feature 5 [80 chars max]
```
Daily digest and instant email alerts so nothing slips through
```
(62 chars)

### Feature media alt text [64 chars max]
```
StoreGuard dashboard showing detected store changes
```
(52 chars)

### Screenshot 1 alt text [64 chars max]
```
Protection scan results showing store risks on install
```
(55 chars)

### Screenshot 2 alt text [64 chars max]
```
Changes timeline with price and inventory alerts
```
(49 chars)

### Screenshot 3 alt text [64 chars max]
```
Settings page with monitor toggles and email config
```
(52 chars)

### Privacy policy URL [255 chars max]
```
https://storeguard-app.onrender.com/privacy
```

---

## 3. PRICING DETAILS

### Free plan display name [18 chars max]
```
Free
```
(4 chars)

### Free plan features [40 chars each, up to 8]
```
Monitor up to 50 products
```
(26 chars)

```
Price, stock & visibility alerts
```
(32 chars)

```
Weekly health report email
```
(26 chars)

### Pro plan display name [18 chars max]
```
Pro
```
(3 chars)

### Pro plan features [40 chars each, up to 8]
```
Unlimited products
```
(18 chars)

```
Instant email alerts
```
(20 chars)

```
Discount & theme monitoring
```
(27 chars)

---

## 4. APP DISCOVERY CONTENT

### Subtitle [62 chars max]
```
Catch price errors, zero stock, and hidden products instantly.
```
(62 chars)

### Search terms [20 chars each, max 5]
```
store monitoring
```
(16 chars)

```
price alerts
```
(12 chars)

```
inventory alerts
```
(16 chars)

```
change detection
```
(16 chars)

```
store protection
```
(16 chars)

### Title tag (SEO) [60 chars max]
```
StoreGuard — Store Monitoring & Change Alerts
```
(46 chars)

### Meta description (SEO) [160 chars max]
```
Monitor your Shopify store for price changes, zero inventory, hidden products, and more. Get instant alerts before mistakes cost you revenue. Free plan available.
```
(160 chars)

---

## 5. APP TESTING INSTRUCTIONS [2800 chars max]

```
StoreGuard monitors Shopify stores for revenue-impacting changes. Here's how to test the full flow:

INSTALL & ONBOARDING
1. Install the app on a development store
2. The app opens to a 3-step onboarding flow
3. Step 1: Enter an email address and select which monitors to enable
4. Step 2: The app syncs your product catalog (progress shown in real time)
5. Step 3: A Protection Scan runs automatically and displays results — zero stock products, low stock variants, recent edit activity, and theme status
6. Click "Go to Dashboard" to complete onboarding

CHANGES TAB
7. Open Shopify Admin > Products in a new tab
8. Change any product's price (e.g., from $50 to $45) and click Save
9. Return to StoreGuard. Within seconds, a PRICE CHANGE event appears in the timeline with the old and new price
10. Set a product's inventory to 0. A "CANNOT BE PURCHASED" event appears with HIGH importance

SETTINGS TAB
11. Click Settings tab
12. Toggle monitors on/off. Free plan includes: prices, visibility, inventory, collections
13. Pro-only monitors (discounts, themes, app permissions, domains) show a PRO badge and are disabled on Free
14. The low stock threshold is configurable (default: 5 units)
15. Add/remove email recipients in the Notifications section
16. "Upgrade to Pro" button is visible on Free plan

EMAIL ALERTS
17. After making changes, trigger the daily digest: POST /api/digest with Authorization: Bearer <CRON_SECRET>
18. The digest email arrives with a summary of all changes grouped by type
19. Trigger the weekly health report: POST /api/weekly-summary with same auth
20. The weekly email shows activity summary, current exposure snapshot, and a CTA back to the app

PRIVACY
21. Visit /privacy to see the full privacy policy page
22. The app stores no customer PII — only product/variant snapshots and change events

NOTES
- The app requires no external accounts or logins
- All webhooks ACK within 500ms via background job queue
- CRON_SECRET is set as an environment variable on the hosting service
```
(1712 chars)

---

## 6. IMAGES NEEDED

These need to be created/captured:

| Asset | Dimensions | Description |
|---|---|---|
| **App icon** | 1200×1200px | Clean symbol, no text. Dark navy or charcoal. |
| **Hero image** | 1600×900px | Main banner — could be a polished screenshot of the Changes tab with a callout, or a designed graphic showing "StoreGuard catches what you miss" |
| **Screenshot 1** | 1600×900px | Protection Scan results page (onboarding step 3) |
| **Screenshot 2** | 1600×900px | Changes tab with real events (price change, out of stock) |
| **Screenshot 3** | 1600×900px | Settings page showing monitors and email config |
| **Screenshot 4** (optional) | 1600×900px | Weekly health report email rendered in Gmail |
| **Screenshot 5** (optional) | 1600×900px | Daily digest email rendered in Gmail |

### Screenshot approach
Option A: Raw app screenshots cropped to 1600×900 (fastest, authentic)
Option B: Screenshots placed inside a minimal frame/mockup with short captions (more polished)

---

## 7. CATEGORY DETAILS (TAGS)

Current tags need cleanup. Remove analytics/attribution tags, add protection-relevant ones:

**Customer behavior:** Activity tracking, Event tracking, Real-time tracking — ✅ keep all 3

**Marketing and sales:** Remove "Profit insights" and "Marketing attribution" — mark as N/A

**Visuals and reports:** Keep "Analytics dashboard." Remove "Historical analysis," "Benchmarking," "Data export"

---

## NOTES

- The app handle on Shopify is still `insightops` (URL: apps.shopify.com/insightops). This can't be changed without Shopify support.
- App name change from "InsightOps: Change Tracker" to "StoreGuard" needs to match the name in app setup (shopify.app.toml). Run `shopify app deploy` after updating.
- The screencast URL currently points to an old InsightOps video. Should be replaced with a new recording showing the actual onboarding → scan → changes → email flow.
