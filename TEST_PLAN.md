# 🛡️ StoreGuard V2 — Manual Test Plan

**Date:** February 19, 2026
**Environment:** Shopify dev store → https://storeguard-app.onrender.com
**Goal:** Verify full app flow before App Store submission update

---

## Prerequisites

Before testing, you need a **Shopify development store** with:
- [ ] A few products (at least 5, with variants and prices)
- [ ] Some inventory set across products
- [ ] At least one collection
- [ ] A valid email address for alerts

**Dev store URL:** `https://admin.shopify.com/store/YOUR-DEV-STORE/apps/storeguard`

If you don't have a dev store, create one at https://partners.shopify.com/4646756/stores → "Add store" → "Development store"

---

## Test 1: Fresh Install

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1.1 | Open dev store admin → Apps → Add app → search StoreGuard | App appears in results |
| 1.2 | Click Install | OAuth consent screen shows requested scopes: products, inventory, themes, discounts, orders |
| 1.3 | Approve install | Redirects to StoreGuard onboarding (Step 1: Welcome) |

**Pass:** ☐ &nbsp; **Fail:** ☐ &nbsp; **Notes:**

---

## Test 2: Onboarding Flow

| Step | Action | Expected Result |
|------|--------|-----------------|
| 2.1 | Welcome screen | Shows "Welcome to StoreGuard" with feature description |
| 2.2 | Click Continue / Next | Goes to email setup step |
| 2.3 | Enter alert email address | Email field accepts input, validates format |
| 2.4 | Continue to monitoring preferences | Shows toggles for: Price changes, Visibility, Inventory, Collections, Discounts, Theme, App permissions, Domains |
| 2.5 | Toggle some on/off, continue | Goes to sync step |
| 2.6 | Product sync begins | Shows progress: "Syncing your products" with count |
| 2.7 | Sync completes | Shows "You're all set" completion screen |
| 2.8 | Continue to dashboard | Loads the main app dashboard |

**Pass:** ☐ &nbsp; **Fail:** ☐ &nbsp; **Notes:**

---

## Test 3: Dashboard (Main Page)

| Step | Action | Expected Result |
|------|--------|-----------------|
| 3.1 | Dashboard loads | No errors, shows store overview |
| 3.2 | If no changes yet | Shows empty/welcome state (not an error) |
| 3.3 | Navigation works | Can navigate to Changes, Settings from sidebar/tabs |

**Pass:** ☐ &nbsp; **Fail:** ☐ &nbsp; **Notes:**

---

## Test 4: Change Detection — Product Price

| Step | Action | Expected Result |
|------|--------|-----------------|
| 4.1 | Go to Shopify admin → Products → pick a product | Product detail page |
| 4.2 | Change the price (e.g., $29.99 → $19.99) | Save |
| 4.3 | Wait 5-10 seconds | Shopify fires `products/update` webhook |
| 4.4 | Open StoreGuard → Changes tab | Price change event appears with old → new price |
| 4.5 | Check importance level | Should show as HIGH (price decrease) |

**Pass:** ☐ &nbsp; **Fail:** ☐ &nbsp; **Notes:**

---

## Test 5: Change Detection — Visibility

| Step | Action | Expected Result |
|------|--------|-----------------|
| 5.1 | Go to Shopify admin → Products → pick a product | Product detail page |
| 5.2 | Change status to Draft (hide it) | Save |
| 5.3 | Open StoreGuard → Changes tab | Visibility change event appears |
| 5.4 | Change it back to Active | Save, check Changes tab again — shows both events |

**Pass:** ☐ &nbsp; **Fail:** ☐ &nbsp; **Notes:**

---

## Test 6: Change Detection — Inventory

| Step | Action | Expected Result |
|------|--------|-----------------|
| 6.1 | Go to Shopify admin → Products → pick a product → Edit inventory | Inventory page |
| 6.2 | Set quantity to 0 | Save |
| 6.3 | Open StoreGuard → Changes tab | Out of stock alert appears with HIGH importance |
| 6.4 | Set quantity to 3 (below default threshold of 5) | Low stock alert appears |

