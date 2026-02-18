import { describe, it, expect } from "vitest";
import {
  enrichPriceChange,
  enrichInventoryZero,
  enrichLowStock,
  enrichVisibilityChange,
  enrichThemePublish,
  serializeContext,
  parseContextData,
  type EnrichedContext,
} from "./contextEnricher.server";
import type { ProductVelocity } from "./salesVelocity.utils";

const highVelocity: ProductVelocity = {
  productId: "100",
  totalUnitsSold: 240,
  totalRevenue: 12000,
  orderCount: 200,
  dailySalesRate: 8,
  dailyRevenue: 400,
  periodDays: 30,
};

const lowVelocity: ProductVelocity = {
  productId: "100",
  totalUnitsSold: 3,
  totalRevenue: 150,
  orderCount: 3,
  dailySalesRate: 0.1,
  dailyRevenue: 5,
  periodDays: 30,
};

describe("enrichPriceChange", () => {
  it("should calculate percent decrease and direction", () => {
    const result = enrichPriceChange("Blue Jacket", "$100.00", "$50.00", null);
    expect(result.percentChange).toBe(-50);
    expect(result.direction).toBe("down");
    expect(result.summary).toContain("50% decrease");
  });

  it("should calculate percent increase and direction", () => {
    const result = enrichPriceChange("Blue Jacket", "$50.00", "$100.00", null);
    expect(result.percentChange).toBe(100);
    expect(result.direction).toBe("up");
    expect(result.summary).toContain("100% increase");
  });

  it("should flag likely typos for >=90% drops", () => {
    const result = enrichPriceChange("Blue Jacket", "$89.00", "$8.90", null);
    expect(result.summary).toContain("probably a typo");
    expect(result.direction).toBe("down");
  });

  it("should not flag typo for moderate decreases", () => {
    const result = enrichPriceChange("Blue Jacket", "$100.00", "$80.00", null);
    expect(result.summary).not.toContain("probably a typo");
  });

  it("should include velocity context when available", () => {
    const result = enrichPriceChange("Blue Jacket", "$100.00", "$50.00", highVelocity);
    expect(result.velocityContext).toBe("selling 8/day");
    expect(result.summary).toContain("selling 8/day");
    expect(result.revenueImpact).not.toBeNull();
  });

  it("should handle no velocity data gracefully", () => {
    const result = enrichPriceChange("Blue Jacket", "$100.00", "$50.00", null);
    expect(result.velocityContext).toBeNull();
    expect(result.revenueImpact).toBeNull();
  });

  it("should handle zero old price", () => {
    const result = enrichPriceChange("Free Item", "$0.00", "$10.00", null);
    // Can't calculate % change from $0
    expect(result.percentChange).toBeNull();
    expect(result.direction).toBeNull();
  });
});

describe("enrichInventoryZero", () => {
  it("should include previous quantity in summary", () => {
    const result = enrichInventoryZero("Black Hoodie", "15", null, null);
    expect(result.summary).toContain("Black Hoodie hit zero stock (was 15 units)");
  });

  it("should include velocity context", () => {
    const result = enrichInventoryZero("Black Hoodie", "15", highVelocity, null);
    expect(result.summary).toContain("you've been selling 8/day");
    expect(result.revenueImpact).not.toBeNull();
  });

  it("should include location context", () => {
    const result = enrichInventoryZero("Black Hoodie", "15", null, "Warehouse A");
    expect(result.summary).toContain("at Warehouse A");
    expect(result.locationContext).toBe("Warehouse A");
  });

  it("should include both velocity and location", () => {
    const result = enrichInventoryZero("Black Hoodie", "15", highVelocity, "Main Store");
    expect(result.summary).toContain("selling 8/day");
    expect(result.summary).toContain("at Main Store");
  });
});

describe("enrichLowStock", () => {
  it("should show current and previous quantities", () => {
    const result = enrichLowStock("Red Sneakers", "10", "3", null, null);
    expect(result.summary).toContain("dropped to 3 units (was 10)");
  });

  it("should include velocity context", () => {
    const result = enrichLowStock("Red Sneakers", "10", "3", lowVelocity, null);
    expect(result.summary).toContain("sold 3 in the last 30 days");
  });

  it("should include location context", () => {
    const result = enrichLowStock("Red Sneakers", "10", "3", null, "Store Front");
    expect(result.summary).toContain("at Store Front");
  });
});

