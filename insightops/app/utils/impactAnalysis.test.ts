import { describe, it, expect } from "vitest";
import {
  isStrategicEvent,
  calcAvgSales,
  calculateImpactAnalysis,
  getItemName,
  getAction,
  getItemType,
  type SalesDataPoint,
  type EventLog,
} from "./impactAnalysis";

describe("isStrategicEvent", () => {
  describe("inventory events", () => {
    it("should return false for inventory updates (consequential)", () => {
      expect(isStrategicEvent("INVENTORY_LEVELS_UPDATE", null)).toBe(false);
      expect(isStrategicEvent("inventory/levels/update", null)).toBe(false);
    });
  });

  describe("order events", () => {
    it("should return false for orders (consequential)", () => {
      expect(isStrategicEvent("ORDERS_CREATE", null)).toBe(false);
      expect(isStrategicEvent("orders/paid", null)).toBe(false);
      expect(isStrategicEvent("orders/create", null)).toBe(false);
    });
  });

  describe("product events", () => {
    it("should return true for product price changes (strategic)", () => {
      const diff = JSON.stringify({
        changes: [{ field: "price", old: "10.00", new: "15.00" }],
      });
      expect(isStrategicEvent("products/update", diff)).toBe(true);
    });

    it("should return true for product title changes (strategic)", () => {
      const diff = JSON.stringify({
        changes: [{ field: "title", old: "Old Name", new: "New Name" }],
      });
      expect(isStrategicEvent("products/update", diff)).toBe(true);
    });

    it("should return true for product description changes (strategic)", () => {
      const diff = JSON.stringify({
        changes: [{ field: "description", old: "Old desc", new: "New desc" }],
      });
      expect(isStrategicEvent("PRODUCTS_UPDATE", diff)).toBe(true);
    });

    it("should return false for product updates with ONLY stock changes (consequential)", () => {
      const diff = JSON.stringify({
        changes: [{ field: "inventory", old: 100, new: 95 }],
      });
      expect(isStrategicEvent("products/update", diff)).toBe(false);
    });

    it("should return false for product updates with ONLY stock field (consequential)", () => {
      const diff = JSON.stringify({
        changes: [{ field: "stock", old: 50, new: 48 }],
      });
      expect(isStrategicEvent("products/update", diff)).toBe(false);
    });

    it("should return true for product updates with mixed changes (strategic)", () => {
      const diff = JSON.stringify({
        changes: [
          { field: "inventory", old: 100, new: 95 },
          { field: "price", old: "10.00", new: "12.00" },
        ],
      });
      expect(isStrategicEvent("products/update", diff)).toBe(true);
    });

    it("should return true for product create events (strategic)", () => {
      expect(isStrategicEvent("products/create", null)).toBe(true);
    });

    it("should return true for product delete events (strategic)", () => {
      expect(isStrategicEvent("products/delete", null)).toBe(true);
    });

    it("should return true when diff is invalid JSON (assume strategic)", () => {
      expect(isStrategicEvent("products/update", "invalid json")).toBe(true);
    });

    it("should return true when diff has no changes array (assume strategic)", () => {
      const diff = JSON.stringify({ foo: "bar" });
      expect(isStrategicEvent("products/update", diff)).toBe(true);
    });
  });

  describe("collection events", () => {
    it("should return true for collection create (strategic)", () => {
      expect(isStrategicEvent("collections/create", null)).toBe(true);
    });

    it("should return true for collection update (strategic)", () => {
      expect(isStrategicEvent("collections/update", null)).toBe(true);
    });

    it("should return true for collection delete (strategic)", () => {
      expect(isStrategicEvent("collections/delete", null)).toBe(true);
    });
  });
});

describe("calcAvgSales", () => {
  const salesData: SalesDataPoint[] = [
    { hour: "9 AM", sales: 100, timestamp: 1000 },
    { hour: "10 AM", sales: 200, timestamp: 2000 },
    { hour: "11 AM", sales: 300, timestamp: 3000 },
    { hour: "12 PM", sales: 400, timestamp: 4000 },
    { hour: "1 PM", sales: 500, timestamp: 5000 },
  ];

  it("should calculate correct average for valid range", () => {
    expect(calcAvgSales(salesData, 0, 2)).toBe(150); // (100 + 200) / 2
    expect(calcAvgSales(salesData, 1, 3)).toBe(300); // (200 + 300 + 400) / 3
    expect(calcAvgSales(salesData, 3, 2)).toBe(450); // (400 + 500) / 2
  });

  it("should handle partial range at start", () => {
    expect(calcAvgSales(salesData, -1, 3)).toBe(150); // Only [0], [1] are valid: (100 + 200) / 2
  });

  it("should handle partial range at end", () => {
    expect(calcAvgSales(salesData, 4, 3)).toBe(500); // Only [4] is valid: 500 / 1
  });

  it("should return 0 for completely out of bounds", () => {
    expect(calcAvgSales(salesData, 10, 2)).toBe(0);
    expect(calcAvgSales(salesData, -5, 2)).toBe(0);
  });

  it("should handle empty array", () => {
    expect(calcAvgSales([], 0, 2)).toBe(0);
  });
});

