import { describe, it, expect } from "vitest";
import {
  generateDisplayName,
  generateInventoryMessage,
  isGiftCard,
  wasInventoryUpdateCausedByOrder,
  buildInventoryDiff,
} from "./inventoryProcessing";

describe("generateDisplayName", () => {
  it("should return product title only when no variant", () => {
    expect(generateDisplayName("Widget", null)).toBe("Widget");
  });

  it("should return product title only for Default Title variant", () => {
    expect(generateDisplayName("Widget", "Default Title")).toBe("Widget");
  });

  it("should combine product and variant titles", () => {
    expect(generateDisplayName("Widget", "Large")).toBe("Widget - Large");
    expect(generateDisplayName("T-Shirt", "Blue / XL")).toBe("T-Shirt - Blue / XL");
  });
});

describe("generateInventoryMessage", () => {
  it("should show increase arrow when stock goes up", () => {
    const message = generateInventoryMessage("Widget", 10, 15);
    expect(message).toBe('Stock ↑ "Widget" (10 → 15)');
  });

  it("should show decrease arrow when stock goes down", () => {
    const message = generateInventoryMessage("Widget", 20, 15);
    expect(message).toBe('Stock ↓ "Widget" (20 → 15)');
  });

  it("should show simple message when no previous value", () => {
    const message = generateInventoryMessage("Widget", null, 100);
    expect(message).toBe('Stock updated: "Widget" (100 units)');
  });

  it("should show simple message when value unchanged", () => {
    const message = generateInventoryMessage("Widget", 50, 50);
    expect(message).toBe('Stock updated: "Widget" (50 units)');
  });

  it("should handle zero stock", () => {
    expect(generateInventoryMessage("Widget", 5, 0)).toBe('Stock ↓ "Widget" (5 → 0)');
    expect(generateInventoryMessage("Widget", 0, 5)).toBe('Stock ↑ "Widget" (0 → 5)');
  });
});

describe("isGiftCard", () => {
  it("should detect gift card in title", () => {
    expect(isGiftCard("$50 Gift Card", "")).toBe(true);
    expect(isGiftCard("Store Gift Card", "product")).toBe(true);
    expect(isGiftCard("GIFT CARD $100", "")).toBe(true);
  });

  it("should detect gift_card product type", () => {
    expect(isGiftCard("Store Credit", "gift_card")).toBe(true);
    expect(isGiftCard("Store Credit", "GIFT_CARD")).toBe(true);
  });

  it("should not flag regular products", () => {
    expect(isGiftCard("Regular Widget", "widget")).toBe(false);
    expect(isGiftCard("Card Holder", "accessory")).toBe(false);
    expect(isGiftCard("Gift Box", "packaging")).toBe(false);
  });
});

describe("wasInventoryUpdateCausedByOrder", () => {
  it("should return true when product is in order items", () => {
    const orderDiff = JSON.stringify({
      items: [
        { productId: 123, title: "Widget", quantity: 2 },
        { productId: 456, title: "Gadget", quantity: 1 },
      ],
    });

    expect(wasInventoryUpdateCausedByOrder("123", orderDiff)).toBe(true);
    expect(wasInventoryUpdateCausedByOrder("456", orderDiff)).toBe(true);
  });

  it("should return false when product is not in order items", () => {
    const orderDiff = JSON.stringify({
      items: [{ productId: 123, title: "Widget", quantity: 2 }],
    });

    expect(wasInventoryUpdateCausedByOrder("999", orderDiff)).toBe(false);
  });

  it("should return false for null/empty inputs", () => {
    expect(wasInventoryUpdateCausedByOrder("123", null)).toBe(false);
    expect(wasInventoryUpdateCausedByOrder("", '{"items":[]}')).toBe(false);
  });

  it("should return false for invalid JSON", () => {
    expect(wasInventoryUpdateCausedByOrder("123", "not json")).toBe(false);
  });

  it("should return false when items array is missing", () => {
    const orderDiff = JSON.stringify({ orderId: 1, total: "100" });
    expect(wasInventoryUpdateCausedByOrder("123", orderDiff)).toBe(false);
  });

  it("should handle string vs number productId comparison", () => {
    const orderDiff = JSON.stringify({
      items: [{ productId: 123456789, title: "Widget" }],
    });

    // Our function converts to string for comparison
    expect(wasInventoryUpdateCausedByOrder("123456789", orderDiff)).toBe(true);
  });
});

describe("buildInventoryDiff", () => {
  it("should include inventory change when values differ", () => {
    const diff = buildInventoryDiff(15, 20, 12345);
    const parsed = JSON.parse(diff);

    expect(parsed.available).toBe(15);
    expect(parsed.inventoryChange).toEqual({ old: 20, new: 15 });
    expect(parsed.locationId).toBe(12345);
  });

  it("should not include inventory change when no previous value", () => {
    const diff = buildInventoryDiff(100, null, 12345);
    const parsed = JSON.parse(diff);

    expect(parsed.available).toBe(100);
    expect(parsed.inventoryChange).toBeNull();
    expect(parsed.locationId).toBe(12345);
  });

  it("should not include inventory change when values are same", () => {
    const diff = buildInventoryDiff(50, 50, 12345);
    const parsed = JSON.parse(diff);

    expect(parsed.available).toBe(50);
    expect(parsed.inventoryChange).toBeNull();
  });

  it("should handle zero values correctly", () => {
    const diff = buildInventoryDiff(0, 5, 12345);
    const parsed = JSON.parse(diff);

    expect(parsed.available).toBe(0);
    expect(parsed.inventoryChange).toEqual({ old: 5, new: 0 });
  });
});
