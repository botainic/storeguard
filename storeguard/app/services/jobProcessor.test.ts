import { describe, it, expect } from "vitest";
import {
  aggregateInventoryLevels,
  type InventoryLevelNode,
} from "./changeDetection.utils";

describe("aggregateInventoryLevels", () => {
  it("should sum quantities across all locations", () => {
    const nodes: InventoryLevelNode[] = [
      { quantities: [{ quantity: 10 }], location: { id: "gid://shopify/Location/1", name: "Warehouse A" } },
      { quantities: [{ quantity: 20 }], location: { id: "gid://shopify/Location/2", name: "Warehouse B" } },
      { quantities: [{ quantity: 5 }], location: { id: "gid://shopify/Location/3", name: "Retail Store" } },
    ];

    const result = aggregateInventoryLevels(nodes, 2);
    expect(result.totalQuantity).toBe(35);
    expect(result.locationName).toBe("Warehouse B");
  });

  it("should return zero for empty nodes array", () => {
    const result = aggregateInventoryLevels([], 1);
    expect(result.totalQuantity).toBe(0);
    expect(result.locationName).toBeNull();
  });

  it("should handle null location gracefully", () => {
    const nodes: InventoryLevelNode[] = [
      { quantities: [{ quantity: 7 }], location: null },
      { quantities: [{ quantity: 3 }], location: { id: "gid://shopify/Location/5", name: "Main" } },
    ];

    const result = aggregateInventoryLevels(nodes, 5);
    expect(result.totalQuantity).toBe(10);
    expect(result.locationName).toBe("Main");
  });

  it("should return null locationName when trigger location not found", () => {
    const nodes: InventoryLevelNode[] = [
      { quantities: [{ quantity: 10 }], location: { id: "gid://shopify/Location/1", name: "Warehouse A" } },
    ];

    const result = aggregateInventoryLevels(nodes, 999);
    expect(result.totalQuantity).toBe(10);
    expect(result.locationName).toBeNull();
  });

  it("should handle missing quantities array", () => {
    const nodes: InventoryLevelNode[] = [
      { quantities: [], location: { id: "gid://shopify/Location/1", name: "W1" } },
      { quantities: [{ quantity: 15 }], location: { id: "gid://shopify/Location/2", name: "W2" } },
    ];

    const result = aggregateInventoryLevels(nodes, 1);
    expect(result.totalQuantity).toBe(15);
    expect(result.locationName).toBe("W1");
  });

  it("should handle many locations (>50 simulating paginated results)", () => {
    const nodes: InventoryLevelNode[] = [];
    for (let i = 1; i <= 120; i++) {
      nodes.push({
        quantities: [{ quantity: 1 }],
        location: { id: `gid://shopify/Location/${i}`, name: `Location ${i}` },
      });
    }

    const result = aggregateInventoryLevels(nodes, 75);
    expect(result.totalQuantity).toBe(120);
    expect(result.locationName).toBe("Location 75");
  });

  it("should handle negative quantities", () => {
    const nodes: InventoryLevelNode[] = [
      { quantities: [{ quantity: -2 }], location: { id: "gid://shopify/Location/1", name: "Returns" } },
      { quantities: [{ quantity: 10 }], location: { id: "gid://shopify/Location/2", name: "Warehouse" } },
    ];

    const result = aggregateInventoryLevels(nodes, 1);
    expect(result.totalQuantity).toBe(8);
    expect(result.locationName).toBe("Returns");
  });

  it("should handle zero quantities at all locations", () => {
    const nodes: InventoryLevelNode[] = [
      { quantities: [{ quantity: 0 }], location: { id: "gid://shopify/Location/1", name: "W1" } },
      { quantities: [{ quantity: 0 }], location: { id: "gid://shopify/Location/2", name: "W2" } },
    ];

    const result = aggregateInventoryLevels(nodes, 1);
    expect(result.totalQuantity).toBe(0);
    expect(result.locationName).toBe("W1");
  });
});