describe("enrichVisibilityChange", () => {
  it("should describe going hidden", () => {
    const result = enrichVisibilityChange("Red Sneakers", "active", "draft", null);
    expect(result.summary).toContain("no longer visible to customers");
    expect(result.summary).toContain("active → draft");
  });

  it("should describe going visible", () => {
    const result = enrichVisibilityChange("Red Sneakers", "draft", "active", null);
    expect(result.summary).toContain("now visible to customers");
  });

  it("should include velocity for hidden products with sales", () => {
    const result = enrichVisibilityChange("Red Sneakers", "active", "draft", highVelocity);
    expect(result.summary).toContain("selling 8/day");
    expect(result.revenueImpact).not.toBeNull();
  });
});

describe("enrichThemePublish", () => {
  it("should include theme name and time", () => {
    const result = enrichThemePublish("Dawn Custom");
    expect(result.summary).toContain('Theme "Dawn Custom" went live');
    expect(result.velocityContext).toBeNull();
    expect(result.revenueImpact).toBeNull();
  });
});

describe("serializeContext", () => {
  it("should serialize all fields", () => {
    const context: EnrichedContext = {
      summary: "Test summary",
      velocityContext: "selling 8/day",
      revenueImpact: 16.67,
      locationContext: "Warehouse A",
      percentChange: -50,
      direction: "down",
    };
    const json = serializeContext(context);
    expect(json).not.toBeNull();
    const parsed = JSON.parse(json!);
    expect(parsed.summary).toBe("Test summary");
    expect(parsed.velocityContext).toBe("selling 8/day");
    expect(parsed.revenueImpact).toBe(16.67);
    expect(parsed.locationContext).toBe("Warehouse A");
    expect(parsed.percentChange).toBe(-50);
    expect(parsed.direction).toBe("down");
  });

  it("should omit null optional fields", () => {
    const context: EnrichedContext = {
      summary: "Simple summary",
      velocityContext: null,
      revenueImpact: null,
      locationContext: null,
      percentChange: null,
      direction: null,
    };
    const json = serializeContext(context);
    const parsed = JSON.parse(json!);
    expect(parsed.summary).toBe("Simple summary");
    expect(parsed.velocityContext).toBeUndefined();
    expect(parsed.revenueImpact).toBeUndefined();
  });

  it("should return null for empty summary", () => {
    const context: EnrichedContext = {
      summary: "",
      velocityContext: null,
      revenueImpact: null,
      locationContext: null,
      percentChange: null,
      direction: null,
    };
    expect(serializeContext(context)).toBeNull();
  });
});

describe("parseContextData", () => {
  it("should parse valid JSON with all fields", () => {
    const json = JSON.stringify({
      summary: "Test",
      velocityContext: "selling 8/day",
      revenueImpact: 16.67,
      locationContext: "Warehouse",
      percentChange: -50,
      direction: "down",
    });
    const result = parseContextData(json);
    expect(result.summary).toBe("Test");
    expect(result.velocityContext).toBe("selling 8/day");
    expect(result.revenueImpact).toBe(16.67);
    expect(result.locationContext).toBe("Warehouse");
    expect(result.percentChange).toBe(-50);
    expect(result.direction).toBe("down");
  });

  it("should return defaults for null input", () => {
    const result = parseContextData(null);
    expect(result.summary).toBeNull();
    expect(result.velocityContext).toBeNull();
    expect(result.revenueImpact).toBeNull();
    expect(result.percentChange).toBeNull();
    expect(result.direction).toBeNull();
  });

  it("should return defaults for invalid JSON", () => {
    const result = parseContextData("not json");
    expect(result.summary).toBeNull();
  });

  it("should handle legacy contextData without summary field", () => {
    const json = JSON.stringify({ velocityContext: "selling 8/day", revenueImpact: 10 });
    const result = parseContextData(json);
    expect(result.summary).toBeNull();
    expect(result.velocityContext).toBe("selling 8/day");
    expect(result.revenueImpact).toBe(10);
  });

  it("should reject invalid direction values", () => {
    const json = JSON.stringify({ direction: "sideways" });
    const result = parseContextData(json);
    expect(result.direction).toBeNull();
  });
});
