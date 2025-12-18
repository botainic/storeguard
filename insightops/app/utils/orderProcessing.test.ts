import { describe, it, expect } from "vitest";
import {
  calculateItemCount,
  generateItemSummary,
  formatAmount,
  generateOrderMessage,
  buildOrderDiff,
  processOrderPayload,
  type LineItem,
  type OrderPayload,
} from "./orderProcessing";

describe("calculateItemCount", () => {
  it("should sum quantities from all line items", () => {
    const items: LineItem[] = [
      { title: "Widget", quantity: 2, price: "10.00", variant_title: null, product_id: 1 },
      { title: "Gadget", quantity: 3, price: "20.00", variant_title: null, product_id: 2 },
    ];
    expect(calculateItemCount(items)).toBe(5);
  });

  it("should return 0 for empty line items", () => {
    expect(calculateItemCount([])).toBe(0);
  });

  it("should handle single item", () => {
    const items: LineItem[] = [
      { title: "Widget", quantity: 1, price: "10.00", variant_title: null, product_id: 1 },
    ];
    expect(calculateItemCount(items)).toBe(1);
  });
});

describe("generateItemSummary", () => {
  it("should return product title for single item order", () => {
    const items: LineItem[] = [
      { title: "Cool Widget", quantity: 1, price: "10.00", variant_title: null, product_id: 1 },
    ];
    expect(generateItemSummary(items)).toBe("Cool Widget");
  });

  it("should return count for multiple items", () => {
    const items: LineItem[] = [
      { title: "Widget", quantity: 2, price: "10.00", variant_title: null, product_id: 1 },
      { title: "Gadget", quantity: 3, price: "20.00", variant_title: null, product_id: 2 },
    ];
    expect(generateItemSummary(items)).toBe("5 items");
  });

  it("should return '0 items' for empty order", () => {
    expect(generateItemSummary([])).toBe("0 items");
  });

  it("should return count even if single line item has quantity > 1", () => {
    const items: LineItem[] = [
      { title: "Widget", quantity: 3, price: "10.00", variant_title: null, product_id: 1 },
    ];
    expect(generateItemSummary(items)).toBe("3 items");
  });
});

describe("formatAmount", () => {
  it("should format USD amounts", () => {
    expect(formatAmount("100.00", "USD")).toBe("$100.00");
    expect(formatAmount("1234.56", "USD")).toBe("$1,234.56");
  });

  it("should format EUR amounts", () => {
    const result = formatAmount("100.00", "EUR");
    expect(result).toContain("100");
    expect(result).toContain("€");
  });

  it("should format GBP amounts", () => {
    const result = formatAmount("100.00", "GBP");
    expect(result).toContain("100");
    expect(result).toContain("£");
  });

  it("should default to USD for empty currency", () => {
    expect(formatAmount("50.00", "")).toBe("$50.00");
  });

  it("should handle decimal precision", () => {
    expect(formatAmount("99.99", "USD")).toBe("$99.99");
    expect(formatAmount("100", "USD")).toBe("$100.00");
  });
});

describe("generateOrderMessage", () => {
  it("should create message with order name and amount", () => {
    expect(generateOrderMessage("#1001", "$100.00")).toBe("💰 Order #1001 - $100.00");
  });

  it("should handle large amounts with formatting", () => {
    expect(generateOrderMessage("#2345", "$1,234.56")).toBe(
      "💰 Order #2345 - $1,234.56"
    );
  });
});

