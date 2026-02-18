-- Unify EventLog + ChangeEvent into a single event pipeline
-- ChangeEvent becomes the canonical model, EventLog is dropped

-- Step 1: Add new columns to ChangeEvent (nullable for existing rows)
ALTER TABLE "ChangeEvent" ADD COLUMN "topic" TEXT;
ALTER TABLE "ChangeEvent" ADD COLUMN "diff" TEXT;
ALTER TABLE "ChangeEvent" ADD COLUMN "author" TEXT;

-- Step 2: Make webhookId nullable (baseline snapshots don't have webhookIds)
ALTER TABLE "ChangeEvent" ALTER COLUMN "webhookId" DROP NOT NULL;

-- Step 3: Migrate EventLog data into ChangeEvent
-- Map EventLog fields to ChangeEvent fields
INSERT INTO "ChangeEvent" (
  "id", "shop", "entityType", "entityId", "eventType", "resourceName",
  "beforeValue", "afterValue", "detectedAt", "source", "importance",
  "webhookId", "topic", "diff", "author"
)
SELECT
  "id",
  "shop",
  CASE
    WHEN "topic" LIKE 'products/%' OR "topic" = 'products/snapshot' THEN 'product'
    WHEN "topic" LIKE 'collections/%' THEN 'collection'
    WHEN "topic" = 'INVENTORY_LEVELS_UPDATE' THEN 'inventory'
    WHEN "topic" = 'ORDERS_CREATE' THEN 'order'
    ELSE 'product'
  END,
  "shopifyId",
  CASE
    WHEN "topic" = 'products/update' THEN 'product_updated'
    WHEN "topic" = 'products/create' THEN 'product_created'
    WHEN "topic" = 'products/delete' THEN 'product_deleted'
    WHEN "topic" = 'products/snapshot' THEN 'product_updated'
    WHEN "topic" = 'collections/create' THEN 'collection_created'
    WHEN "topic" = 'collections/update' THEN 'collection_updated'
    WHEN "topic" = 'collections/delete' THEN 'collection_deleted'
    WHEN "topic" = 'INVENTORY_LEVELS_UPDATE' THEN 'inventory_updated'
    WHEN "topic" = 'ORDERS_CREATE' THEN 'order_placed'
    ELSE 'product_updated'
  END,
  "message",
  NULL,
  NULL,
  "timestamp",
  'webhook',
  'low',
  "webhookId",
  "topic",
  "diff",
  "author"
FROM "EventLog"
-- Skip rows that would violate the unique constraint on webhookId
WHERE "webhookId" IS NULL
   OR "webhookId" NOT IN (SELECT "webhookId" FROM "ChangeEvent" WHERE "webhookId" IS NOT NULL);

-- Step 4: Create index on topic
CREATE INDEX "ChangeEvent_shop_topic_idx" ON "ChangeEvent"("shop", "topic");

-- Step 5: Drop EventLog table
DROP TABLE "EventLog";
