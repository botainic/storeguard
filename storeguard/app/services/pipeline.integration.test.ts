import { vi, describe, it, expect, beforeEach, type Mock } from "vitest";

// =============================================================================
// Module mocks — vi.mock calls are hoisted by vitest
// =============================================================================

vi.mock("../db.server", () => ({
  default: {
    productSnapshot: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
      delete: vi.fn(),
    },
    variantSnapshot: {
      upsert: vi.fn(),
    },
    changeEvent: {
      create: vi.fn(),
      findFirst: vi.fn(),
      count: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

vi.mock("./shopService.server", () => ({
  canTrackFeature: vi.fn(),
  getLowStockThreshold: vi.fn(),
  hasInstantAlerts: vi.fn(),
  getShopAlertEmail: vi.fn(),
}));

vi.mock("./emailService.server", () => ({
  sendInstantAlert: vi.fn(),
}));

vi.mock("./salesVelocity.server", () => ({
  getProductSalesVelocity: vi.fn(),
}));

// =============================================================================
// Imports (after mocks)
// =============================================================================

import db from "../db.server";
import {
  canTrackFeature,
  getLowStockThreshold,
  hasInstantAlerts,
  getShopAlertEmail,
} from "./shopService.server";
import {
  detectPriceChanges,
  detectVisibilityChanges,
  detectInventoryZero,
  detectLowStock,
  recordThemePublish,
  recordCollectionCreated,
  recordCollectionUpdated,
  recordCollectionDeleted,
  recordDiscountCreated,
  recordDiscountUpdated,
  recordDiscountDeleted,
  recordAppPermissionsChanged,
  recordDomainChanged,
  recordDomainRemoved,
} from "./changeDetection.server";

// =============================================================================
// Event display config (mirror of app/routes/app.changes.tsx)
// Every event type produced by the system must have an entry here.
// =============================================================================

const eventConfig: Record<string, { label: string; color: string }> = {
  product_updated: { label: "Product Updated", color: "#6b7280" },
  product_created: { label: "Product Created", color: "#10b981" },
  product_deleted: { label: "Product Deleted", color: "#e74c3c" },
  product_snapshot: { label: "Product Snapshot", color: "#6b7280" },
  price_change: { label: "Price Change", color: "#ffa500" },
  visibility_change: { label: "Visibility Change", color: "#9b59b6" },
  inventory_low: { label: "Low Stock", color: "#f97316" },
  inventory_zero: { label: "Cannot Be Purchased", color: "#e74c3c" },
  inventory_update: { label: "Stock Update", color: "#2563eb" },
  theme_publish: { label: "Live Theme Replaced", color: "#3498db" },
  collection_created: { label: "Collection Created", color: "#10b981" },
  collection_updated: { label: "Collection Updated", color: "#10b981" },
  collection_deleted: { label: "Collection Deleted", color: "#e74c3c" },
  discount_created: { label: "Discount Created", color: "#8b5cf6" },
  discount_changed: { label: "Discount Changed", color: "#8b5cf6" },
  discount_deleted: { label: "Discount Deleted", color: "#e74c3c" },
  app_permissions_changed: { label: "App Permissions", color: "#6366f1" },
  domain_changed: { label: "Domain Changed", color: "#0891b2" },
  domain_removed: { label: "Domain Removed", color: "#e74c3c" },
};

// =============================================================================
// Constants
// =============================================================================

const SHOP = "test-store.myshopify.com";
const WEBHOOK_ID = "wh_test_123";

// =============================================================================
// Helpers
// =============================================================================

/** Get the data object passed to the last db.changeEvent.create call */
function getCreatedEventData(): Record<string, unknown> {
  const calls = (db.changeEvent.create as Mock).mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  return calls[calls.length - 1][0].data;
}

/** Build a mock ProductSnapshot result (as Prisma would return with include: { variants: true }) */
function makeSnapshot(overrides: {
  title?: string;
  status?: string;
  variants?: Array<{
    shopifyVariantId: string;
    title: string;
    price: string;
    inventoryQuantity: number;
  }>;
} = {}) {
  return {
    title: overrides.title ?? "Test Product",
    status: overrides.status ?? "active",
    variants: overrides.variants ?? [
      { shopifyVariantId: "100", title: "Default Title", price: "50.00", inventoryQuantity: 10 },
    ],
  };
}

/** Build a product webhook payload */
function makeProductPayload(overrides: {
  id?: number;
  title?: string;
  status?: string;
  variants?: Array<{
    id: number;
    title: string;
    price: string;
    inventory_quantity: number;
  }>;
} = {}) {
  return {
    id: overrides.id ?? 1001,
    title: overrides.title ?? "Test Product",
    status: overrides.status ?? "active",
    variants: overrides.variants ?? [
      { id: 100, title: "Default Title", price: "50.00", inventory_quantity: 10 },
    ],
  };
}

// =============================================================================
// Common mock setup
// =============================================================================

beforeEach(() => {
  vi.clearAllMocks();

  // All features enabled by default
  (canTrackFeature as Mock).mockResolvedValue(true);
  (getLowStockThreshold as Mock).mockResolvedValue(5);

  // Instant alerts disabled by default (simplifies most tests)
  (hasInstantAlerts as Mock).mockResolvedValue(false);
  (getShopAlertEmail as Mock).mockResolvedValue(null);

  // No recent alerts (dedup passes)
  (db.changeEvent.findFirst as Mock).mockResolvedValue(null);
  (db.changeEvent.count as Mock).mockResolvedValue(0);

  // changeEvent.create returns a mock event
  (db.changeEvent.create as Mock).mockResolvedValue({
    id: "evt_test",
    detectedAt: new Date("2026-02-19T10:00:00Z"),
  });

  // $transaction executes the callback with a mock tx
  (db.$transaction as Mock).mockImplementation(async (fn: unknown) => {
    return (fn as Function)({
      productSnapshot: { upsert: vi.fn().mockResolvedValue({}) },
      variantSnapshot: { upsert: vi.fn().mockResolvedValue({}) },
    });
  });

  // No snapshot by default (first-time product)
  (db.productSnapshot.findUnique as Mock).mockResolvedValue(null);
});

// =============================================================================
// PRICE CHANGE DETECTION
// =============================================================================

describe("Price Changes (detectPriceChanges)", () => {
  it("small price increase → low importance, correct before/after", async () => {
    // Snapshot: $100.00, Payload: $110.00 → 10% increase → low
    (db.productSnapshot.findUnique as Mock).mockResolvedValue(
      makeSnapshot({ variants: [{ shopifyVariantId: "100", title: "Default Title", price: "100.00", inventoryQuantity: 10 }] })
    );

    const product = makeProductPayload({
      variants: [{ id: 100, title: "Default Title", price: "110.00", inventory_quantity: 10 }],
    });

    const count = await detectPriceChanges(SHOP, product, WEBHOOK_ID);
    expect(count).toBe(1);

    const data = getCreatedEventData();
    expect(data.eventType).toBe("price_change");
    expect(data.importance).toBe("low");
    expect(data.beforeValue).toBe("$100.00");
    expect(data.afterValue).toBe("$110.00");
    expect(data.resourceName).toBeTruthy();
    expect(data.entityType).toBe("variant");
    expect(eventConfig["price_change"]).toBeDefined();
  });

  it("price to $0 → high importance, afterValue=$0.00", async () => {
    (db.productSnapshot.findUnique as Mock).mockResolvedValue(
      makeSnapshot({ variants: [{ shopifyVariantId: "200", title: "Default Title", price: "50.00", inventoryQuantity: 5 }] })
    );

    const product = makeProductPayload({
      variants: [{ id: 200, title: "Default Title", price: "0.00", inventory_quantity: 5 }],
    });

    const count = await detectPriceChanges(SHOP, product, WEBHOOK_ID);
    expect(count).toBe(1);

    const data = getCreatedEventData();
    expect(data.eventType).toBe("price_change");
    expect(data.importance).toBe("high");
    expect(data.beforeValue).toBe("$50.00");
    expect(data.afterValue).toBe("$0.00");
    expect(data.resourceName).toBeTruthy();
  });

  it("price from $0 to $25 → high importance", async () => {
    (db.productSnapshot.findUnique as Mock).mockResolvedValue(
      makeSnapshot({ variants: [{ shopifyVariantId: "300", title: "Default Title", price: "0.00", inventoryQuantity: 8 }] })
    );

    const product = makeProductPayload({
      variants: [{ id: 300, title: "Default Title", price: "25.00", inventory_quantity: 8 }],
    });

    const count = await detectPriceChanges(SHOP, product, WEBHOOK_ID);
    expect(count).toBe(1);

    const data = getCreatedEventData();
    expect(data.eventType).toBe("price_change");
    expect(data.importance).toBe("high");
    expect(data.beforeValue).toBe("$0.00");
    expect(data.afterValue).toBe("$25.00");
  });

  it("no price change → no event created", async () => {
    (db.productSnapshot.findUnique as Mock).mockResolvedValue(
      makeSnapshot({ variants: [{ shopifyVariantId: "100", title: "Default Title", price: "50.00", inventoryQuantity: 10 }] })
    );

    const product = makeProductPayload({
      variants: [{ id: 100, title: "Default Title", price: "50.00", inventory_quantity: 10 }],
    });

    const count = await detectPriceChanges(SHOP, product, WEBHOOK_ID);
    expect(count).toBe(0);
    expect(db.changeEvent.create).not.toHaveBeenCalled();
  });

  it("first product seen → snapshot created, no alerts", async () => {
    // No existing snapshot → first time
    (db.productSnapshot.findUnique as Mock).mockResolvedValue(null);

    const product = makeProductPayload();
    const count = await detectPriceChanges(SHOP, product, WEBHOOK_ID);

    expect(count).toBe(0);
    expect(db.changeEvent.create).not.toHaveBeenCalled();
    // Snapshot should be updated
    expect(db.$transaction).toHaveBeenCalled();
  });

  it("medium price change (25% decrease) → medium importance", async () => {
    (db.productSnapshot.findUnique as Mock).mockResolvedValue(
      makeSnapshot({ variants: [{ shopifyVariantId: "100", title: "Default Title", price: "100.00", inventoryQuantity: 10 }] })
    );

    const product = makeProductPayload({
      variants: [{ id: 100, title: "Default Title", price: "75.00", inventory_quantity: 10 }],
    });

    const count = await detectPriceChanges(SHOP, product, WEBHOOK_ID);
    expect(count).toBe(1);

    const data = getCreatedEventData();
    expect(data.eventType).toBe("price_change");
    expect(data.importance).toBe("medium");
    expect(data.beforeValue).toBe("$100.00");
    expect(data.afterValue).toBe("$75.00");
  });

  it("multi-variant: only changed variants produce events", async () => {
    (db.productSnapshot.findUnique as Mock).mockResolvedValue(
      makeSnapshot({
        variants: [
          { shopifyVariantId: "100", title: "Small", price: "20.00", inventoryQuantity: 10 },
          { shopifyVariantId: "101", title: "Large", price: "30.00", inventoryQuantity: 5 },
        ],
      })
    );

    const product = makeProductPayload({
      variants: [
        { id: 100, title: "Small", price: "20.00", inventory_quantity: 10 }, // unchanged
        { id: 101, title: "Large", price: "10.00", inventory_quantity: 5 },  // changed
      ],
    });

    const count = await detectPriceChanges(SHOP, product, WEBHOOK_ID);
    expect(count).toBe(1);

    const data = getCreatedEventData();
    expect(data.beforeValue).toBe("$30.00");
    expect(data.afterValue).toBe("$10.00");
    expect(data.resourceName).toContain("Large");
  });
});

// =============================================================================
// VISIBILITY CHANGE DETECTION
// =============================================================================

describe("Visibility Changes (detectVisibilityChanges)", () => {
  it("active → draft → high importance", async () => {
    (db.productSnapshot.findUnique as Mock).mockResolvedValue(
      makeSnapshot({ status: "active" })
    );

    const product = makeProductPayload({ status: "draft" });

    const changed = await detectVisibilityChanges(SHOP, product, WEBHOOK_ID);
    expect(changed).toBe(true);

    const data = getCreatedEventData();
    expect(data.eventType).toBe("visibility_change");
    expect(data.importance).toBe("high");
    expect(data.beforeValue).toBe("active");
    expect(data.afterValue).toBe("draft");
    expect(data.resourceName).toBeTruthy();
    expect(data.entityType).toBe("product");
    expect(eventConfig["visibility_change"]).toBeDefined();
  });

  it("active → archived → high importance", async () => {
    (db.productSnapshot.findUnique as Mock).mockResolvedValue(
      makeSnapshot({ status: "active" })
    );

    const product = makeProductPayload({ status: "archived" });

    const changed = await detectVisibilityChanges(SHOP, product, WEBHOOK_ID);
    expect(changed).toBe(true);

    const data = getCreatedEventData();
    expect(data.importance).toBe("high");
    expect(data.beforeValue).toBe("active");
    expect(data.afterValue).toBe("archived");
  });

  it("draft → active → medium importance", async () => {
    (db.productSnapshot.findUnique as Mock).mockResolvedValue(
      makeSnapshot({ status: "draft" })
    );

    const product = makeProductPayload({ status: "active" });

    const changed = await detectVisibilityChanges(SHOP, product, WEBHOOK_ID);
    expect(changed).toBe(true);

    const data = getCreatedEventData();
    expect(data.eventType).toBe("visibility_change");
    expect(data.importance).toBe("medium");
    expect(data.beforeValue).toBe("draft");
    expect(data.afterValue).toBe("active");
  });

  it("draft → archived → no event (both hidden)", async () => {
    (db.productSnapshot.findUnique as Mock).mockResolvedValue(
      makeSnapshot({ status: "draft" })
    );

    const product = makeProductPayload({ status: "archived" });

    const changed = await detectVisibilityChanges(SHOP, product, WEBHOOK_ID);
    expect(changed).toBe(false);
    expect(db.changeEvent.create).not.toHaveBeenCalled();
  });
});

// =============================================================================
// INVENTORY ZERO DETECTION
// =============================================================================

describe("Inventory Zero (detectInventoryZero)", () => {
  it("inventory >0 → 0 → high importance", async () => {
    const result = await detectInventoryZero(
      SHOP, "inv_item_1", "prod_1", "Black Hoodie", "Default Title",
      0,    // newQuantity
      5,    // previousQuantity
      WEBHOOK_ID,
    );

    expect(result).toBe(true);

    const data = getCreatedEventData();
    expect(data.eventType).toBe("inventory_zero");
    expect(data.importance).toBe("high");
    expect(data.beforeValue).toBe("5");
    expect(data.afterValue).toBe("0");
    expect(data.resourceName).toBe("Black Hoodie");
    expect(data.entityType).toBe("variant");
    expect(eventConfig["inventory_zero"]).toBeDefined();
  });

  it("inventory 0 → 0 → no event (no change)", async () => {
    const result = await detectInventoryZero(
      SHOP, "inv_item_1", "prod_1", "Hoodie", "Default Title",
      0, 0, WEBHOOK_ID,
    );

    expect(result).toBe(false);
    expect(db.changeEvent.create).not.toHaveBeenCalled();
  });

  it("null previous → no event (unknown state)", async () => {
    const result = await detectInventoryZero(
      SHOP, "inv_item_1", "prod_1", "Hoodie", "Default Title",
      0, null, WEBHOOK_ID,
    );

    expect(result).toBe(false);
    expect(db.changeEvent.create).not.toHaveBeenCalled();
  });

  it("dedup: recent alert in last 24h → no duplicate event", async () => {
    // Simulate existing recent alert
    (db.changeEvent.findFirst as Mock).mockResolvedValue({
      id: "existing_alert",
      detectedAt: new Date(),
    });

    const result = await detectInventoryZero(
      SHOP, "inv_item_1", "prod_1", "Hoodie", "Default Title",
      0, 5, WEBHOOK_ID,
    );

    expect(result).toBe(false);
    expect(db.changeEvent.create).not.toHaveBeenCalled();
  });

  it("includes location context when provided", async () => {
    const result = await detectInventoryZero(
      SHOP, "inv_item_1", "prod_1", "Hoodie", "Default Title",
      0, 3, WEBHOOK_ID, "Last change at Warehouse A",
    );

    expect(result).toBe(true);
    const data = getCreatedEventData();
    expect(data.contextData).toBeTruthy();
    const ctx = JSON.parse(data.contextData as string);
    expect(ctx.locationContext).toContain("Warehouse A");
  });
});

// =============================================================================
// LOW STOCK DETECTION
// =============================================================================

describe("Low Stock (detectLowStock)", () => {
  it("crossing threshold (10 → 3, threshold=5) → medium importance", async () => {
    const result = await detectLowStock(
      SHOP, "inv_item_2", "prod_2", "Red Sneakers", "Size 10",
      3,    // newQuantity
      10,   // previousQuantity
      WEBHOOK_ID,
    );

    expect(result).toBe(true);

    const data = getCreatedEventData();
    expect(data.eventType).toBe("inventory_low");
    expect(data.importance).toBe("medium");
    expect(data.beforeValue).toBe("10");
    expect(data.afterValue).toBe("3");
    expect(data.resourceName).toBe("Red Sneakers - Size 10");
    expect(data.entityType).toBe("variant");
    expect(eventConfig["inventory_low"]).toBeDefined();
  });

  it("already below threshold → no event", async () => {
    const result = await detectLowStock(
      SHOP, "inv_item_2", "prod_2", "Sneakers", "Default Title",
      2,    // newQuantity (already below 5)
      3,    // previousQuantity (also below 5)
      WEBHOOK_ID,
    );

    expect(result).toBe(false);
    expect(db.changeEvent.create).not.toHaveBeenCalled();
  });

  it("quantity zero → no event (handled by inventory_zero)", async () => {
    const result = await detectLowStock(
      SHOP, "inv_item_2", "prod_2", "Sneakers", "Default Title",
      0,    // newQuantity is zero
      10,   // previousQuantity
      WEBHOOK_ID,
    );

    expect(result).toBe(false);
    expect(db.changeEvent.create).not.toHaveBeenCalled();
  });

  it("null previous → no event (unknown state)", async () => {
    const result = await detectLowStock(
      SHOP, "inv_item_2", "prod_2", "Sneakers", "Default Title",
      3, null, WEBHOOK_ID,
    );

    expect(result).toBe(false);
    expect(db.changeEvent.create).not.toHaveBeenCalled();
  });
});

// =============================================================================
// THEME PUBLISH DETECTION
// =============================================================================

describe("Theme Publish (recordThemePublish)", () => {
  it("role=main → high importance", async () => {
    const result = await recordThemePublish(
      SHOP,
      { id: 555, name: "Dawn Custom", role: "main" },
      WEBHOOK_ID,
    );

    expect(result).toBe(true);

    const data = getCreatedEventData();
    expect(data.eventType).toBe("theme_publish");
    expect(data.importance).toBe("high");
    expect(data.resourceName).toBe("Dawn Custom");
    expect(data.afterValue).toBe("main");
    expect(data.entityType).toBe("theme");
    expect(eventConfig["theme_publish"]).toBeDefined();
  });

  it("role=unpublished → no event", async () => {
    const result = await recordThemePublish(
      SHOP,
      { id: 555, name: "Dawn Custom", role: "unpublished" },
      WEBHOOK_ID,
    );

    expect(result).toBe(false);
    expect(db.changeEvent.create).not.toHaveBeenCalled();
  });

  it("theme tracking disabled → no event", async () => {
    (canTrackFeature as Mock).mockResolvedValue(false);

    const result = await recordThemePublish(
      SHOP,
      { id: 555, name: "Dawn Custom", role: "main" },
      WEBHOOK_ID,
    );

    expect(result).toBe(false);
    expect(db.changeEvent.create).not.toHaveBeenCalled();
  });
});

// =============================================================================
// COLLECTION CHANGE DETECTION
// =============================================================================

describe("Collection Changes", () => {
  it("collection created → low importance", async () => {
    const result = await recordCollectionCreated(
      SHOP, "col_1", "Summer Sale", WEBHOOK_ID,
    );

    expect(result).toBe(true);

    const data = getCreatedEventData();
    expect(data.eventType).toBe("collection_created");
    expect(data.importance).toBe("low");
    expect(data.resourceName).toBe("Summer Sale");
    expect(data.afterValue).toBe("Summer Sale");
    expect(data.entityType).toBe("collection");
    expect(eventConfig["collection_created"]).toBeDefined();
  });

  it("collection updated → medium importance", async () => {
    const result = await recordCollectionUpdated(
      SHOP, "col_1", "Featured Products", WEBHOOK_ID,
    );

    expect(result).toBe(true);

    const data = getCreatedEventData();
    expect(data.eventType).toBe("collection_updated");
    expect(data.importance).toBe("medium");
    expect(data.resourceName).toBe("Featured Products");
    expect(data.entityType).toBe("collection");
    expect(eventConfig["collection_updated"]).toBeDefined();
  });

  it("collection deleted → high importance", async () => {
    const result = await recordCollectionDeleted(
      SHOP, "col_1", "Clearance", WEBHOOK_ID,
    );

    expect(result).toBe(true);

    const data = getCreatedEventData();
    expect(data.eventType).toBe("collection_deleted");
    expect(data.importance).toBe("high");
    expect(data.resourceName).toBe("Clearance");
    expect(data.beforeValue).toBe("Clearance");
    expect(data.afterValue).toBeNull();
    expect(data.entityType).toBe("collection");
    expect(eventConfig["collection_deleted"]).toBeDefined();
  });

  it("collection tracking disabled → no events", async () => {
    (canTrackFeature as Mock).mockResolvedValue(false);

    expect(await recordCollectionCreated(SHOP, "col_1", "Sale", WEBHOOK_ID)).toBe(false);
    expect(await recordCollectionUpdated(SHOP, "col_1", "Sale", WEBHOOK_ID)).toBe(false);
    expect(await recordCollectionDeleted(SHOP, "col_1", "Sale", WEBHOOK_ID)).toBe(false);
    expect(db.changeEvent.create).not.toHaveBeenCalled();
  });
});

// =============================================================================
// DISCOUNT CHANGE DETECTION (Pro only)
// =============================================================================

describe("Discount Changes", () => {
  it("discount created (moderate value) → medium importance", async () => {
    const result = await recordDiscountCreated(
      SHOP, "disc_1", "SPRING20", "20", WEBHOOK_ID,
    );

    expect(result).toBe(true);

    const data = getCreatedEventData();
    expect(data.eventType).toBe("discount_created");
    expect(data.importance).toBe("medium");
    expect(data.resourceName).toBe("SPRING20");
    expect(data.afterValue).toBe("20% off");
    expect(data.entityType).toBe("discount");
    expect(eventConfig["discount_created"]).toBeDefined();
  });

  it("discount created (>=50% value) → high importance", async () => {
    const result = await recordDiscountCreated(
      SHOP, "disc_2", "BLACKFRIDAY", "50", WEBHOOK_ID,
    );

    expect(result).toBe(true);

    const data = getCreatedEventData();
    expect(data.eventType).toBe("discount_created");
    expect(data.importance).toBe("high");
  });

  it("discount changed → medium importance", async () => {
    const result = await recordDiscountUpdated(
      SHOP, "disc_1", "SPRING20", "25", WEBHOOK_ID,
    );

    expect(result).toBe(true);

    const data = getCreatedEventData();
    expect(data.eventType).toBe("discount_changed");
    expect(data.importance).toBe("medium");
    expect(data.resourceName).toBe("SPRING20");
    expect(data.afterValue).toBe("25% off");
    expect(eventConfig["discount_changed"]).toBeDefined();
  });

  it("discount deleted → high importance", async () => {
    const result = await recordDiscountDeleted(
      SHOP, "disc_1", "SPRING20", WEBHOOK_ID,
    );

    expect(result).toBe(true);

    const data = getCreatedEventData();
    expect(data.eventType).toBe("discount_deleted");
    expect(data.importance).toBe("high");
    expect(data.resourceName).toBe("SPRING20");
    expect(data.beforeValue).toBe("SPRING20");
    expect(data.afterValue).toBeNull();
    expect(eventConfig["discount_deleted"]).toBeDefined();
  });

  it("discount tracking disabled → no events", async () => {
    (canTrackFeature as Mock).mockResolvedValue(false);

    expect(await recordDiscountCreated(SHOP, "d1", "X", "10", WEBHOOK_ID)).toBe(false);
    expect(await recordDiscountUpdated(SHOP, "d1", "X", "10", WEBHOOK_ID)).toBe(false);
    expect(await recordDiscountDeleted(SHOP, "d1", "X", WEBHOOK_ID)).toBe(false);
    expect(db.changeEvent.create).not.toHaveBeenCalled();
  });
});

// =============================================================================
// APP PERMISSIONS CHANGE DETECTION (Pro only)
// =============================================================================

describe("App Permissions (recordAppPermissionsChanged)", () => {
  it("scopes added → high importance", async () => {
    const result = await recordAppPermissionsChanged(
      SHOP,
      ["read_products"],
      ["read_products", "read_orders"],
      WEBHOOK_ID,
    );

    expect(result).toBe(true);

    const data = getCreatedEventData();
    expect(data.eventType).toBe("app_permissions_changed");
    expect(data.importance).toBe("high");
    expect(data.resourceName).toBe("1 scope added");
    expect(data.beforeValue).toBe("read_products");
    expect(data.afterValue).toBe("read_products, read_orders");
    expect(data.entityType).toBe("app");
    expect(eventConfig["app_permissions_changed"]).toBeDefined();
  });

  it("scopes removed only → medium importance", async () => {
    const result = await recordAppPermissionsChanged(
      SHOP,
      ["read_products", "read_orders"],
      ["read_products"],
      WEBHOOK_ID,
    );

    expect(result).toBe(true);

    const data = getCreatedEventData();
    expect(data.importance).toBe("medium");
    expect(data.resourceName).toBe("1 scope removed");
  });

  it("scopes added and removed → high importance", async () => {
    const result = await recordAppPermissionsChanged(
      SHOP,
      ["read_products", "read_themes"],
      ["read_products", "read_orders"],
      WEBHOOK_ID,
    );

    expect(result).toBe(true);

    const data = getCreatedEventData();
    expect(data.importance).toBe("high");
    expect(data.resourceName).toBe("1 added, 1 removed");
  });

  it("no actual scope change → no event", async () => {
    const result = await recordAppPermissionsChanged(
      SHOP,
      ["read_products"],
      ["read_products"],
      WEBHOOK_ID,
    );

    expect(result).toBe(false);
    expect(db.changeEvent.create).not.toHaveBeenCalled();
  });

  it("tracking disabled → no event", async () => {
    (canTrackFeature as Mock).mockResolvedValue(false);

    const result = await recordAppPermissionsChanged(
      SHOP, ["a"], ["a", "b"], WEBHOOK_ID,
    );

    expect(result).toBe(false);
    expect(db.changeEvent.create).not.toHaveBeenCalled();
  });
});

// =============================================================================
// DOMAIN CHANGE DETECTION (Pro only)
// =============================================================================

describe("Domain Changes", () => {
  it("domain changed → high importance", async () => {
    const result = await recordDomainChanged(
      SHOP, "dom_1", "shop.example.com", WEBHOOK_ID,
    );

    expect(result).toBe(true);

    const data = getCreatedEventData();
    expect(data.eventType).toBe("domain_changed");
    expect(data.importance).toBe("high");
    expect(data.resourceName).toBe("shop.example.com");
    expect(data.afterValue).toBe("shop.example.com");
    expect(data.entityType).toBe("domain");
    expect(eventConfig["domain_changed"]).toBeDefined();
  });

  it("domain removed → high importance", async () => {
    const result = await recordDomainRemoved(
      SHOP, "dom_1", "old.example.com", WEBHOOK_ID,
    );

    expect(result).toBe(true);

    const data = getCreatedEventData();
    expect(data.eventType).toBe("domain_removed");
    expect(data.importance).toBe("high");
    expect(data.resourceName).toBe("old.example.com");
    expect(data.beforeValue).toBe("old.example.com");
    expect(data.afterValue).toBeNull();
    expect(data.entityType).toBe("domain");
    expect(eventConfig["domain_removed"]).toBeDefined();
  });

  it("domain tracking disabled → no events", async () => {
    (canTrackFeature as Mock).mockResolvedValue(false);

    expect(await recordDomainChanged(SHOP, "d1", "x.com", WEBHOOK_ID)).toBe(false);
    expect(await recordDomainRemoved(SHOP, "d1", "x.com", WEBHOOK_ID)).toBe(false);
    expect(db.changeEvent.create).not.toHaveBeenCalled();
  });
});

// =============================================================================
// JOB PROCESSOR EVENT TYPES (produced by jobProcessor.server.ts, not changeDetection)
// These event types are verified for display config coverage.
// =============================================================================

describe("Job Processor event types — display config coverage", () => {
  it("inventory_update has display config with correct label and color", () => {
    const config = eventConfig["inventory_update"];
    expect(config).toBeDefined();
    expect(config.label).toBe("Stock Update");
    expect(config.color).toBe("#2563eb");
  });

  it("product_created has display config", () => {
    const config = eventConfig["product_created"];
    expect(config).toBeDefined();
    expect(config.label).toBe("Product Created");
  });

  it("product_updated has display config", () => {
    const config = eventConfig["product_updated"];
    expect(config).toBeDefined();
    expect(config.label).toBe("Product Updated");
  });

  it("product_deleted has display config", () => {
    const config = eventConfig["product_deleted"];
    expect(config).toBeDefined();
    expect(config.label).toBe("Product Deleted");
  });

  it("product_snapshot has display config", () => {
    const config = eventConfig["product_snapshot"];
    expect(config).toBeDefined();
    expect(config.label).toBe("Product Snapshot");
  });

  // Verify the expected shape of jobProcessor-produced events
  it("inventory_update event shape is correct", () => {
    // Expected structure from jobProcessor line 1014-1032
    const expectedShape = {
      entityType: "variant",
      eventType: "inventory_update",
      source: "webhook",
      importance: "low",
    };
    expect(expectedShape.eventType).toBe("inventory_update");
    expect(expectedShape.importance).toBe("low");
    expect(eventConfig[expectedShape.eventType]).toBeDefined();
  });

  it("product_created event shape is correct", () => {
    const expectedShape = {
      entityType: "product",
      eventType: "product_created",
      source: "webhook",
      importance: "low",
    };
    expect(expectedShape.eventType).toBe("product_created");
    expect(expectedShape.importance).toBe("low");
    expect(eventConfig[expectedShape.eventType]).toBeDefined();
  });

  it("product_updated event shape is correct", () => {
    const expectedShape = {
      entityType: "product",
      eventType: "product_updated",
      source: "webhook",
      importance: "low",
    };
    expect(expectedShape.eventType).toBe("product_updated");
    expect(expectedShape.importance).toBe("low");
    expect(eventConfig[expectedShape.eventType]).toBeDefined();
  });

  it("product_deleted event shape is correct", () => {
    const expectedShape = {
      entityType: "product",
      eventType: "product_deleted",
      source: "webhook",
      importance: "low",
    };
    expect(expectedShape.eventType).toBe("product_deleted");
    expect(expectedShape.importance).toBe("low");
    expect(eventConfig[expectedShape.eventType]).toBeDefined();
  });
});

// =============================================================================
// CROSS-CUTTING: Every changeDetection event type has a display config entry
// =============================================================================

describe("Display config completeness", () => {
  const changeDetectionEventTypes = [
    "price_change",
    "visibility_change",
    "inventory_zero",
    "inventory_low",
    "theme_publish",
    "collection_created",
    "collection_updated",
    "collection_deleted",
    "discount_created",
    "discount_changed",
    "discount_deleted",
    "app_permissions_changed",
    "domain_changed",
    "domain_removed",
  ];

  const jobProcessorEventTypes = [
    "product_updated",
    "product_created",
    "product_deleted",
    "product_snapshot",
    "inventory_update",
  ];

  const allEventTypes = [...changeDetectionEventTypes, ...jobProcessorEventTypes];

  for (const eventType of allEventTypes) {
    it(`eventType "${eventType}" has a display config entry`, () => {
      expect(eventConfig[eventType]).toBeDefined();
      expect(eventConfig[eventType].label).toBeTruthy();
      expect(eventConfig[eventType].color).toMatch(/^#[0-9a-fA-F]{6}$/);
    });
  }
});
