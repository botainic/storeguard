-- CreateTable
CREATE TABLE "VariantSnapshot" (
    "id" TEXT NOT NULL,
    "shopifyVariantId" TEXT NOT NULL,
    "productSnapshotId" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "price" TEXT NOT NULL,
    "inventoryQuantity" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "VariantSnapshot_pkey" PRIMARY KEY ("id")
);

-- Migrate existing JSON data to rows
INSERT INTO "VariantSnapshot" ("id", "shopifyVariantId", "productSnapshotId", "shop", "title", "price", "inventoryQuantity")
SELECT
    gen_random_uuid()::text,
    elem->>'id',
    "ProductSnapshot"."id",
    "ProductSnapshot"."shop",
    COALESCE(elem->>'title', 'Default Title'),
    COALESCE(elem->>'price', '0.00'),
    COALESCE((elem->>'inventoryQuantity')::integer, 0)
FROM "ProductSnapshot",
     json_array_elements("ProductSnapshot"."variants"::json) AS elem
WHERE "ProductSnapshot"."variants" IS NOT NULL
  AND "ProductSnapshot"."variants" != '';

-- Drop old column
ALTER TABLE "ProductSnapshot" DROP COLUMN IF EXISTS "variants";

-- CreateIndex
CREATE UNIQUE INDEX "VariantSnapshot_productSnapshotId_shopifyVariantId_key" ON "VariantSnapshot"("productSnapshotId", "shopifyVariantId");
CREATE INDEX "VariantSnapshot_shop_shopifyVariantId_idx" ON "VariantSnapshot"("shop", "shopifyVariantId");

-- AddForeignKey
ALTER TABLE "VariantSnapshot" ADD CONSTRAINT "VariantSnapshot_productSnapshotId_fkey" FOREIGN KEY ("productSnapshotId") REFERENCES "ProductSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;