describe("calculateImpactAnalysis", () => {
  // Generate sales data with hourly timestamps
  const baseTime = new Date("2024-01-15T09:00:00").getTime();
  const HOUR_MS = 60 * 60 * 1000;

  function generateSalesData(values: number[], startTime = baseTime): SalesDataPoint[] {
    return values.map((sales, i) => ({
      hour: `${9 + i}:00`,
      sales,
      timestamp: startTime + i * HOUR_MS,
    }));
  }

  it("should return null for non-strategic events", () => {
    const salesData = generateSalesData([100, 150, 200, 250, 300]);
    const event: EventLog = {
      id: "1",
      topic: "INVENTORY_LEVELS_UPDATE",
      diff: null,
      timestamp: new Date(baseTime + 2 * HOUR_MS),
    };

    const result = calculateImpactAnalysis(event, salesData, HOUR_MS);
    expect(result).toBeNull();
  });

  it("should return null when not enough data points", () => {
    const salesData = generateSalesData([100, 150, 200]); // Only 3 points
    const event: EventLog = {
      id: "1",
      topic: "products/update",
      diff: JSON.stringify({ changes: [{ field: "price", old: "10", new: "15" }] }),
      timestamp: new Date(baseTime + HOUR_MS),
    };

    const result = calculateImpactAnalysis(event, salesData, HOUR_MS);
    expect(result).toBeNull();
  });

  it("should return null when event time doesn't match any data point", () => {
    const salesData = generateSalesData([100, 150, 200, 250, 300]);
    const event: EventLog = {
      id: "1",
      topic: "products/update",
      diff: JSON.stringify({ changes: [{ field: "price", old: "10", new: "15" }] }),
      timestamp: new Date(baseTime + 100 * HOUR_MS), // Way in the future
    };

    const result = calculateImpactAnalysis(event, salesData, HOUR_MS);
    expect(result).toBeNull();
  });

  it("should calculate impact with fallback baseline (no week-ago data)", () => {
    // Sales: $100, $100, $200, $400, $400
    // Event at index 2 (11 AM)
    // Pre (fallback): avg of [0,1] = $100
    // Post: avg of [3,4] = $400
    // Change: +300%
    const salesData = generateSalesData([100, 100, 200, 400, 400]);
    const event: EventLog = {
      id: "1",
      topic: "products/update",
      diff: JSON.stringify({ changes: [{ field: "price", old: "50", new: "30" }] }),
      timestamp: new Date(baseTime + 2 * HOUR_MS),
    };

    const result = calculateImpactAnalysis(event, salesData, HOUR_MS);

    expect(result).not.toBeNull();
    expect(result!.isSmartBaseline).toBe(false);
    expect(result!.baselineSales).toBe(100);
    expect(result!.postSales).toBe(400);
    expect(result!.percentChange).toBe(300);
    expect(result!.isNegative).toBe(false);
    expect(result!.isZeroBaseline).toBe(false);
  });

  it("should calculate impact with smart baseline (week-ago data available)", () => {
    // Create 8 days of hourly data (enough for WoW comparison)
    const oneWeekMs = 7 * 24 * HOUR_MS;
    const salesValues: number[] = [];

    // Day 1 (7 days ago): Lower sales baseline
    for (let h = 0; h < 24; h++) salesValues.push(50);

    // Days 2-6: Filler data
    for (let d = 0; d < 5; d++) {
      for (let h = 0; h < 24; h++) salesValues.push(75);
    }

    // Day 7 (yesterday): Higher sales
    for (let h = 0; h < 24; h++) salesValues.push(100);

    // Day 8 (today): Even higher after "change"
    for (let h = 0; h < 24; h++) salesValues.push(200);

    const weekAgoStart = baseTime - oneWeekMs;
    const salesData = generateSalesData(salesValues, weekAgoStart);

    // Event at day 8, hour 2 (index ~170)
    const eventTime = baseTime + 2 * HOUR_MS;
    const eventIndex = salesData.findIndex(
      (d) => Math.abs(d.timestamp - eventTime) < HOUR_MS
    );

    const event: EventLog = {
      id: "1",
      topic: "products/update",
      diff: JSON.stringify({ changes: [{ field: "price", old: "100", new: "75" }] }),
      timestamp: new Date(eventTime),
    };

    const result = calculateImpactAnalysis(event, salesData, HOUR_MS);

    expect(result).not.toBeNull();
    expect(result!.isSmartBaseline).toBe(true);
    // Baseline from same time last week (~$50), post is ~$200
    expect(result!.baselineSales).toBe(50);
    expect(result!.postSales).toBe(200);
  });

  it("should return null when both baseline and post are near zero (quiet time)", () => {
    const salesData = generateSalesData([0, 0, 0, 0, 0]);
    const event: EventLog = {
      id: "1",
      topic: "products/update",
      diff: JSON.stringify({ changes: [{ field: "price", old: "10", new: "15" }] }),
      timestamp: new Date(baseTime + 2 * HOUR_MS),
    };

    const result = calculateImpactAnalysis(event, salesData, HOUR_MS);
    expect(result).toBeNull();
  });

  it("should handle zero baseline with non-zero post (new revenue)", () => {
    const salesData = generateSalesData([0, 0, 0, 100, 150]);
    const event: EventLog = {
      id: "1",
      topic: "products/update",
      diff: JSON.stringify({ changes: [{ field: "price", old: "10", new: "5" }] }),
      timestamp: new Date(baseTime + 2 * HOUR_MS),
    };

    const result = calculateImpactAnalysis(event, salesData, HOUR_MS);

    expect(result).not.toBeNull();
    expect(result!.isZeroBaseline).toBe(true);
    expect(result!.percentChange).toBe(0); // No % when baseline is 0
    expect(result!.postSales).toBe(125); // avg of 100, 150
  });

  it("should detect negative impact (sales dropped)", () => {
    const salesData = generateSalesData([200, 200, 100, 50, 50]);
    const event: EventLog = {
      id: "1",
      topic: "products/update",
      diff: JSON.stringify({ changes: [{ field: "price", old: "10", new: "20" }] }),
      timestamp: new Date(baseTime + 2 * HOUR_MS),
    };

    const result = calculateImpactAnalysis(event, salesData, HOUR_MS);

    expect(result).not.toBeNull();
    expect(result!.isNegative).toBe(true);
    expect(result!.baselineSales).toBe(200);
    expect(result!.postSales).toBe(50);
  });
});

