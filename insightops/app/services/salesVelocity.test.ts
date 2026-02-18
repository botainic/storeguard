import { describe, it, expect } from "vitest";
import {
  calculateProductVelocity,
  getProductVelocity,
  formatVelocityContext,
  estimateRevenueImpact,
  type OrderData,
  type ProductVelocity,
} from "./salesVelocity.utils";

describe("calculateProductVelocity", () => {
  it("should calculate velocity for a single product across multiple orders", () => {
    const orders: OrderData[] = [
      {
        id: "1",
        createdAt: "2026-02-15T10:00:00Z",
        lineItems: [
          { productId: "100", variantId: "200", quantity: 2, price: 50 },
        ],
      },
      {
        id: "2",
        createdAt: "2026-02-16T10:00:00Z",
        lineItems: [
          { productId: "100", variantId: "200", quantity: 3, price: 50 },
        ],
      },
    ];

    const result = calculateProductVelocity(orders, 30);
    const velocity = result.get("100");

    expect(velocity).toBeDefined();
    expect(velocity!.totalUnitsSold).toBe(5);
    expect(velocity!.totalRevenue).toBe(250); // 5 * 50
    expect(velocity!.orderCount).toBe(2);
    expect(velocity!.dailySalesRate).toBeCloseTo(5 / 30);
    expect(velocity!.dailyRevenue).toBeCloseTo(250 / 30);
    expect(velocity!.periodDays).toBe(30);
  });

  it("should calculate velocity for multiple products", () => {
    const orders: OrderData[] = [
      {
        id: "1",
        createdAt: "2026-02-15T10:00:00Z",
        lineItems: [
          { productId: "100", variantId: "200", quantity: 1, price: 50 },
          { productId: "101", variantId: "201", quantity: 3, price: 20 },
        ],
      },
      {
        id: "2",
        createdAt: "2026-02-16T10:00:00Z",
        lineItems: [
          { productId: "100", variantId: "200", quantity: 1, price: 50 },
        ],
      },
    ];

    const result = calculateProductVelocity(orders, 7);

    expect(result.size).toBe(2);
    expect(result.get("100")!.totalUnitsSold).toBe(2);
    expect(result.get("100")!.orderCount).toBe(2);
    expect(result.get("101")!.totalUnitsSold).toBe(3);
    expect(result.get("101")!.orderCount).toBe(1);
  });

  it("should handle empty orders", () => {
    const result = calculateProductVelocity([], 30);
    expect(result.size).toBe(0);
  });

  it("should use minimum 1 day for period to avoid division by zero", () => {
    const orders: OrderData[] = [
      {
        id: "1",
        createdAt: "2026-02-15T10:00:00Z",
        lineItems: [
          { productId: "100", variantId: "200", quantity: 5, price: 10 },
        ],
      },
    ];

    const result = calculateProductVelocity(orders, 0);
    const velocity = result.get("100");
    expect(velocity!.dailySalesRate).toBe(5); // 5 units / 1 day
    expect(velocity!.periodDays).toBe(1);
  });

  it("should count same order only once in orderCount even with multiple line items", () => {
    const orders: OrderData[] = [
      {
        id: "1",
        createdAt: "2026-02-15T10:00:00Z",
        lineItems: [
          { productId: "100", variantId: "200", quantity: 1, price: 50 },
          { productId: "100", variantId: "201", quantity: 2, price: 40 },
        ],
      },
    ];

    const result = calculateProductVelocity(orders, 30);
    const velocity = result.get("100");
    expect(velocity!.totalUnitsSold).toBe(3);
    expect(velocity!.totalRevenue).toBe(130); // 1*50 + 2*40
    expect(velocity!.orderCount).toBe(1); // Same order
  });
});

describe("getProductVelocity", () => {
  it("should return velocity for existing product", () => {
    const map = new Map<string, ProductVelocity>();
    map.set("100", {
      productId: "100",
      totalUnitsSold: 10,
      totalRevenue: 500,
      orderCount: 5,
      dailySalesRate: 2,
      dailyRevenue: 100,
      periodDays: 5,
    });

    expect(getProductVelocity(map, "100")).toBeDefined();
    expect(getProductVelocity(map, "100")!.totalUnitsSold).toBe(10);
  });

  it("should return null for non-existing product", () => {
    const map = new Map<string, ProductVelocity>();
    expect(getProductVelocity(map, "999")).toBeNull();
  });
});

