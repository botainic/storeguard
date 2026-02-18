import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { LineItemNode } from "./salesVelocity.server";

// Mock db.server before importing the module under test
vi.mock("../db.server", () => ({
  default: {
    session: {
      findFirst: vi.fn(),
    },
  },
}));

// Mock shopify.server
vi.mock("../shopify.server", () => ({
  apiVersion: "2025-10",
}));

import db from "../db.server";
import {
  getShopSalesVelocity,
  clearVelocityCache,
  extractId,
  parseLineItemNodes,
} from "./salesVelocity.server";

const SHOP = "test-shop.myshopify.com";

function makeLineItemNode(
  productId: string,
  variantId: string,
  quantity: number,
  amount: string
): { node: LineItemNode } {
  return {
    node: {
      product: { id: `gid://shopify/Product/${productId}` },
      variant: { id: `gid://shopify/ProductVariant/${variantId}` },
      quantity,
      originalUnitPriceSet: { shopMoney: { amount } },
    },
  };
}

function makeOrdersResponse(
  orders: Array<{
    id: string;
    lineItems: Array<{ node: LineItemNode }>;
    hasMoreLineItems?: boolean;
    lineItemEndCursor?: string;
  }>,
  hasNextPage = false,
  endCursor: string | null = null
) {
  return {
    data: {
      orders: {
        edges: orders.map((o) => ({
          node: {
            id: o.id,
            createdAt: "2026-02-15T10:00:00Z",
            lineItems: {
              edges: o.lineItems,
              pageInfo: {
                hasNextPage: o.hasMoreLineItems ?? false,
                endCursor: o.lineItemEndCursor ?? null,
              },
            },
          },
        })),
        pageInfo: { hasNextPage, endCursor },
      },
    },
  };
}

function makeOrderLineItemsResponse(
  lineItems: Array<{ node: LineItemNode }>,
  hasNextPage = false,
  endCursor: string | null = null
) {
  return {
    data: {
      order: {
        lineItems: {
          edges: lineItems,
          pageInfo: { hasNextPage, endCursor },
        },
      },
    },
  };
}

describe("fetchOrders line item pagination", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    clearVelocityCache();
    vi.mocked(db.session.findFirst).mockResolvedValue({
      id: "session-1",
      shop: SHOP,
      state: "active",
      isOnline: false,
      scope: "read_products",
      expires: null,
      accessToken: "test-token",
      userId: null,
      firstName: null,
      lastName: null,
      email: null,
      accountOwner: false,
      locale: null,
      collaborator: null,
      emailVerified: null,
    });
    fetchSpy = vi.spyOn(globalThis, "fetch");
    consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should fetch all line items when under 50 per order", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify(
          makeOrdersResponse([
            {
              id: "gid://shopify/Order/1",
              lineItems: [
                makeLineItemNode("100", "200", 2, "50.00"),
                makeLineItemNode("101", "201", 1, "25.00"),
              ],
            },
          ])
        ),
        { status: 200 }
      )
    );

    const result = await getShopSalesVelocity(SHOP, 30);

    expect(result.size).toBe(2);
    expect(result.get("100")?.totalUnitsSold).toBe(2);
    expect(result.get("101")?.totalUnitsSold).toBe(1);
    // Only one fetch call needed (no line item pagination)
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("should paginate line items when order has more than 50", async () => {
    // First call: orders query with truncated line items
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify(
          makeOrdersResponse([
            {
              id: "gid://shopify/Order/1",
              lineItems: [makeLineItemNode("100", "200", 2, "50.00")],
              hasMoreLineItems: true,
              lineItemEndCursor: "li-cursor-1",
            },
          ])
        ),
        { status: 200 }
      )
    );

    // Second call: additional line items for the order
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify(
          makeOrderLineItemsResponse([
            makeLineItemNode("101", "201", 3, "30.00"),
          ])
        ),
        { status: 200 }
      )
    );

    const result = await getShopSalesVelocity(SHOP, 30);

    expect(result.size).toBe(2);
    expect(result.get("100")?.totalUnitsSold).toBe(2);
    expect(result.get("101")?.totalUnitsSold).toBe(3);
    // Two fetch calls: orders + additional line items
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("should log warning when line items are paginated", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify(
          makeOrdersResponse([
            {
              id: "gid://shopify/Order/1",
              lineItems: [makeLineItemNode("100", "200", 1, "10.00")],
              hasMoreLineItems: true,
              lineItemEndCursor: "li-cursor-1",
            },
          ])
        ),
        { status: 200 }
      )
    );

    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify(
          makeOrderLineItemsResponse([
            makeLineItemNode("101", "201", 1, "10.00"),
          ])
        ),
        { status: 200 }
      )
    );

    await getShopSalesVelocity(SHOP, 30);

    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining("more than 50 line items")
    );
  });

  it("should paginate through multiple pages of line items", async () => {
    // Orders response with truncated line items
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify(
          makeOrdersResponse([
            {
              id: "gid://shopify/Order/1",
              lineItems: [makeLineItemNode("100", "200", 1, "10.00")],
              hasMoreLineItems: true,
              lineItemEndCursor: "li-cursor-1",
            },
          ])
        ),
        { status: 200 }
      )
    );

    // First line items page - has another page
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify(
          makeOrderLineItemsResponse(
            [makeLineItemNode("101", "201", 2, "20.00")],
            true,
            "li-cursor-2"
          )
        ),
        { status: 200 }
      )
    );

    // Second line items page - last page
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify(
          makeOrderLineItemsResponse([
            makeLineItemNode("102", "202", 3, "30.00"),
          ])
        ),
        { status: 200 }
      )
    );

    const result = await getShopSalesVelocity(SHOP, 30);

    expect(result.size).toBe(3);
    expect(result.get("100")?.totalUnitsSold).toBe(1);
    expect(result.get("101")?.totalUnitsSold).toBe(2);
    expect(result.get("102")?.totalUnitsSold).toBe(3);
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it("should handle line item fetch errors gracefully", async () => {
    // Orders response with truncated line items
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify(
          makeOrdersResponse([
            {
              id: "gid://shopify/Order/1",
              lineItems: [makeLineItemNode("100", "200", 1, "10.00")],
              hasMoreLineItems: true,
              lineItemEndCursor: "li-cursor-1",
            },
          ])
        ),
        { status: 200 }
      )
    );

    // Line items fetch fails
    fetchSpy.mockResolvedValueOnce(
      new Response("Internal Server Error", { status: 500 })
    );

    const result = await getShopSalesVelocity(SHOP, 30);

    // Should still have the first page of line items
    expect(result.size).toBe(1);
    expect(result.get("100")?.totalUnitsSold).toBe(1);
  });

  it("should pass correct orderId GID in line items pagination query", async () => {
    const orderId = "gid://shopify/Order/12345";

    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify(
          makeOrdersResponse([
            {
              id: orderId,
              lineItems: [makeLineItemNode("100", "200", 1, "10.00")],
              hasMoreLineItems: true,
              lineItemEndCursor: "li-cursor-1",
            },
          ])
        ),
        { status: 200 }
      )
    );

    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify(
          makeOrderLineItemsResponse([
            makeLineItemNode("101", "201", 1, "10.00"),
          ])
        ),
        { status: 200 }
      )
    );

    await getShopSalesVelocity(SHOP, 30);

    // Second call should be the line items query with the correct order GID
    const secondCallBody = JSON.parse(
      fetchSpy.mock.calls[1][1]?.body as string
    );
    expect(secondCallBody.variables.orderId).toBe(orderId);
    expect(secondCallBody.variables.cursor).toBe("li-cursor-1");
  });

  it("should handle orders with no additional line item pages needed", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify(
          makeOrdersResponse([
            {
              id: "gid://shopify/Order/1",
              lineItems: [
                makeLineItemNode("100", "200", 1, "10.00"),
                makeLineItemNode("101", "201", 2, "20.00"),
              ],
              hasMoreLineItems: false,
              lineItemEndCursor: undefined,
            },
          ])
        ),
        { status: 200 }
      )
    );

    const result = await getShopSalesVelocity(SHOP, 30);

    expect(result.size).toBe(2);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(consoleWarnSpy).not.toHaveBeenCalledWith(
      expect.stringContaining("more than 50 line items")
    );
  });
});