describe("buildOrderDiff", () => {
  it("should create valid JSON with all order details", () => {
    const order: OrderPayload = {
      id: 12345,
      name: "#1001",
      total_price: "100.00",
      subtotal_price: "95.00",
      currency: "USD",
      financial_status: "paid",
      created_at: "2024-01-15T10:00:00Z",
      line_items: [
        {
          title: "Widget",
          quantity: 2,
          price: "47.50",
          variant_title: "Large",
          product_id: 111,
        },
      ],
      discount_codes: [{ code: "SAVE10", amount: "5.00" }],
    };

    const diff = buildOrderDiff(order, 2, "2 items");
    const parsed = JSON.parse(diff);

    expect(parsed.orderId).toBe(12345);
    expect(parsed.orderName).toBe("#1001");
    expect(parsed.total).toBe("100.00");
    expect(parsed.subtotal).toBe("95.00");
    expect(parsed.currency).toBe("USD");
    expect(parsed.status).toBe("paid");
    expect(parsed.itemCount).toBe(2);
    expect(parsed.itemSummary).toBe("2 items");
    expect(parsed.items).toHaveLength(1);
    expect(parsed.items[0].title).toBe("Widget");
    expect(parsed.items[0].variant).toBe("Large");
    expect(parsed.items[0].productId).toBe(111);
    expect(parsed.discounts).toHaveLength(1);
    expect(parsed.discounts[0].code).toBe("SAVE10");
  });

  it("should handle orders with no discounts", () => {
    const order: OrderPayload = {
      id: 1,
      name: "#1",
      total_price: "10.00",
      subtotal_price: "10.00",
      currency: "USD",
      financial_status: "paid",
      created_at: "2024-01-15T10:00:00Z",
      line_items: [],
      discount_codes: [],
    };

    const diff = buildOrderDiff(order, 0, "items");
    const parsed = JSON.parse(diff);

    expect(parsed.discounts).toEqual([]);
    expect(parsed.items).toEqual([]);
  });
});

describe("processOrderPayload", () => {
  it("should process a complete order payload", () => {
    const order: OrderPayload = {
      id: 98765,
      name: "#1234",
      total_price: "299.99",
      subtotal_price: "279.99",
      currency: "USD",
      financial_status: "paid",
      created_at: "2024-01-15T14:30:00Z",
      line_items: [
        {
          title: "Premium Widget",
          quantity: 1,
          price: "199.99",
          variant_title: "Blue",
          product_id: 555,
        },
        {
          title: "Widget Case",
          quantity: 2,
          price: "40.00",
          variant_title: null,
          product_id: 556,
        },
      ],
      discount_codes: [{ code: "BUNDLE20", amount: "20.00" }],
    };

    const result = processOrderPayload(order);

    expect(result.shopifyId).toBe("98765");
    expect(result.itemCount).toBe(3);
    expect(result.itemSummary).toBe("3 items");
    expect(result.formattedAmount).toBe("$299.99");
    expect(result.message).toBe("💰 Order #1234 - $299.99");

    const diffParsed = JSON.parse(result.diff);
    expect(diffParsed.orderId).toBe(98765);
    expect(diffParsed.items).toHaveLength(2);
  });

  it("should handle single item order", () => {
    const order: OrderPayload = {
      id: 111,
      name: "#5",
      total_price: "25.00",
      subtotal_price: "25.00",
      currency: "USD",
      financial_status: "paid",
      created_at: "2024-01-15T09:00:00Z",
      line_items: [
        {
          title: "Small Gadget",
          quantity: 1,
          price: "25.00",
          variant_title: null,
          product_id: 999,
        },
      ],
      discount_codes: [],
    };

    const result = processOrderPayload(order);

    expect(result.itemCount).toBe(1);
    expect(result.itemSummary).toBe("Small Gadget");
    expect(result.message).toBe("💰 Order #5 - $25.00");
  });

  it("should handle international currency", () => {
    const order: OrderPayload = {
      id: 222,
      name: "#10",
      total_price: "50.00",
      subtotal_price: "50.00",
      currency: "GBP",
      financial_status: "paid",
      created_at: "2024-01-15T12:00:00Z",
      line_items: [
        {
          title: "UK Widget",
          quantity: 1,
          price: "50.00",
          variant_title: null,
          product_id: 888,
        },
      ],
      discount_codes: [],
    };

    const result = processOrderPayload(order);

    expect(result.formattedAmount).toContain("£");
    expect(result.formattedAmount).toContain("50");
  });
});
