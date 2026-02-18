import { describe, it, expect } from "vitest";
import {
  normalizeTopic,
  isHandledTopic,
  getTopicCategory,
  diffScopes,
  getTopicVerb,
  HANDLED_TOPICS,
} from "./jobProcessor.utils";

describe("normalizeTopic", () => {
  it("should lowercase and replace underscores with slashes", () => {
    expect(normalizeTopic("PRODUCTS_UPDATE")).toBe("products/update");
    expect(normalizeTopic("PRODUCTS_CREATE")).toBe("products/create");
    expect(normalizeTopic("PRODUCTS_DELETE")).toBe("products/delete");
  });

  it("should handle inventory_levels topic", () => {
    expect(normalizeTopic("inventory_levels/update")).toBe("inventory/levels/update");
    expect(normalizeTopic("INVENTORY_LEVELS_UPDATE")).toBe("inventory/levels/update");
  });

  it("should handle themes/publish", () => {
    expect(normalizeTopic("themes/publish")).toBe("themes/publish");
    expect(normalizeTopic("THEMES_PUBLISH")).toBe("themes/publish");
  });

  it("should handle domain topics", () => {
    expect(normalizeTopic("domains/create")).toBe("domains/create");
    expect(normalizeTopic("domains/update")).toBe("domains/update");
    expect(normalizeTopic("domains/destroy")).toBe("domains/destroy");
    expect(normalizeTopic("DOMAINS_CREATE")).toBe("domains/create");
    expect(normalizeTopic("DOMAINS_UPDATE")).toBe("domains/update");
    expect(normalizeTopic("DOMAINS_DESTROY")).toBe("domains/destroy");
  });

  it("should handle app/scopes_update", () => {
    expect(normalizeTopic("app/scopes_update")).toBe("app/scopes/update");
    expect(normalizeTopic("APP_SCOPES_UPDATE")).toBe("app/scopes/update");
  });

  it("should handle discount topics", () => {
    expect(normalizeTopic("discounts/create")).toBe("discounts/create");
    expect(normalizeTopic("discounts/update")).toBe("discounts/update");
    expect(normalizeTopic("discounts/delete")).toBe("discounts/delete");
    expect(normalizeTopic("DISCOUNTS_CREATE")).toBe("discounts/create");
  });

  it("should handle collection topics", () => {
    expect(normalizeTopic("collections/create")).toBe("collections/create");
    expect(normalizeTopic("collections/update")).toBe("collections/update");
    expect(normalizeTopic("collections/delete")).toBe("collections/delete");
    expect(normalizeTopic("COLLECTIONS_DELETE")).toBe("collections/delete");
  });

  it("should be idempotent on already-normalized topics", () => {
    for (const topic of HANDLED_TOPICS) {
      expect(normalizeTopic(topic)).toBe(topic);
    }
  });
});

describe("isHandledTopic", () => {
  it("should return true for all handled topics", () => {
    for (const topic of HANDLED_TOPICS) {
      expect(isHandledTopic(topic)).toBe(true);
    }
  });

  it("should return false for unknown topics", () => {
    expect(isHandledTopic("orders/create")).toBe(false);
    expect(isHandledTopic("customers/update")).toBe(false);
    expect(isHandledTopic("app/uninstalled")).toBe(false);
    expect(isHandledTopic("")).toBe(false);
    expect(isHandledTopic("foo/bar")).toBe(false);
  });

  it("should return false for unnormalized topics", () => {
    expect(isHandledTopic("PRODUCTS_UPDATE")).toBe(false);
    expect(isHandledTopic("THEMES_PUBLISH")).toBe(false);
  });
});

describe("getTopicCategory", () => {
  it("should categorize product topics", () => {
    expect(getTopicCategory("products/update")).toBe("product");
    expect(getTopicCategory("products/create")).toBe("product");
    expect(getTopicCategory("products/delete")).toBe("product");
  });

  it("should categorize collection topics", () => {
    expect(getTopicCategory("collections/create")).toBe("collection");
    expect(getTopicCategory("collections/update")).toBe("collection");
    expect(getTopicCategory("collections/delete")).toBe("collection");
  });

  it("should categorize inventory topics", () => {
    expect(getTopicCategory("inventory/levels/update")).toBe("inventory");
  });

  it("should categorize theme topics", () => {
    expect(getTopicCategory("themes/publish")).toBe("theme");
  });

  it("should categorize discount topics", () => {
    expect(getTopicCategory("discounts/create")).toBe("discount");
    expect(getTopicCategory("discounts/update")).toBe("discount");
    expect(getTopicCategory("discounts/delete")).toBe("discount");
  });

  it("should categorize domain topics", () => {
    expect(getTopicCategory("domains/create")).toBe("domain");
    expect(getTopicCategory("domains/update")).toBe("domain");
    expect(getTopicCategory("domains/destroy")).toBe("domain");
  });

  it("should categorize app scopes topic", () => {
    expect(getTopicCategory("app/scopes/update")).toBe("app_scopes");
  });

  it("should return unknown for unrecognized topics", () => {
    expect(getTopicCategory("orders/create")).toBe("unknown");
    expect(getTopicCategory("customers/update")).toBe("unknown");
    expect(getTopicCategory("")).toBe("unknown");
  });
});

