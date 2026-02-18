-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "scope" TEXT,
    "expires" DATETIME,
    "accessToken" TEXT NOT NULL,
    "userId" BIGINT,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT,
    "accountOwner" BOOLEAN NOT NULL DEFAULT false,
    "locale" TEXT,
    "collaborator" BOOLEAN DEFAULT false,
    "emailVerified" BOOLEAN DEFAULT false
);

-- CreateTable
CREATE TABLE "Shop" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopifyDomain" TEXT NOT NULL,
    "plan" TEXT NOT NULL DEFAULT 'free',
    "alertEmail" TEXT,
    "trackPrices" BOOLEAN NOT NULL DEFAULT true,
    "trackVisibility" BOOLEAN NOT NULL DEFAULT true,
    "trackInventory" BOOLEAN NOT NULL DEFAULT true,
    "trackThemes" BOOLEAN NOT NULL DEFAULT false,
    "installedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uninstalledAt" DATETIME
);

-- CreateTable
CREATE TABLE "ChangeEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "resourceName" TEXT NOT NULL,
    "beforeValue" TEXT,
    "afterValue" TEXT,
    "detectedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "digestedAt" DATETIME,
    "source" TEXT NOT NULL DEFAULT 'webhook',
    "importance" TEXT NOT NULL DEFAULT 'medium',
    "groupId" TEXT,
    "webhookId" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "ProductSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "variants" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "EventLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "shopifyId" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "author" TEXT,
    "message" TEXT NOT NULL,
    "diff" TEXT,
    "timestamp" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "webhookId" TEXT
);

-- CreateTable
CREATE TABLE "ProductCache" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "WebhookJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "webhookId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" DATETIME,
    "error" TEXT
);

-- CreateTable
CREATE TABLE "ShopSync" (
    "shop" TEXT NOT NULL PRIMARY KEY,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "totalProducts" INTEGER,
    "syncedProducts" INTEGER NOT NULL DEFAULT 0,
    "startedAt" DATETIME,
    "completedAt" DATETIME,
    "error" TEXT
);

-- CreateTable
CREATE TABLE "ProductSalesPoint" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "bucketType" TEXT NOT NULL,
    "bucketStart" DATETIME NOT NULL,
    "revenueCents" INTEGER NOT NULL DEFAULT 0,
    "units" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "Shop_shopifyDomain_key" ON "Shop"("shopifyDomain");

-- CreateIndex
CREATE UNIQUE INDEX "ChangeEvent_webhookId_key" ON "ChangeEvent"("webhookId");

-- CreateIndex
CREATE INDEX "ChangeEvent_shop_idx" ON "ChangeEvent"("shop");

-- CreateIndex
CREATE INDEX "ChangeEvent_shop_detectedAt_idx" ON "ChangeEvent"("shop", "detectedAt");

-- CreateIndex
CREATE INDEX "ChangeEvent_shop_eventType_idx" ON "ChangeEvent"("shop", "eventType");

-- CreateIndex
CREATE INDEX "ChangeEvent_digestedAt_idx" ON "ChangeEvent"("digestedAt");

-- CreateIndex
CREATE INDEX "ChangeEvent_shop_entityType_entityId_idx" ON "ChangeEvent"("shop", "entityType", "entityId");

-- CreateIndex
CREATE INDEX "ProductSnapshot_shop_idx" ON "ProductSnapshot"("shop");

-- CreateIndex
CREATE UNIQUE INDEX "ProductSnapshot_shop_id_key" ON "ProductSnapshot"("shop", "id");

-- CreateIndex
CREATE UNIQUE INDEX "EventLog_webhookId_key" ON "EventLog"("webhookId");

-- CreateIndex
CREATE INDEX "EventLog_shop_idx" ON "EventLog"("shop");

-- CreateIndex
CREATE INDEX "EventLog_shop_timestamp_idx" ON "EventLog"("shop", "timestamp");

-- CreateIndex
CREATE INDEX "EventLog_shop_shopifyId_topic_idx" ON "EventLog"("shop", "shopifyId", "topic");

-- CreateIndex
CREATE INDEX "ProductCache_shop_idx" ON "ProductCache"("shop");

-- CreateIndex
CREATE UNIQUE INDEX "ProductCache_shop_id_key" ON "ProductCache"("shop", "id");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookJob_webhookId_key" ON "WebhookJob"("webhookId");

-- CreateIndex
CREATE INDEX "WebhookJob_status_processAt_idx" ON "WebhookJob"("status", "processAt");

-- CreateIndex
CREATE INDEX "WebhookJob_shop_idx" ON "WebhookJob"("shop");

-- CreateIndex
CREATE INDEX "ProductSalesPoint_shop_bucketType_bucketStart_idx" ON "ProductSalesPoint"("shop", "bucketType", "bucketStart");

-- CreateIndex
CREATE INDEX "ProductSalesPoint_shop_productId_bucketType_bucketStart_idx" ON "ProductSalesPoint"("shop", "productId", "bucketType", "bucketStart");

-- CreateIndex
CREATE UNIQUE INDEX "ProductSalesPoint_shop_productId_bucketType_bucketStart_key" ON "ProductSalesPoint"("shop", "productId", "bucketType", "bucketStart");
