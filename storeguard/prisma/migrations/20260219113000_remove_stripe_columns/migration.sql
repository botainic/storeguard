-- Remove Stripe billing columns (billing now handled by Shopify Billing API)
ALTER TABLE "Shop" DROP COLUMN IF EXISTS "stripeCustomerId";
ALTER TABLE "Shop" DROP COLUMN IF EXISTS "stripeSubscriptionId";