describe("extractId", () => {
  it("should extract numeric ID from Shopify GID", () => {
    expect(extractId("gid://shopify/Product/12345")).toBe("12345");
    expect(extractId("gid://shopify/Order/67890")).toBe("67890");
    expect(extractId("gid://shopify/ProductVariant/111")).toBe("111");
  });

  it("should return empty string for null/undefined", () => {
    expect(extractId(null)).toBe("");
    expect(extractId(undefined)).toBe("");
  });

  it("should return empty string for malformed GIDs", () => {
    expect(extractId("")).toBe("");
    expect(extractId("not-a-gid")).toBe("");
    expect(extractId("gid://shopify/Product/")).toBe("");
  });
});

describe("parseLineItemNodes", () => {
  const makeNode = (
    productId: string,
    variantId: string,
    quantity: number,
    amount: string
  ): LineItemNode => ({
    product: { id: `gid://shopify/Product/${productId}` },
    variant: { id: `gid://shopify/ProductVariant/${variantId}` },
    quantity,
    originalUnitPriceSet: { shopMoney: { amount } },
  });

  it("should parse valid line item nodes", () => {
    const nodes: LineItemNode[] = [
      makeNode("100", "200", 2, "50.00"),
      makeNode("101", "201", 1, "25.50"),
    ];

    const result = parseLineItemNodes(nodes);

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      productId: "100",
      variantId: "200",
      quantity: 2,
      price: 50,
    });
    expect(result[1]).toEqual({
      productId: "101",
      variantId: "201",
      quantity: 1,
      price: 25.5,
    });
  });

  it("should filter out nodes with null product", () => {
    const nodes: LineItemNode[] = [
      { product: null, variant: { id: "gid://shopify/ProductVariant/200" }, quantity: 1, originalUnitPriceSet: { shopMoney: { amount: "10.00" } } },
      makeNode("100", "200", 1, "50.00"),
    ];

    const result = parseLineItemNodes(nodes);
    expect(result).toHaveLength(1);
    expect(result[0].productId).toBe("100");
  });

  it("should handle null price gracefully", () => {
    const node: LineItemNode = {
      product: { id: "gid://shopify/Product/100" },
      variant: { id: "gid://shopify/ProductVariant/200" },
      quantity: 3,
      originalUnitPriceSet: null,
    };

    const result = parseLineItemNodes([node]);
    expect(result).toHaveLength(1);
    expect(result[0].price).toBe(0);
  });

  it("should return empty array for empty input", () => {
    expect(parseLineItemNodes([])).toEqual([]);
  });

  it("should handle large batches of nodes", () => {
    const nodes: LineItemNode[] = Array.from({ length: 100 }, (_, i) =>
      makeNode(String(i), String(i + 1000), 1, "10.00")
    );

    const result = parseLineItemNodes(nodes);
    expect(result).toHaveLength(100);
  });
});
