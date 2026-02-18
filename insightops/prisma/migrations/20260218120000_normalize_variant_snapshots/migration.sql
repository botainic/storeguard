-- CreateTable
CREATE TABLE "VariantSnapshot" (
    "id" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "productSnapshotId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "price" TEXT NOT NULL,
    "inventoryQuantity" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "VariantSnapshot_pkey" PRIMARY KEY ("id")
);

-- Migrate existing JSON variant data into VariantSnapshot rows
INSERT INTO "VariantSnapshot" ("id", "variantId", "productSnapshotId", "title", "price", "inventoryQuantity")
SELECT
    gen_random_uuid()::text,
    v->>'id',
    ps."id",
    COALESCE(v->>'title', 'Default Title'),
    COALESCE(v->>'price', '0.00'),
    COALESCE((v->>'inventoryQuantity')::integer, 0)
FROM "ProductSnapshot" ps,
     json_array_elements(ps."variants"::json) AS v
WHERE ps."variants" IS NOT NULL AND ps."variants" != '' AND ps."variants" != '[]';

-- Drop the old JSON column
ALTER TABLE "ProductSnapshot" DROP COLUMN "variants";

-- CreateIndex
CREATE INDEX "VariantSnapshot_productSnapshotId_idx" ON "VariantSnapshot"("productSnapshotId");

-- CreateIndex
CREATE UNIQUE INDEX "VariantSnapshot_productSnapshotId_variantId_key" ON "VariantSnapshot"("productSnapshotId", "variantId");

-- AddForeignKey
ALTER TABLE "VariantSnapshot" ADD CONSTRAINT "VariantSnapshot_productSnapshotId_fkey" FOREIGN KEY ("productSnapshotId") REFERENCES "ProductSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;
