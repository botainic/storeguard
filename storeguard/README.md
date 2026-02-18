# 🛡️ StoreGuard

**Your Shopify store's silent guardian.** StoreGuard monitors your store 24/7 for changes that cost you money — price errors, hidden products, stock issues, unauthorized discounts, and more.

## Features

### Free Plan
- **Product monitoring** — price changes, visibility changes, new/deleted products
- **Inventory alerts** — out of stock and low stock across all locations
- **Daily digest emails** — summary of everything that changed
- **Up to 50 products**

### Pro Plan ($19/mo)
- **Unlimited products**
- **Collection monitoring** — track collection changes
- **Discount monitoring** — catch unauthorized or unexpected discounts
- **Domain monitoring** — alert on domain changes
- **App permission monitoring** — detect scope expansions
- **Instant critical alerts** — immediate email for high-impact changes
- **Money Saved dashboard** — see estimated revenue protected
- **Smart onboarding** — guided setup with sync progress

## Architecture

- **React Router** (Shopify app framework)
- **Prisma** + PostgreSQL
- **Shopify Polaris** UI components
- **Background job queue** for webhook processing
- **Resend** for transactional emails
- **Stripe** for billing

## Development

```bash
npm install
npx prisma generate
npm run dev
```

## Testing

```bash
npm test          # run all tests
npm run test:watch  # watch mode
```

298 tests across 13 test files.

## Deployment

Deployed on Render via Docker. Auto-deploys from `main` branch.

```bash
# Manual deploy
npm run build
npm run start
```

## License

Proprietary — MintBird Studio
