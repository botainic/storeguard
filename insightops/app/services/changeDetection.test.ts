import { describe, it, expect } from "vitest";
import {
  calculatePriceImportance,
  isSignificantVisibilityTransition,
  getVisibilityImportance,
  shouldAlertInventoryZero,
  shouldAlertLowStock,
  formatVariantLabel,
} from "./changeDetection.utils";

describe("calculatePriceImportance", () => {
  it("should return 'high' for >=50% change", () => {
    expect(calculatePriceImportance(100, 50)).toBe("high");
    expect(calculatePriceImportance(100, 150)).toBe("high");
    expect(calculatePriceImportance(10, 5)).toBe("high");
    expect(calculatePriceImportance(20, 0)).toBe("high");
  });

  it("should return 'medium' for >=20% and <50% change", () => {
    expect(calculatePriceImportance(100, 75)).toBe("medium");
    expect(calculatePriceImportance(100, 125)).toBe("medium");
    expect(calculatePriceImportance(50, 40)).toBe("medium");
  });

  it("should return 'low' for <20% change", () => {
    expect(calculatePriceImportance(100, 90)).toBe("low");
    expect(calculatePriceImportance(100, 110)).toBe("low");
    expect(calculatePriceImportance(50, 45)).toBe("low");
  });

  it("should return 'high' when old price is zero", () => {
    expect(calculatePriceImportance(0, 10)).toBe("high");
  });

  it("should handle string inputs correctly", () => {
    expect(calculatePriceImportance("100.00", "50.00")).toBe("high");
    expect(calculatePriceImportance("100.00", "90.00")).toBe("low");
  });
});

describe("isSignificantVisibilityTransition", () => {
  it("should return true for active -> draft", () => {
    expect(isSignificantVisibilityTransition("active", "draft")).toBe(true);
  });

  it("should return true for active -> archived", () => {
    expect(isSignificantVisibilityTransition("active", "archived")).toBe(true);
  });

  it("should return true for draft -> active", () => {
    expect(isSignificantVisibilityTransition("draft", "active")).toBe(true);
  });

  it("should return true for archived -> active", () => {
    expect(isSignificantVisibilityTransition("archived", "active")).toBe(true);
  });

  it("should return false for draft -> archived", () => {
    expect(isSignificantVisibilityTransition("draft", "archived")).toBe(false);
  });

  it("should return false for archived -> draft", () => {
    expect(isSignificantVisibilityTransition("archived", "draft")).toBe(false);
  });

  it("should return false for same status", () => {
    expect(isSignificantVisibilityTransition("active", "active")).toBe(false);
    expect(isSignificantVisibilityTransition("draft", "draft")).toBe(false);
  });
});

describe("getVisibilityImportance", () => {
  it("should return 'high' when product becomes hidden", () => {
    expect(getVisibilityImportance("draft")).toBe("high");
    expect(getVisibilityImportance("archived")).toBe("high");
  });

  it("should return 'medium' when product becomes visible", () => {
    expect(getVisibilityImportance("active")).toBe("medium");
  });
});

describe("shouldAlertInventoryZero", () => {
  it("should return true for >0 to 0 transition", () => {
    expect(shouldAlertInventoryZero(0, 5)).toBe(true);
    expect(shouldAlertInventoryZero(0, 1)).toBe(true);
    expect(shouldAlertInventoryZero(0, 100)).toBe(true);
  });

  it("should return false when new quantity is not zero", () => {
    expect(shouldAlertInventoryZero(1, 5)).toBe(false);
    expect(shouldAlertInventoryZero(10, 20)).toBe(false);
  });

  it("should return false for 0 to 0 (no change)", () => {
    expect(shouldAlertInventoryZero(0, 0)).toBe(false);
  });

  it("should return false for negative to 0", () => {
    expect(shouldAlertInventoryZero(0, -1)).toBe(false);
    expect(shouldAlertInventoryZero(0, -5)).toBe(false);
  });

  it("should return false when previous quantity is null", () => {
    expect(shouldAlertInventoryZero(0, null)).toBe(false);
  });
});

describe("shouldAlertLowStock", () => {
  it("should return true when crossing threshold from above to below", () => {
    expect(shouldAlertLowStock(3, 10, 5)).toBe(true);
    expect(shouldAlertLowStock(5, 10, 5)).toBe(true);
    expect(shouldAlertLowStock(1, 6, 5)).toBe(true);
  });

  it("should return false when already below threshold", () => {
    expect(shouldAlertLowStock(2, 3, 5)).toBe(false);
  });

  it("should return false when still above threshold", () => {
    expect(shouldAlertLowStock(10, 20, 5)).toBe(false);
  });

  it("should return false when new quantity is zero (handled by inventory_zero)", () => {
    expect(shouldAlertLowStock(0, 10, 5)).toBe(false);
  });

  it("should return false when previous quantity is null", () => {
    expect(shouldAlertLowStock(3, null, 5)).toBe(false);
  });

  it("should handle threshold of 1", () => {
    expect(shouldAlertLowStock(1, 5, 1)).toBe(true);
    expect(shouldAlertLowStock(2, 5, 1)).toBe(false);
  });
});

describe("formatVariantLabel", () => {
  it("should return product title for Default Title variant", () => {
    expect(formatVariantLabel("Blue T-Shirt", "Default Title")).toBe(
      "Blue T-Shirt"
    );
  });

  it("should combine product and variant titles", () => {
    expect(formatVariantLabel("T-Shirt", "Large")).toBe("T-Shirt - Large");
    expect(formatVariantLabel("Hoodie", "Red / XL")).toBe("Hoodie - Red / XL");
  });

  it("should return product title for empty variant title", () => {
    expect(formatVariantLabel("Widget", "")).toBe("Widget");
  });

  it("should return product title for null variant title", () => {
    expect(formatVariantLabel("Widget", null)).toBe("Widget");
  });
});
