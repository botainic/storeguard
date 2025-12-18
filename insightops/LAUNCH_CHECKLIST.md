# InsightOps Launch Checklist

Complete guide to test, deploy, and submit your app to the Shopify App Store.

---

## Phase 1: Local Testing (Before Deployment)

### 1.1 Test the Free → Pro Flow

```bash
# Start the dev server
cd /Users/pedroguedes/Projects/insightops/insightops
npm run dev
```

**Test as a "Free" user:**
1. Temporarily remove your store from `ADMIN_SHOPS` in `app/shopify.server.ts`
2. Open the app in Shopify admin
3. Verify:
   - [ ] "Today" and "Yesterday" buttons work normally
   - [ ] "7D", "30D", "90D" buttons show lock icons
   - [ ] Clicking a locked button shows the upgrade modal
   - [ ] Modal displays $19/month pricing
   - [ ] "Upgrade to Pro" button submits the form

**Test the billing flow:**
1. Click "Upgrade to Pro" in the modal
2. Shopify redirects to billing approval page (test mode - no real charge)
3. Approve the charge
4. Return to app - verify 7D/30D/90D now work
5. Re-add your store to `ADMIN_SHOPS`

### 1.2 Test Demo Mode (For Screenshots)

```bash
# Seed demo data
npx tsx prisma/seed-demo.ts
```

Then open: `https://admin.shopify.com/store/YOUR-STORE/apps/insightops?demo=true`

Verify:
- [ ] Chart shows realistic sales data with visible dip
- [ ] Activity feed shows mix of staff (👤) and bot (🤖) avatars
- [ ] Hovering events shows "Sales dropped X%" impact banner
- [ ] Price diff cards show "Price: $149.99 → $49.99"

---

## Phase 2: Database Migration (SQLite → PostgreSQL)

SQLite won't work in production (Fly.io uses ephemeral storage).

### 2.1 Create a Neon Database (Free Tier)

1. Go to https://neon.tech
2. Sign up / Log in
3. Create a new project called "insightops"
4. Copy the connection string (looks like):
   ```
   postgresql://user:password@ep-xxx.us-east-2.aws.neon.tech/neondb?sslmode=require
   ```

### 2.2 Update Prisma Schema

Edit `prisma/schema.prisma`:

```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}
```

### 2.3 Create Fresh Migration

```bash
# Delete old SQLite migrations
rm -rf prisma/migrations
rm -f prisma/dev.sqlite

# Set the DATABASE_URL
export DATABASE_URL="postgresql://user:password@ep-xxx.us-east-2.aws.neon.tech/neondb?sslmode=require"

# Create new migration
npx prisma migrate dev --name init

# Verify it worked
npx prisma studio
```

---

## Phase 3: Deploy to Fly.io

### 3.1 Install Fly CLI

```bash
# macOS
brew install flyctl

# Or download from https://fly.io/docs/hands-on/install-flyctl/
```

### 3.2 Login to Fly

```bash
fly auth login
```

### 3.3 Create the App

```bash
cd /Users/pedroguedes/Projects/insightops/insightops

# Launch (creates fly.toml)
fly launch --no-deploy

# When prompted:
# - App name: insightops (or your preferred name)
# - Region: Choose closest to your users
# - PostgreSQL: No (we're using Neon)
# - Redis: No
```

### 3.4 Set Environment Secrets

```bash
# Your Neon database URL
fly secrets set DATABASE_URL="postgresql://user:password@ep-xxx.us-east-2.aws.neon.tech/neondb?sslmode=require"

# Shopify credentials (from shopify.app.toml or Partner Dashboard)
fly secrets set SHOPIFY_API_KEY="b16ab6b74eeb284a43cc802ae452b481"
fly secrets set SHOPIFY_API_SECRET="your-api-secret-from-partner-dashboard"

# Your app URL (will be https://insightops.fly.dev or custom domain)
fly secrets set SHOPIFY_APP_URL="https://insightops.fly.dev"

# Scopes (must match shopify.app.toml)
fly secrets set SCOPES="read_products,write_products,read_orders,read_inventory,read_reports"
```

### 3.5 Deploy

```bash
fly deploy
```

### 3.6 Verify Deployment

```bash
# Check app status
fly status

# View logs
fly logs

# Open the app (will show error - that's OK, it needs Shopify context)
fly open
```

---

## Phase 4: Update Shopify Configuration

### 4.1 Update shopify.app.toml

Edit `shopify.app.toml`:

```toml
application_url = "https://insightops.fly.dev"

[auth]
redirect_urls = [ "https://insightops.fly.dev/auth/callback" ]
```

### 4.2 Deploy Config to Shopify

```bash
npm run deploy
```

This pushes the updated URLs to your app in the Partner Dashboard.

### 4.3 Test the Deployed App

1. Go to Shopify Partner Dashboard
2. Apps → insightops → Test your app
3. Install on your development store
4. Verify everything works:
   - [ ] App loads without errors
   - [ ] Events appear when you change products
   - [ ] Sales chart loads data
   - [ ] Billing flow works (test mode)

---

## Phase 5: Production Billing Setup

### 5.1 Switch Billing to Production Mode

Edit `app/routes/app._index.tsx` line 78:
```typescript
isTest: false, // PRODUCTION: real charges
```

Edit `app/routes/app.billing.tsx` line 16:
```typescript
isTest: false, // PRODUCTION: real charges
```

### 5.2 Redeploy

```bash
fly deploy
```

---

## Phase 6: App Store Submission

### 6.1 Prepare Your Listing