describe("formatVelocityContext", () => {
  it("should return null for null velocity", () => {
    expect(formatVelocityContext(null)).toBeNull();
  });

  it("should return null for zero sales", () => {
    expect(
      formatVelocityContext({
        productId: "100",
        totalUnitsSold: 0,
        totalRevenue: 0,
        orderCount: 0,
        dailySalesRate: 0,
        dailyRevenue: 0,
        periodDays: 30,
      })
    ).toBeNull();
  });

  it("should format high velocity (>=1/day)", () => {
    expect(
      formatVelocityContext({
        productId: "100",
        totalUnitsSold: 240,
        totalRevenue: 12000,
        orderCount: 200,
        dailySalesRate: 8,
        dailyRevenue: 400,
        periodDays: 30,
      })
    ).toBe("selling 8/day");
  });

  it("should round high velocity", () => {
    expect(
      formatVelocityContext({
        productId: "100",
        totalUnitsSold: 100,
        totalRevenue: 5000,
        orderCount: 80,
        dailySalesRate: 3.33,
        dailyRevenue: 166.5,
        periodDays: 30,
      })
    ).toBe("selling 3/day");
  });

  it("should format moderate velocity (~1/week or more)", () => {
    expect(
      formatVelocityContext({
        productId: "100",
        totalUnitsSold: 6,
        totalRevenue: 300,
        orderCount: 6,
        dailySalesRate: 0.2,
        dailyRevenue: 10,
        periodDays: 30,
      })
    ).toBe("selling ~1/week");
  });

  it("should format low velocity (total count)", () => {
    expect(
      formatVelocityContext({
        productId: "100",
        totalUnitsSold: 3,
        totalRevenue: 150,
        orderCount: 3,
        dailySalesRate: 0.1,
        dailyRevenue: 5,
        periodDays: 30,
      })
    ).toBe("sold 3 in the last 30 days");
  });
});

describe("estimateRevenueImpact", () => {
  const highVelocity: ProductVelocity = {
    productId: "100",
    totalUnitsSold: 240,
    totalRevenue: 12000,
    orderCount: 200,
    dailySalesRate: 8,
    dailyRevenue: 400,
    periodDays: 30,
  };

  it("should return null for null velocity", () => {
    expect(estimateRevenueImpact(null, "price_error", { priceDifference: 10 })).toBeNull();
  });

  it("should return null for zero daily sales rate", () => {
    const zeroVelocity: ProductVelocity = {
      ...highVelocity,
      dailySalesRate: 0,
    };
    expect(estimateRevenueImpact(zeroVelocity, "price_error", { priceDifference: 10 })).toBeNull();
  });

  it("should calculate price error impact with 50% conservative factor", () => {
    // hourlySalesRate = 8/24 = 0.333
    // impact = 0.333 * 2 hours * $40 diff * 0.5 = $13.33
    const result = estimateRevenueImpact(highVelocity, "price_error", {
      priceDifference: 40,
      hoursUntilDiscovery: 2,
    });
    expect(result).toBeCloseTo(13.33, 1);
  });

  it("should use default 2 hours for discovery time", () => {
    const result = estimateRevenueImpact(highVelocity, "price_error", {
      priceDifference: 40,
    });
    // Same calc as above: 0.333 * 2 * 40 * 0.5 = 13.33
    expect(result).toBeCloseTo(13.33, 1);
  });

  it("should return null for zero price difference on price error", () => {
    expect(
      estimateRevenueImpact(highVelocity, "price_error", { priceDifference: 0 })
    ).toBeNull();
  });

  it("should calculate stockout impact", () => {
    // hourlySalesRate = 8/24 = 0.333
    // avgPrice = 400/8 = 50
    // impact = 0.333 * 2 * 50 * 0.5 = 16.67
    const result = estimateRevenueImpact(highVelocity, "stockout", {});
    expect(result).toBeCloseTo(16.67, 0);
  });

  it("should calculate visibility impact", () => {
    // Same as stockout
    const result = estimateRevenueImpact(highVelocity, "visibility", {});
    expect(result).toBeCloseTo(16.67, 0);
  });

  it("should use custom item price when provided", () => {
    // hourlySalesRate = 8/24 = 0.333
    // impact = 0.333 * 2 * 100 * 0.5 = 33.33
    const result = estimateRevenueImpact(highVelocity, "stockout", {
      itemPrice: 100,
    });
    expect(result).toBeCloseTo(33.33, 1);
  });

  it("should use custom hours until discovery", () => {
    // hourlySalesRate = 8/24 = 0.333
    // avgPrice = 50
    // impact = 0.333 * 24 * 50 * 0.5 = 200
    const result = estimateRevenueImpact(highVelocity, "stockout", {
      hoursUntilDiscovery: 24,
    });
    expect(result).toBeCloseTo(200, 0);
  });
});
