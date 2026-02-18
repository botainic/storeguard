import { describe, it, expect } from "vitest";
import {
  getEventIdsFromDigest,
  formatEventType,
  formatEventForEmail,
  type DigestEvent,
  type DigestSummary,
} from "./dailyDigest.server";

function makeEvent(overrides: Partial<DigestEvent> = {}): DigestEvent {
  return {
    id: "evt-1",
    entityType: "variant",
    entityId: "123",
    eventType: "price_change",
    resourceName: "Blue T-Shirt",
    beforeValue: "$20.00",
    afterValue: "$15.00",
    detectedAt: new Date("2026-02-17T10:30:00Z"),
    importance: "medium",
    contextData: null,
    ...overrides,
  };
}

function makeDigest(overrides: Partial<DigestSummary> = {}): DigestSummary {
  return {
    shop: "test-store.myshopify.com",
    alertEmail: "owner@test.com",
    generatedAt: new Date(),
    periodStart: new Date(Date.now() - 24 * 60 * 60 * 1000),
    periodEnd: new Date(),
    totalChanges: 0,
    highPriorityCount: 0,
    eventsByType: {
      price_change: [],
      visibility_change: [],
      inventory_low: [],
      inventory_zero: [],
      theme_publish: [],
    },
    ...overrides,
  };
}

describe("getEventIdsFromDigest", () => {
  it("should return empty array for digest with no events", () => {
    const digest = makeDigest();
    expect(getEventIdsFromDigest(digest)).toEqual([]);
  });

  it("should collect IDs from all event types", () => {
    const digest = makeDigest({
      eventsByType: {
        price_change: [makeEvent({ id: "pc-1" }), makeEvent({ id: "pc-2" })],
        visibility_change: [makeEvent({ id: "vc-1" })],
        inventory_low: [],
        inventory_zero: [makeEvent({ id: "iz-1" })],
        theme_publish: [makeEvent({ id: "tp-1" })],
      },
    });

    const ids = getEventIdsFromDigest(digest);
    expect(ids).toHaveLength(5);
    expect(ids).toContain("pc-1");
    expect(ids).toContain("pc-2");
    expect(ids).toContain("vc-1");
    expect(ids).toContain("iz-1");
    expect(ids).toContain("tp-1");
  });

  it("should handle digest with events in only one category", () => {
    const digest = makeDigest({
      eventsByType: {
        price_change: [makeEvent({ id: "pc-1" })],
        visibility_change: [],
        inventory_low: [],
        inventory_zero: [],
        theme_publish: [],
      },
    });

    expect(getEventIdsFromDigest(digest)).toEqual(["pc-1"]);
  });
});

describe("formatEventType", () => {
  it("should format price_change", () => {
    expect(formatEventType("price_change")).toBe("Price Changes");
  });

  it("should format visibility_change", () => {
    expect(formatEventType("visibility_change")).toBe("Visibility Changes");
  });

  it("should format inventory_low", () => {
    expect(formatEventType("inventory_low")).toBe("Low Stock");
  });

  it("should format inventory_zero", () => {
    expect(formatEventType("inventory_zero")).toBe("Out of Stock");
  });

  it("should format theme_publish", () => {
    expect(formatEventType("theme_publish")).toBe("Theme Published");
  });

  it("should return raw event type for unknown types", () => {
    expect(formatEventType("unknown_event")).toBe("unknown_event");
  });
});

describe("formatEventForEmail", () => {
  it("should format price change event", () => {
    const event = makeEvent({
      eventType: "price_change",
      resourceName: "Blue T-Shirt - Large",
      beforeValue: "$20.00",
      afterValue: "$15.00",
    });

    const result = formatEventForEmail(event);
    expect(result).toContain("Blue T-Shirt - Large");
    expect(result).toContain("$20.00");
    expect(result).toContain("$15.00");
    expect(result).toContain("→");
  });

  it("should format visibility change event", () => {
    const event = makeEvent({
      eventType: "visibility_change",
      entityType: "product",
      resourceName: "Summer Hoodie",
      beforeValue: "active",
      afterValue: "draft",
    });

    const result = formatEventForEmail(event);
    expect(result).toContain("Summer Hoodie");
    expect(result).toContain("active");
    expect(result).toContain("draft");
  });

  it("should format inventory zero event", () => {
    const event = makeEvent({
      eventType: "inventory_zero",
      resourceName: "Widget - Red",
      beforeValue: "5",
      afterValue: "0",
    });

    const result = formatEventForEmail(event);
    expect(result).toContain("Widget - Red");
    expect(result).toContain("out of stock");
    expect(result).toContain("5");
  });

  it("should format inventory low event", () => {
    const event = makeEvent({
      eventType: "inventory_low",
      resourceName: "Gadget",
      beforeValue: "10",
      afterValue: "3",
    });

    const result = formatEventForEmail(event);
    expect(result).toContain("Gadget");
    expect(result).toContain("3");
    expect(result).toContain("10");
  });

  it("should format theme publish event", () => {
    const event = makeEvent({
      eventType: "theme_publish",
      entityType: "theme",
      resourceName: "Dawn 2.0",
      beforeValue: null,
      afterValue: "main",
    });

    const result = formatEventForEmail(event);
    expect(result).toContain("Dawn 2.0");
    expect(result).toContain("live theme");
  });
});