**Pass:** ☐ &nbsp; **Fail:** ☐ &nbsp; **Notes:**

---

## Test 7: Change Detection — New/Deleted Product

| Step | Action | Expected Result |
|------|--------|-----------------|
| 7.1 | Shopify admin → Products → Add product | Create a simple test product |
| 7.2 | Save the product | Check StoreGuard Changes tab — "Product created" event |
| 7.3 | Delete the test product | Check Changes tab — "Product deleted" event |

**Pass:** ☐ &nbsp; **Fail:** ☐ &nbsp; **Notes:**

---

## Test 8: Change Detection — Collections (Pro only)

| Step | Action | Expected Result |
|------|--------|-----------------|
| 8.1 | Shopify admin → Products → Collections → Create collection | Create "Test Collection" |
| 8.2 | Check StoreGuard Changes tab | Collection created event (if Pro enabled) |
| 8.3 | Edit collection title | Collection updated event |
| 8.4 | Delete collection | Collection deleted event |

**Note:** Collection, discount, domain, app permission monitoring requires Pro plan. If testing on Free, these won't show up. To test Pro features, you can use Stripe test mode or temporarily bypass the plan check.

**Pass:** ☐ &nbsp; **Fail:** ☐ &nbsp; **Notes:**

---

## Test 9: Change Detection — Discounts (Pro only)

| Step | Action | Expected Result |
|------|--------|-----------------|
| 9.1 | Shopify admin → Discounts → Create discount | Create "TEST10" for 10% off |
| 9.2 | Check StoreGuard Changes tab | Discount created event |
| 9.3 | Edit discount (change to 50% off) | Discount updated event, HIGH importance for large discount |
| 9.4 | Delete discount | Discount deleted event |

**Pass:** ☐ &nbsp; **Fail:** ☐ &nbsp; **Notes:**

---

## Test 10: Settings Page

| Step | Action | Expected Result |
|------|--------|-----------------|
| 10.1 | Navigate to Settings | All toggles load with saved state from onboarding |
| 10.2 | Toggle "Price changes" off → Save | Saves successfully |
| 10.3 | Make a price change in Shopify | Should NOT appear in Changes (monitoring disabled) |
| 10.4 | Toggle "Price changes" back on → Save | Future price changes detected again |
| 10.5 | Check "Your Plan" section | Shows current plan (Free or Pro) |
| 10.6 | Add/remove alert email | Email list updates correctly |
| 10.7 | Toggle "Instant alerts" on | Saves (Pro only feature) |
| 10.8 | Set low stock threshold | Custom threshold persists after save |

**Pass:** ☐ &nbsp; **Fail:** ☐ &nbsp; **Notes:**

---

## Test 11: Billing / Pro Upgrade

| Step | Action | Expected Result |
|------|--------|-----------------|
| 11.1 | Settings → Plan shows "Free" | Correct |
| 11.2 | Click upgrade to Pro | Redirects to Stripe checkout (test mode) |
| 11.3 | Complete Stripe checkout with test card (4242 4242 4242 4242) | Redirects back to app |
| 11.4 | Settings → Plan shows "Pro" | Pro features unlocked |
| 11.5 | Pro-only toggles (Collections, Discounts, Domain, App permissions) now work | Can enable and save |

**Note:** Stripe is using live keys — be careful. If you want to test billing safely, we should switch to Stripe test keys first.

**Pass:** ☐ &nbsp; **Fail:** ☐ &nbsp; **Notes:**

---

## Test 12: Daily Digest Email

| Step | Action | Expected Result |
|------|--------|-----------------|
| 12.1 | Make 2-3 changes in Shopify (price, visibility, inventory) | Changes appear in StoreGuard |
| 12.2 | Trigger digest manually: | See below |

```bash
curl -X POST "https://storeguard-app.onrender.com/api/digest" \
  -H "x-cron-secret: YOUR_CRON_SECRET"
```

| Step | Action | Expected Result |
|------|--------|-----------------|
| 12.3 | Check email inbox | Digest email arrives from alerts@storeguard.app |
| 12.4 | Email content | Lists all changes with descriptions, importance badges, and business context |
| 12.5 | Email renders correctly | Responsive, readable on mobile and desktop |