describe("getItemName", () => {
  describe("order messages", () => {
    it("should extract order number and amount", () => {
      expect(getItemName("💰 Order #1001 - $100.00", "orders/paid")).toBe(
        "#1001 ($100.00)"
      );
      expect(getItemName("💰 Order #2345 - $1,234.56", "ORDERS_CREATE")).toBe(
        "#2345 ($1,234.56)"
      );
    });

    it("should fallback to just order number", () => {
      expect(getItemName("Order #1001 processed", "orders/paid")).toBe("#1001");
    });

    it("should return 'Order' when no number found", () => {
      expect(getItemName("New order received", "orders/paid")).toBe("Order");
    });
  });

  describe("product/collection messages", () => {
    it("should extract quoted text", () => {
      expect(getItemName('Product "Cool Widget" updated', "products/update")).toBe(
        "Cool Widget"
      );
      expect(
        getItemName('Collection "Summer Sale" created', "collections/create")
      ).toBe("Summer Sale");
    });

    it("should return Unknown when no quotes found", () => {
      expect(getItemName("Product updated", "products/update")).toBe("Unknown");
    });
  });
});

describe("getAction", () => {
  it("should return 'placed' for orders", () => {
    expect(getAction("", "orders/paid")).toBe("placed");
    expect(getAction("", "ORDERS_CREATE")).toBe("placed");
  });

  it("should return 'deleted' for delete events", () => {
    expect(getAction("", "products/delete")).toBe("deleted");
    expect(getAction("", "collections/delete")).toBe("deleted");
  });

  it("should return 'created' for create events", () => {
    expect(getAction("", "products/create")).toBe("created");
    expect(getAction("", "collections/create")).toBe("created");
  });

  it("should return 'updated' for update events", () => {
    expect(getAction("", "products/update")).toBe("updated");
    expect(getAction("", "collections/update")).toBe("updated");
  });
});

describe("getItemType", () => {
  it("should return 'order' for order topics", () => {
    expect(getItemType("orders/paid")).toBe("order");
    expect(getItemType("ORDERS_CREATE")).toBe("order");
  });

  it("should return 'collection' for collection topics", () => {
    expect(getItemType("collections/create")).toBe("collection");
    expect(getItemType("collections/update")).toBe("collection");
  });

  it("should return 'inventory for' for inventory topics", () => {
    expect(getItemType("inventory/levels/update")).toBe("inventory for");
  });

  it("should return 'product' as default", () => {
    expect(getItemType("products/update")).toBe("product");
    expect(getItemType("unknown")).toBe("product");
  });
});