describe("diffScopes", () => {
  it("should detect added scopes", () => {
    const result = diffScopes(
      ["read_products", "read_orders"],
      ["read_products", "read_orders", "read_customers"]
    );
    expect(result.added).toEqual(["read_customers"]);
    expect(result.removed).toEqual([]);
  });

  it("should detect removed scopes", () => {
    const result = diffScopes(
      ["read_products", "read_orders", "read_customers"],
      ["read_products", "read_orders"]
    );
    expect(result.added).toEqual([]);
    expect(result.removed).toEqual(["read_customers"]);
  });

  it("should detect both added and removed scopes", () => {
    const result = diffScopes(
      ["read_products", "read_orders"],
      ["read_products", "read_customers", "write_products"]
    );
    expect(result.added).toEqual(["read_customers", "write_products"]);
    expect(result.removed).toEqual(["read_orders"]);
  });

  it("should return empty arrays when scopes are identical", () => {
    const result = diffScopes(
      ["read_products", "read_orders"],
      ["read_products", "read_orders"]
    );
    expect(result.added).toEqual([]);
    expect(result.removed).toEqual([]);
  });

  it("should handle empty previous scopes (fresh install)", () => {
    const result = diffScopes(
      [],
      ["read_products", "read_orders"]
    );
    expect(result.added).toEqual(["read_products", "read_orders"]);
    expect(result.removed).toEqual([]);
  });

  it("should handle empty current scopes (all removed)", () => {
    const result = diffScopes(
      ["read_products", "read_orders"],
      []
    );
    expect(result.added).toEqual([]);
    expect(result.removed).toEqual(["read_products", "read_orders"]);
  });

  it("should handle both empty", () => {
    const result = diffScopes([], []);
    expect(result.added).toEqual([]);
    expect(result.removed).toEqual([]);
  });
});

describe("getTopicVerb", () => {
  it("should extract verb from topic", () => {
    expect(getTopicVerb("domains/create")).toBe("create");
    expect(getTopicVerb("domains/update")).toBe("update");
    expect(getTopicVerb("domains/destroy")).toBe("destroy");
    expect(getTopicVerb("discounts/create")).toBe("create");
    expect(getTopicVerb("discounts/delete")).toBe("delete");
    expect(getTopicVerb("collections/update")).toBe("update");
  });

  it("should handle multi-segment topics", () => {
    expect(getTopicVerb("inventory/levels/update")).toBe("update");
    expect(getTopicVerb("app/scopes/update")).toBe("update");
  });

  it("should handle single-segment topics", () => {
    expect(getTopicVerb("publish")).toBe("publish");
  });
});

describe("HANDLED_TOPICS completeness", () => {
  it("should include all V2 webhook topics that get queued", () => {
    // These are all topics from CLAUDE.md V2 section that go through the job processor
    // (app/uninstalled is handled directly, not queued)
    const expectedTopics = [
      "products/create",
      "products/update",
      "products/delete",
      "collections/create",
      "collections/update",
      "collections/delete",
      "inventory/levels/update",
      "themes/publish",
      "discounts/create",
      "discounts/update",
      "discounts/delete",
      "domains/create",
      "domains/update",
      "domains/destroy",
      "app/scopes/update",
    ];

    for (const topic of expectedTopics) {
      expect(
        HANDLED_TOPICS.includes(topic as typeof HANDLED_TOPICS[number]),
        `Missing topic: ${topic}`
      ).toBe(true);
    }
  });

  it("should not include app/uninstalled (handled directly)", () => {
    expect(
      (HANDLED_TOPICS as readonly string[]).includes("app/uninstalled")
    ).toBe(false);
  });
});