Go to Shopify Partner Dashboard → Apps → insightops → Distribution

**App Name:**
```
InsightOps: Audit & Activity Log
```

**Tagline (62 chars max):**
```
Track staff changes, monitor price edits & visualize sales impact.
```

**Description:**
```
Stop guessing why your sales dropped.

InsightOps is a real-time audit log that tracks every change in your store—products, prices, inventory, collections—and shows you exactly who made the change and when.

THE PROBLEM:
• A staff member changes a price from $50 to $5 by accident
• An app syncs the wrong inventory
• Your theme settings get overwritten
• You don't find out until sales tank

THE SOLUTION:
• Real-time activity feed with staff attribution
• Visual "Sales Impact" chart that correlates changes to revenue
• See exactly what changed: "Price: $149.99 → $49.99"
• Know if a human or an app made the change

FREE TIER:
• Activity feed (last 50 events)
• Today & Yesterday views
• Staff/App attribution

PRO ($19/month):
• Unlimited event history
• 7, 30, 90-day historical views
• Advanced search & filtering
• CSV export for compliance

Built for agencies, operations managers, and anyone who's ever asked "who changed that?"
```

**Keywords:**
```
Activity Log, Audit Trail, Staff Permissions, Price Monitor, Store History
```

### 6.2 Upload Screenshots

Take screenshots with demo data (`?demo=true`):

1. **Hero Shot** - Full dashboard with chart showing sales dip
2. **Activity Feed** - Close-up of feed with staff/bot avatars
3. **Diff Card** - Hover state showing price change details

**Recommended dimensions:** 1600x900px or 1200x675px (16:9)

### 6.3 App Review Requirements

Shopify reviews these areas:

| Area | Requirement | Your Status |
|------|-------------|-------------|
| **Functionality** | App must work as described | ✅ Test thoroughly |
| **Performance** | Pages load in <3s | ✅ |
| **Billing** | Use Shopify Billing API | ✅ Implemented |
| **Privacy** | Privacy policy URL | ❌ Need to add |
| **Support** | Support email/URL | ❌ Need to add |
| **Webhooks** | Handle uninstall cleanly | ✅ Already configured |

### 6.4 Create Privacy Policy & Support Pages

You need:
1. **Privacy Policy URL** - Host on your website or use a generator
2. **Support Email** - e.g., support@insightops.app

Add these in Partner Dashboard → Apps → insightops → App setup

### 6.5 Submit for Review

1. Partner Dashboard → Apps → insightops
2. Click "Submit for review"
3. Fill out the questionnaire:
   - How does your app use customer data? (We store shop domain, webhook events)
   - Testing instructions (Install, make a product change, see it in the feed)
4. Submit

**Review Timeline:** 3-7 business days

---

## Phase 7: While Waiting for Review

### 7.1 Outreach to Agencies (Day 1-3)

Find Shopify agencies on LinkedIn. Send this message:

> Hi [Name],
>
> I built a free "Flight Recorder" for Shopify stores. It logs every change (products, prices, inventory) with staff attribution.
>
> Perfect for agencies—when a client says "someone broke my store," you can pull up the exact change and timestamp.
>
> Would you like a free Partner account to test with your clients?
>
> [Your Name]

**Goal:** 10 messages → 2-3 responses → 10-20 store installs

### 7.2 Competitor Poach (Day 2-4)

1. Go to Logify app listing: https://apps.shopify.com/logify
2. Read 1-2 star reviews
3. Find reviewer's store (often in their username)
4. Email them:

> Hi,
>
> I saw your review about Logify not showing who changed your theme. I built an app that fixes exactly that—full staff attribution and a visual timeline.
>
> Here's a free lifetime Pro key as thanks for the feedback: [CODE]
>
> [Your Name]

### 7.3 Community Post (Day 3-5)

Post in Shopify Community Forums:

**Title:** "I built a tool to catch 'phantom' price changes. Need testers."

**Body:**
> My store had a pricing disaster—someone accidentally changed a $150 product to $15. By the time I noticed, I'd lost hundreds in revenue.
>
> So I built InsightOps—a real-time audit log that shows every change with staff attribution and sales impact visualization.
>
> Looking for 10 beta testers. In exchange for a review, you get lifetime Pro access.
>
> Comment or DM if interested!

---

## Quick Reference: Environment Variables

```bash
# Required for production
DATABASE_URL=postgresql://...
SHOPIFY_API_KEY=b16ab6b74eeb284a43cc802ae452b481
SHOPIFY_API_SECRET=your-secret
SHOPIFY_APP_URL=https://insightops.fly.dev
SCOPES=read_products,write_products,read_orders,read_inventory,read_reports
NODE_ENV=production
```

---

## Troubleshooting

### "App couldn't be loaded"
- Check `fly logs` for errors
- Verify all secrets are set: `fly secrets list`
- Ensure DATABASE_URL is correct

### Billing not working
- Verify `isTest: false` in production
- Check browser console for errors
- Ensure app is distributed as "Public" not "Custom"

### Webhooks not firing
- Run `npm run deploy` to push webhook config
- Check Shopify Partner Dashboard → Webhooks for delivery status
- Verify webhook URLs match your Fly.io domain

---

## Timeline Summary

| Day | Task |
|-----|------|
| 1 | Local testing, Neon DB setup |
| 2 | Deploy to Fly.io, test deployed app |
| 3 | Screenshots, listing copy, submit for review |
| 3-10 | Agency outreach while waiting |
| 10+ | App approved, monitor installs |

---

Good luck! 🚀