**Pass:** ☐ &nbsp; **Fail:** ☐ &nbsp; **Notes:**

---

## Test 13: Instant Alert Email (Pro only)

| Step | Action | Expected Result |
|------|--------|-----------------|
| 13.1 | Ensure instant alerts enabled in Settings | Toggle on, email set |
| 13.2 | Make a HIGH importance change (set product to $0 or set inventory to 0) | Change detected |
| 13.3 | Check email within 1-2 minutes | Instant alert email arrives |

**Pass:** ☐ &nbsp; **Fail:** ☐ &nbsp; **Notes:**

---

## Test 14: Job Queue Processing

| Step | Action | Expected Result |
|------|--------|-----------------|
| 14.1 | Trigger job processor: | See below |

```bash
curl -X POST "https://storeguard-app.onrender.com/api/jobs/process" \
  -H "Authorization: Bearer YOUR_JOB_PROCESSOR_SECRET"
```

| Step | Action | Expected Result |
|------|--------|-----------------|
| 14.2 | Response shows processed jobs | `{ "processed": N, "failed": 0 }` or similar |
| 14.3 | No stuck/pending jobs | All webhooks processed |

**Pass:** ☐ &nbsp; **Fail:** ☐ &nbsp; **Notes:**

---

## Test 15: Privacy Page

| Step | Action | Expected Result |
|------|--------|-----------------|
| 15.1 | Visit https://storeguard-app.onrender.com/privacy | Clean privacy policy page |
| 15.2 | Check content | Mentions StoreGuard (NOT InsightOps), GDPR, data retention, third-party services |
| 15.3 | Contact email | Shows support@storeguard.app |

**Pass:** ☐ &nbsp; **Fail:** ☐ &nbsp; **Notes:**

---

## Test 16: Uninstall / GDPR Cleanup

| Step | Action | Expected Result |
|------|--------|-----------------|
| 16.1 | Shopify admin → Settings → Apps → StoreGuard → Uninstall | App uninstalls |
| 16.2 | Shopify fires `app/uninstalled` webhook | StoreGuard deletes all store data |
| 16.3 | Check Render logs for cleanup confirmation | `[StoreGuard] Shop uninstalled` log message |

**Pass:** ☐ &nbsp; **Fail:** ☐ &nbsp; **Notes:**

---

## Test 17: Reinstall After Uninstall

| Step | Action | Expected Result |
|------|--------|-----------------|
| 17.1 | Install StoreGuard again on same store | Fresh install, onboarding shows again |
| 17.2 | Complete onboarding | Product sync runs fresh |
| 17.3 | Changes tab | Empty (previous data was deleted) |

**Pass:** ☐ &nbsp; **Fail:** ☐ &nbsp; **Notes:**

---

## ⚠️ Known Issues / Setup Needed

1. **No cron job configured on Render** — Digest emails and job processing need external cron triggers. Set up a Render cron job or use an external service (e.g., cron-job.org) to hit:
   - `POST /api/digest` (daily, e.g., 8am UTC) — sends digest emails
   - `POST /api/jobs/process` (every 1-5 min) — processes webhook queue

2. **Stripe is using LIVE keys** — Be cautious with billing tests. Consider switching to test keys for the dev store.

3. **support@storeguard.app email** — Referenced in privacy policy. Make sure this email exists or forwards somewhere.

4. **50 product limit on Free plan** — If dev store has >50 products, verify the limit is enforced.

---

## Summary Checklist

| Area | Status |
|------|--------|
| Install/OAuth | ☐ |
| Onboarding | ☐ |
| Dashboard | ☐ |
| Price detection | ☐ |
| Visibility detection | ☐ |
| Inventory detection | ☐ |
| Product create/delete | ☐ |
| Collections (Pro) | ☐ |
| Discounts (Pro) | ☐ |
| Settings | ☐ |
| Billing/Stripe | ☐ |
| Digest email | ☐ |
| Instant alerts (Pro) | ☐ |
| Job queue | ☐ |
| Privacy page | ☐ |
| Uninstall/GDPR | ☐ |
| Reinstall | ☐ |
