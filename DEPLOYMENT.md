# StoreGuard Deployment Guide

Complete checklist for deploying StoreGuard to production on Render.

---

## 1. Render Setup

### Create Services via Blueprint

1. Push code to GitHub (if not already)
2. Go to [Render Dashboard](https://dashboard.render.com)
3. Click **New** → **Blueprint**
4. Connect your GitHub repo
5. Render will detect `render.yaml` and create:
   - `storeguard-db` (PostgreSQL Starter - $7/month)
   - `storeguard-app` (Web Service Starter - $7/month)

### Manual Setup (Alternative)

**Database:**
1. New → PostgreSQL
2. Name: `storeguard-db`
3. Plan: Starter ($7/month)
4. Copy the **Internal Database URL**

**Web Service:**
1. New → Web Service
2. Connect GitHub repo
3. Name: `storeguard-app`
4. Runtime: Docker
5. Plan: Starter ($7/month)

---

## 2. Environment Variables

Set these in Render Dashboard → storeguard-app → Environment:

### Required Variables

```
# Database (auto-set if using Blueprint)
DATABASE_URL=postgresql://user:pass@host:5432/storeguard

# Shopify (from Partners Dashboard)
SHOPIFY_API_KEY=your_api_key
SHOPIFY_API_SECRET=your_api_secret

# Stripe (from Stripe Dashboard)
STRIPE_SECRET_KEY=sk_live_xxx          # Use sk_live_ for production!
STRIPE_WEBHOOK_SECRET=whsec_xxx        # Set after creating webhook endpoint
STRIPE_PRO_PRICE_ID=price_xxx          # Your $19/month Pro plan price ID

# Email (from Resend Dashboard)
RESEND_API_KEY=re_xxx
DIGEST_FROM_EMAIL=alerts@storeguard.app

# Security (auto-generated if using Blueprint)
CRON_SECRET=random_32_char_string
JOB_PROCESSOR_SECRET=random_32_char_string
```

### Get These Values From:

| Variable | Source |
|----------|--------|
| `SHOPIFY_API_KEY` | Shopify Partners → Apps → StoreGuard → API credentials |
| `SHOPIFY_API_SECRET` | Same location as above |
| `STRIPE_SECRET_KEY` | Stripe Dashboard → Developers → API keys (use **live** key) |
| `STRIPE_PRO_PRICE_ID` | Stripe Dashboard → Products → StoreGuard Pro → Price ID |
| `RESEND_API_KEY` | Resend Dashboard → API Keys |

---

## 3. Email Deliverability (CRITICAL)

Emails going to spam is the #1 issue for SaaS apps. Do this properly.

### Step 1: Add Domain to Resend

1. Go to [Resend Dashboard](https://resend.com/domains)
2. Click **Add Domain**
3. Enter: `storeguard.app` (or your domain)

### Step 2: Add DNS Records

Resend will give you 3 records to add:

**SPF Record** (TXT)
```
Host: @
Type: TXT
Value: v=spf1 include:_spf.resend.com ~all
```

**DKIM Record** (TXT)
```
Host: resend._domainkey
Type: TXT
Value: (Resend provides this - it's long)
```

**DMARC Record** (TXT)
```
Host: _dmarc
Type: TXT
Value: v=DMARC1; p=none; rua=mailto:dmarc@storeguard.app
```

### Step 3: Verify Domain

- Click **Verify** in Resend after adding DNS records
- DNS propagation can take 5-60 minutes
- Once verified, you'll see a green checkmark

### Step 4: Best Practices for Deliverability

1. **Use your verified domain** in `DIGEST_FROM_EMAIL`:
   - ✅ `alerts@storeguard.app`
   - ❌ `noreply@gmail.com`

2. **Include unsubscribe link** in emails (already done in digest)

3. **Don't send too many emails** on day 1:
   - Start with ~50/day
   - Gradually increase over weeks
   - Resend handles warming automatically on paid plans

4. **Test with mail-tester.com**:
   - Send a test email to the address they provide
   - Aim for 9+/10 score

---

## 4. Stripe Webhook Configuration

### Create Webhook Endpoint

1. Go to [Stripe Dashboard → Webhooks](https://dashboard.stripe.com/webhooks)
2. Click **Add endpoint**
3. Endpoint URL: `https://storeguard-app.onrender.com/api/stripe/webhook`
4. Select events:
   - `checkout.session.completed`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
5. Click **Add endpoint**

### Get Webhook Secret

1. Click on your new endpoint
2. Click **Reveal** under "Signing secret"
3. Copy the `whsec_xxx` value
4. Add it to Render as `STRIPE_WEBHOOK_SECRET`

### Test the Webhook

1. In Stripe Dashboard, click **Send test webhook**
2. Select `checkout.session.completed`
3. Check Render logs for: `[StoreGuard] Stripe webhook: checkout.session.completed`

---

## 5. Cron Job for Daily Digest

The `/api/digest` endpoint sends daily digest emails. You need a cron to trigger it.

### Option A: Render Cron Job (Recommended)

Add to `render.yaml`:

```yaml
services:
  # ... existing web service ...

  - type: cron
    name: storeguard-digest
    runtime: docker
    schedule: "0 9 * * *"  # 9:00 AM UTC daily
    buildCommand: "echo 'skip build'"
    startCommand: |
      curl -X POST https://storeguard-app.onrender.com/api/digest \
        -H "Authorization: Bearer $CRON_SECRET"
    envVars:
      - key: CRON_SECRET
        fromService:
          name: storeguard-app
          type: web
          envVarKey: CRON_SECRET
```

### Option B: External Cron Service

Use [cron-job.org](https://cron-job.org) (free):

1. Create account
2. New cron job:
   - URL: `https://storeguard-app.onrender.com/api/digest`
   - Schedule: Daily at 09:00 UTC
   - Method: POST
   - Headers: `Authorization: Bearer YOUR_CRON_SECRET`

### Option C: GitHub Actions

Create `.github/workflows/digest.yml`:

```yaml
name: Daily Digest
on:
  schedule:
    - cron: '0 9 * * *'  # 9:00 AM UTC
  workflow_dispatch:  # Manual trigger

jobs:
  trigger-digest:
    runs-on: ubuntu-latest
    steps:
      - name: Trigger digest
        run: |
          curl -X POST https://storeguard-app.onrender.com/api/digest \
            -H "Authorization: Bearer ${{ secrets.CRON_SECRET }}" \
            -f
```

Add `CRON_SECRET` to GitHub repo secrets.

---

## 6. Deploy to Shopify

After Render is running:

### Update App URLs

1. Go to Shopify Partners → Apps → StoreGuard
2. Update **App URL**: `https://storeguard-app.onrender.com`
3. Update **Allowed redirection URLs**: `https://storeguard-app.onrender.com/auth/callback`

### Deploy App Config

```bash
cd insightops
npm run deploy
```

This syncs `shopify.app.toml` (webhooks, scopes) to Shopify.

---

## 7. Post-Deploy Verification

### Check List

- [ ] App loads in Shopify admin
- [ ] Can view Recent Changes page
- [ ] Can save Settings
- [ ] Stripe checkout works (use test mode first)
- [ ] Stripe webhook receives events (check Render logs)
- [ ] Test email arrives (not in spam)
- [ ] Daily digest cron triggers

### Test Email Deliverability

1. Install app on test store
2. Set alert email in Settings
3. Trigger a change (edit a product price)
4. Wait for digest (or trigger manually: `POST /api/digest`)
5. Check:
   - Email arrives
   - Not in spam
   - Links work

---

## 8. Monitoring

### Render Dashboard

- Check **Logs** for errors
- Monitor **Metrics** for response times
- Set up **Alerts** for downtime

### Stripe Dashboard

- Monitor webhook delivery success rate
- Check for failed payments

### Resend Dashboard

- Monitor email delivery rates
- Check bounce/complaint rates

---

## Cost Summary

| Service | Plan | Cost |
|---------|------|------|
| Render Web Service | Starter | $7/month |
| Render PostgreSQL | Starter | $7/month |
| Resend | Free tier | $0 (up to 3k emails/month) |
| Stripe | Pay as you go | 2.9% + 30¢ per transaction |
| **Total** | | **~$14/month** + Stripe fees |

---

## Troubleshooting

### "Cannot connect to database"
- Check `DATABASE_URL` is set correctly
- Ensure PostgreSQL is running in Render

### "Stripe webhook 401"
- Verify `STRIPE_WEBHOOK_SECRET` matches Stripe Dashboard
- Check endpoint URL is correct

### "Emails going to spam"
- Verify domain DNS records in Resend
- Check SPF, DKIM, DMARC are all green
- Use mail-tester.com to debug

### "App not loading in Shopify"
- Run `npm run deploy` to sync app config
- Check App URL in Partners Dashboard matches Render URL
- Verify `SHOPIFY_API_KEY` and `SHOPIFY_API_SECRET` are set
