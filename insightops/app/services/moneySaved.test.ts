import { describe, it, expect } from "vitest";
import { estimateMoneySaved } from "./moneySaved.utils";
import type { ProductVelocity } from "./salesVelocity.utils";

function makeVelocity(overrides: Partial<ProductVelocity> = {}): ProductVelocity {
  return {
    productId: "123",
    totalUnitsSold: 240,
    totalRevenue: 7200, // avg price $30
    orderCount: 200,
    dailySalesRate: 8, // 8 units/day
    dailyRevenue: 240,
    periodDays: 30,
    ...overrides,
  };
}

describe("estimateMoneySaved", () => {
  // ===================
  // Price change events
  // ===================
  describe("price_change", () => {
    it("should estimate savings for a price drop", () => {
      // $89 -> $8.90 = $80.10 delta
      // 8 units/day * $80.10 * 3 days * 0.5 = $961.20
      const result = estimateMoneySaved({
        eventType: "price_change",
        velocity: makeVelocity(),
        beforeValue: "$89.00",
        afterValue: "$8.90",
      });

      expect(result).not.toBeNull();
      expect(result).toBeCloseTo(961.2, 1);
    });

    it("should return null for price increases (no loss)", () => {
      const result = estimateMoneySaved({
        eventType: "price_change",
        velocity: makeVelocity(),
        beforeValue: "$50.00",
        afterValue: "$75.00",
      });

      expect(result).toBeNull();
    });

    it("should handle prices without dollar signs", () => {
      const result = estimateMoneySaved({
        eventType: "price_change",
        velocity: makeVelocity({ dailySalesRate: 10 }),
        beforeValue: "100.00",
        afterValue: "80.00",
      });

      // $20 delta * 10/day * 3 days * 0.5 = $300
      expect(result).toBeCloseTo(300, 1);
    });

    it("should return null when no velocity data", () => {
      const result = estimateMoneySaved({
        eventType: "price_change",
        velocity: null,
        beforeValue: "$100.00",
        afterValue: "$50.00",
      });

      expect(result).toBeNull();
    });

    it("should return null when velocity is zero", () => {
      const result = estimateMoneySaved({
        eventType: "price_change",
        velocity: makeVelocity({ dailySalesRate: 0 }),
        beforeValue: "$100.00",
        afterValue: "$50.00",
      });

      expect(result).toBeNull();
    });

    it("should return null for unparseable prices", () => {
      const result = estimateMoneySaved({
        eventType: "price_change",
        velocity: makeVelocity(),
        beforeValue: "free",
        afterValue: "$50.00",
      });

      expect(result).toBeNull();
    });

    it("should return null when beforeValue is null", () => {
      const result = estimateMoneySaved({
        eventType: "price_change",
        velocity: makeVelocity(),
        beforeValue: null,
        afterValue: "$50.00",
      });

      expect(result).toBeNull();
    });
  });

  // ========================
  // Inventory zero events
  // ========================
  describe("inventory_zero", () => {
    it("should estimate savings for out-of-stock", () => {
      // 8 units/day * $30 avg price * 3 days * 0.5 = $360
      const result = estimateMoneySaved({
        eventType: "inventory_zero",
        velocity: makeVelocity(),
        beforeValue: "10",
        afterValue: "0",
      });

      expect(result).not.toBeNull();
      expect(result).toBeCloseTo(360, 1);
    });

    it("should return null when no velocity data", () => {
      const result = estimateMoneySaved({
        eventType: "inventory_zero",
        velocity: null,
        beforeValue: "10",
        afterValue: "0",
      });

      expect(result).toBeNull();
    });

    it("should return null when no sales", () => {
      const result = estimateMoneySaved({
        eventType: "inventory_zero",
        velocity: makeVelocity({ dailySalesRate: 0, totalUnitsSold: 0, totalRevenue: 0 }),
        beforeValue: "10",
        afterValue: "0",
      });

      expect(result).toBeNull();
    });
  });

  // ========================
  // Inventory low events
  // ========================
  describe("inventory_low", () => {
    it("should estimate savings (same formula as stockout)", () => {
      // 8 units/day * $30 avg * 3 days * 0.5 = $360
      const result = estimateMoneySaved({
        eventType: "inventory_low",
        velocity: makeVelocity(),
        beforeValue: "10",
        afterValue: "3",
      });

      expect(result).not.toBeNull();
      expect(result).toBeCloseTo(360, 1);
    });
  });

  // ========================
  // Visibility change events
  // ========================
  describe("visibility_change", () => {
    it("should estimate savings when product is hidden (draft)", () => {
      // 8 units/day * $30 avg * 3 days * 0.5 = $360
      const result = estimateMoneySaved({
        eventType: "visibility_change",
        velocity: makeVelocity(),
        beforeValue: "active",
        afterValue: "draft",
      });

      expect(result).not.toBeNull();
      expect(result).toBeCloseTo(360, 1);
    });

    it("should estimate savings when product is archived", () => {
      const result = estimateMoneySaved({
        eventType: "visibility_change",
        velocity: makeVelocity(),
        beforeValue: "active",
        afterValue: "archived",
      });

      expect(result).not.toBeNull();
      expect(result).toBeCloseTo(360, 1);
    });

    it("should return null when product becomes visible (no loss)", () => {
      const result = estimateMoneySaved({
        eventType: "visibility_change",
        velocity: makeVelocity(),
        beforeValue: "draft",
        afterValue: "active",
      });

      expect(result).toBeNull();
    });
  });

  // ========================
  // Non-applicable event types
  // ========================
  describe("non-applicable events", () => {
    it("should return null for theme_publish", () => {
      const result = estimateMoneySaved({
        eventType: "theme_publish",
        velocity: makeVelocity(),
        beforeValue: null,
        afterValue: "main",
      });

      expect(result).toBeNull();
    });

    it("should return null for collection events", () => {
      const result = estimateMoneySaved({
        eventType: "collection_deleted",
        velocity: makeVelocity(),
        beforeValue: "Featured",
        afterValue: null,
      });

      expect(result).toBeNull();
    });

    it("should return null for discount events", () => {
      const result = estimateMoneySaved({
        eventType: "discount_deleted",
        velocity: makeVelocity(),
        beforeValue: "SALE50",
        afterValue: null,
      });

      expect(result).toBeNull();
    });
  });

  // ========================
  // Edge cases
  // ========================
  describe("edge cases", () => {
    it("should round to 2 decimal places", () => {
      // velocity 3/day, price delta $7.33
      // 3 * 7.33 * 3 * 0.5 = 32.985 -> 32.98 or 32.99 (floating point)
      const result = estimateMoneySaved({
        eventType: "price_change",
        velocity: makeVelocity({ dailySalesRate: 3 }),
        beforeValue: "$17.33",
        afterValue: "$10.00",
      });

      expect(result).not.toBeNull();
      // Floating point: Math.round(32.985 * 100) / 100 = 32.98
      expect(result).toBe(32.98);
    });

    it("should handle very high velocity products", () => {
      // 100 units/day * $50 delta * 3 days * 0.5 = $7500
      const result = estimateMoneySaved({
        eventType: "price_change",
        velocity: makeVelocity({ dailySalesRate: 100 }),
        beforeValue: "$100.00",
        afterValue: "$50.00",
      });

      expect(result).toBeCloseTo(7500, 1);
    });

    it("should handle very low velocity products", () => {
      // 0.1 units/day * $30 avg * 3 days * 0.5 = $4.50
      const result = estimateMoneySaved({
        eventType: "inventory_zero",
        velocity: makeVelocity({
          dailySalesRate: 0.1,
          totalUnitsSold: 3,
          totalRevenue: 90,
        }),
        beforeValue: "5",
        afterValue: "0",
      });

      expect(result).toBeCloseTo(4.5, 1);
    });
  });
});
