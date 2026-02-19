import { describe, it, expect } from "vitest";
import {
  generateDigestEmailHtml,
  generateInstantAlertHtml,
  getInstantAlertSubject,
  buildInstantAlertDescription,
  formatDigestChangeDescription,
  getAlertColor,
  EVENT_TYPE_CONFIG,
  type InstantAlertEvent,
} from "./emailTemplates.server";
import type { DigestSummary, DigestEvent } from "./dailyDigest.server";

// ============================================
// HELPERS
// ============================================

function makeDigestEvent(overrides: Partial<DigestEvent> = {}): DigestEvent {
  return {
    id: "evt-1",
    entityType: "variant",
    entityId: "gid://shopify/ProductVariant/1",
    eventType: "price_change",
    resourceName: "Blue Jacket / M",
    beforeValue: "$89.00",
    afterValue: "$8.90",
    detectedAt: new Date("2026-02-18T14:30:00Z"),
    importance: "high",
    contextData: null,
    ...overrides,
  };
}

function makeDigest(overrides: Partial<DigestSummary> = {}): DigestSummary {
  return {
    shop: "test-store.myshopify.com",
    alertEmail: "owner@test-store.com",
    generatedAt: new Date("2026-02-18T15:00:00Z"),
    periodStart: new Date("2026-02-17T15:00:00Z"),
    periodEnd: new Date("2026-02-18T15:00:00Z"),
    totalChanges: 1,
    highPriorityCount: 0,
    eventsByType: {
      price_change: [makeDigestEvent()],
    },
    ...overrides,
  };
}

function makeInstantEvent(overrides: Partial<InstantAlertEvent> = {}): InstantAlertEvent {
  return {
    eventType: "price_change",
    resourceName: "Blue Jacket / M",
    beforeValue: "$89.00",
    afterValue: "$8.90",
    importance: "high",
    detectedAt: new Date("2026-02-18T14:30:00Z"),
    contextData: null,
    ...overrides,
  };
}

// ============================================
// DIGEST EMAIL HTML
// ============================================

describe("generateDigestEmailHtml", () => {
  it("produces valid XHTML transitional doctype", () => {
    const html = generateDigestEmailHtml(makeDigest());
    expect(html).toContain('<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN"');
    expect(html).toContain('xmlns="http://www.w3.org/1999/xhtml"');
  });

  it("includes charset and viewport meta tags", () => {
    const html = generateDigestEmailHtml(makeDigest());
    expect(html).toContain('http-equiv="Content-Type"');
    expect(html).toContain('content="text/html; charset=utf-8"');
    expect(html).toContain('name="viewport"');
    expect(html).toContain("width=device-width");
  });

  it("uses table-based layout (no flex/grid)", () => {
    const html = generateDigestEmailHtml(makeDigest());
    expect(html).not.toContain("display: flex");
    expect(html).not.toContain("display: grid");
    expect(html).toContain('role="presentation"');
  });

  it("uses inline styles only (no <style> blocks outside mso conditionals)", () => {
    const html = generateDigestEmailHtml(makeDigest());
    // Remove MSO conditional comments before checking
    const withoutMso = html.replace(/<!--\[if mso\]>[\s\S]*?<!\[endif\]-->/g, "");
    expect(withoutMso).not.toMatch(/<style[\s>]/);
  });

  it("sets min-width 320px on content table", () => {
    const html = generateDigestEmailHtml(makeDigest());
    expect(html).toContain("min-width: 320px");
  });

  it("sets max-width 600px on content table", () => {
    const html = generateDigestEmailHtml(makeDigest());
    expect(html).toContain("max-width: 600px");
  });

  it("uses 14px base font size", () => {
    const html = generateDigestEmailHtml(makeDigest());
    expect(html).toContain("font-size: 14px");
  });

  it("includes StoreGuard branding with shield", () => {
    const html = generateDigestEmailHtml(makeDigest());
    expect(html).toContain("StoreGuard");
    // Shield HTML entity
    expect(html).toContain("&#x1F6E1;");
  });

  it("includes shop name without myshopify.com", () => {
    const html = generateDigestEmailHtml(makeDigest());
    expect(html).toContain("test-store");
    expect(html).not.toContain("test-store.myshopify.com</");
  });

  it("includes total changes count", () => {
    const html = generateDigestEmailHtml(makeDigest({ totalChanges: 5 }));
    expect(html).toContain("5 Changes Detected");
  });

  it("shows singular 'Change' for 1 event", () => {
    const html = generateDigestEmailHtml(makeDigest({ totalChanges: 1 }));
    expect(html).toContain("1 Change Detected");
  });

  it("shows high priority badge when highPriorityCount > 0", () => {
    const html = generateDigestEmailHtml(makeDigest({ highPriorityCount: 3 }));
    expect(html).toContain("3 High Priority");
  });

  it("hides high priority badge when highPriorityCount is 0", () => {
    const html = generateDigestEmailHtml(makeDigest({ highPriorityCount: 0 }));
    expect(html).not.toContain("High Priority");
  });

  it("renders event sections with proper titles", () => {
    const html = generateDigestEmailHtml(makeDigest({
      eventsByType: {
        price_change: [makeDigestEvent()],
        inventory_zero: [makeDigestEvent({ eventType: "inventory_zero", importance: "high" })],
      },
    }));
    expect(html).toContain("Price Changes");
    expect(html).toContain("Cannot Be Purchased");
  });

  it("renders event sections in display order", () => {
    const html = generateDigestEmailHtml(makeDigest({
      eventsByType: {
        inventory_zero: [makeDigestEvent({ eventType: "inventory_zero" })],
        price_change: [makeDigestEvent()],
      },
    }));
    const priceIdx = html.indexOf("Price Changes");
    const stockIdx = html.indexOf("Cannot Be Purchased");
    expect(priceIdx).toBeLessThan(stockIdx);
  });

  it("renders resource names in event rows", () => {
    const html = generateDigestEmailHtml(makeDigest());
    expect(html).toContain("Blue Jacket / M");
  });

  it("shows high-priority dot for high importance events", () => {
    const html = generateDigestEmailHtml(makeDigest({
      eventsByType: {
        price_change: [makeDigestEvent({ importance: "high" })],
      },
    }));
    // Red dot background
    expect(html).toContain("background-color: #dc2626");
  });

  it("includes settings link in footer", () => {
    const html = generateDigestEmailHtml(makeDigest());
    expect(html).toContain("test-store.myshopify.com/admin/apps/storeguard/settings");
    expect(html).toContain("Manage notification settings");
  });

  it("includes Outlook conditional comments for fixed-width wrapper", () => {
    const html = generateDigestEmailHtml(makeDigest());
    expect(html).toContain("<!--[if mso]>");
    expect(html).toContain("<![endif]-->");
  });

  it("includes bgcolor attributes for Outlook background colors", () => {
    const html = generateDigestEmailHtml(makeDigest());
    expect(html).toContain('bgcolor="');
  });

  it("handles unknown event types gracefully with fallback title", () => {
    const html = generateDigestEmailHtml(makeDigest({
      eventsByType: {
        mystery_event: [makeDigestEvent({ eventType: "mystery_event" })],
      },
    }));
    expect(html).toContain("Mystery Event");
  });
});

// ============================================
// DIGEST CHANGE DESCRIPTIONS
// ============================================

describe("formatDigestChangeDescription", () => {
  it("formats price changes with arrow entity", () => {
    const result = formatDigestChangeDescription(makeDigestEvent());
    expect(result).toContain("$89.00");
    expect(result).toContain("&rarr;");
    expect(result).toContain("$8.90");
  });

  it("formats visibility changes", () => {
    const result = formatDigestChangeDescription(makeDigestEvent({
      eventType: "visibility_change",
      beforeValue: "active",
      afterValue: "draft",
    }));
    expect(result).toContain("active");
    expect(result).toContain("draft");
  });

  it("formats inventory zero", () => {
    const result = formatDigestChangeDescription(makeDigestEvent({
      eventType: "inventory_zero",
      beforeValue: "15",
      afterValue: "0",
    }));
    expect(result).toContain("Cannot be purchased");
    expect(result).toContain("15 units");
  });

  it("formats inventory low", () => {
    const result = formatDigestChangeDescription(makeDigestEvent({
      eventType: "inventory_low",
      beforeValue: "20",
      afterValue: "3",
    }));
    expect(result).toContain("3 units");
    expect(result).toContain("was 20");
  });

  it("formats theme publish", () => {
    const result = formatDigestChangeDescription(makeDigestEvent({
      eventType: "theme_publish",
      resourceName: "Dawn Custom",
    }));
    expect(result).toContain("Live theme replaced");
  });

  it("includes velocity context from contextData", () => {
    const result = formatDigestChangeDescription(makeDigestEvent({
      contextData: JSON.stringify({ velocityContext: "selling 8/day" }),
    }));
    expect(result).toContain("selling 8/day");
  });

  it("includes location context from contextData", () => {
    const result = formatDigestChangeDescription(makeDigestEvent({
      contextData: JSON.stringify({ locationContext: "Main Warehouse" }),
    }));
    expect(result).toContain("Main Warehouse");
  });

  it("handles invalid contextData gracefully", () => {
    const result = formatDigestChangeDescription(makeDigestEvent({
      contextData: "not-json",
    }));
    // Should still produce a result without crashing
    expect(result).toContain("$89.00");
  });

  it("formats collection events", () => {
    expect(formatDigestChangeDescription(makeDigestEvent({ eventType: "collection_created" }))).toContain("collection created");
    expect(formatDigestChangeDescription(makeDigestEvent({ eventType: "collection_updated" }))).toContain("Collection updated");
    expect(formatDigestChangeDescription(makeDigestEvent({ eventType: "collection_deleted" }))).toContain("Collection deleted");
  });

  it("formats discount events", () => {
    expect(formatDigestChangeDescription(makeDigestEvent({ eventType: "discount_created" }))).toContain("Discount created");
    expect(formatDigestChangeDescription(makeDigestEvent({
      eventType: "discount_changed",
      beforeValue: "20% off",
      afterValue: "50% off",
    }))).toContain("&rarr;");
    expect(formatDigestChangeDescription(makeDigestEvent({ eventType: "discount_deleted" }))).toContain("Discount deleted");
  });

  it("formats app permissions changed", () => {
    const result = formatDigestChangeDescription(makeDigestEvent({ eventType: "app_permissions_changed" }));
    expect(result).toContain("Permissions changed");
  });

  it("formats domain events", () => {
    expect(formatDigestChangeDescription(makeDigestEvent({ eventType: "domain_changed" }))).toContain("Domain added or changed");
    expect(formatDigestChangeDescription(makeDigestEvent({ eventType: "domain_removed" }))).toContain("Domain removed");
  });
});

// ============================================
// INSTANT ALERT HTML
// ============================================

describe("generateInstantAlertHtml", () => {
  it("produces valid XHTML transitional doctype", () => {
    const html = generateInstantAlertHtml(makeInstantEvent(), "test-store.myshopify.com");
    expect(html).toContain('<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN"');
  });

  it("uses table-based layout", () => {
    const html = generateInstantAlertHtml(makeInstantEvent(), "test-store.myshopify.com");
    expect(html).not.toContain("display: flex");
    expect(html).toContain('role="presentation"');
  });

  it("sets min-width 320px", () => {
    const html = generateInstantAlertHtml(makeInstantEvent(), "test-store.myshopify.com");
    expect(html).toContain("min-width: 320px");
  });

  it("uses 14px base font size", () => {
    const html = generateInstantAlertHtml(makeInstantEvent(), "test-store.myshopify.com");
    expect(html).toContain("font-size: 14px");
  });

  it("includes shield branding", () => {
    const html = generateInstantAlertHtml(makeInstantEvent(), "test-store.myshopify.com");
    expect(html).toContain("&#x1F6E1;");
  });

  it("uses event-specific accent color in header", () => {
    const html = generateInstantAlertHtml(
      makeInstantEvent({ eventType: "inventory_zero" }),
      "test-store.myshopify.com",
    );
    expect(html).toContain(EVENT_TYPE_CONFIG.inventory_zero.color);
  });

  it("includes resource name", () => {
    const html = generateInstantAlertHtml(makeInstantEvent(), "test-store.myshopify.com");
    expect(html).toContain("Blue Jacket / M");
  });

  it("includes change description", () => {
    const html = generateInstantAlertHtml(makeInstantEvent(), "test-store.myshopify.com");
    expect(html).toContain("Price changed from $89.00 to $8.90");
  });

  it("includes Shopify Admin CTA button", () => {
    const html = generateInstantAlertHtml(makeInstantEvent(), "test-store.myshopify.com");
    expect(html).toContain("View in Shopify Admin");
    expect(html).toContain("test-store.myshopify.com/admin");
  });

  it("includes Outlook VML button fallback", () => {
    const html = generateInstantAlertHtml(makeInstantEvent(), "test-store.myshopify.com");
    expect(html).toContain("v:roundrect");
  });

  it("shows revenue impact when present in contextData", () => {
    const html = generateInstantAlertHtml(
      makeInstantEvent({ contextData: JSON.stringify({ revenueImpact: 42.50 }) }),
      "test-store.myshopify.com",
    );
    expect(html).toContain("$42.50/hr");
  });

  it("hides revenue impact when not present", () => {
    const html = generateInstantAlertHtml(makeInstantEvent(), "test-store.myshopify.com");
    expect(html).not.toContain("Estimated impact");
  });

  it("includes settings link in footer", () => {
    const html = generateInstantAlertHtml(makeInstantEvent(), "test-store.myshopify.com");
    expect(html).toContain("Manage instant alerts");
  });
});

// ============================================
// INSTANT ALERT SUBJECTS
// ============================================

describe("getInstantAlertSubject", () => {
  it("includes resource name and shop name", () => {
    const subject = getInstantAlertSubject(makeInstantEvent(), "test-store");
    expect(subject).toContain("Blue Jacket / M");
    expect(subject).toContain("test-store");
  });

  it("returns correct subject for each event type", () => {
    expect(getInstantAlertSubject(makeInstantEvent({ eventType: "price_change" }), "shop"))
      .toContain("Price changed");
    expect(getInstantAlertSubject(makeInstantEvent({ eventType: "inventory_zero" }), "shop"))
      .toContain("Cannot be purchased");
    expect(getInstantAlertSubject(makeInstantEvent({ eventType: "inventory_low", afterValue: "3" }), "shop"))
      .toContain("Low stock");
    expect(getInstantAlertSubject(makeInstantEvent({ eventType: "theme_publish" }), "shop"))
      .toContain("Live theme replaced");
    expect(getInstantAlertSubject(makeInstantEvent({ eventType: "visibility_change", afterValue: "active" }), "shop"))
      .toContain("restored");
    expect(getInstantAlertSubject(makeInstantEvent({ eventType: "visibility_change", afterValue: "draft" }), "shop"))
      .toContain("hidden");
  });

  it("returns correct subject for V2 event types", () => {
    expect(getInstantAlertSubject(makeInstantEvent({ eventType: "collection_created" }), "shop"))
      .toContain("Collection created");
    expect(getInstantAlertSubject(makeInstantEvent({ eventType: "discount_deleted" }), "shop"))
      .toContain("Discount deleted");
    expect(getInstantAlertSubject(makeInstantEvent({ eventType: "app_permissions_changed" }), "shop"))
      .toContain("App permissions changed");
    expect(getInstantAlertSubject(makeInstantEvent({ eventType: "domain_removed" }), "shop"))
      .toContain("Domain removed");
  });

  it("does not include emojis in subject lines", () => {
    const types = [
      "price_change", "visibility_change", "inventory_low", "inventory_zero",
      "theme_publish", "collection_created", "discount_deleted", "domain_changed",
    ];
    for (const eventType of types) {
      const subject = getInstantAlertSubject(makeInstantEvent({ eventType }), "shop");
      // Check no emoji characters (common emoji ranges)
      expect(subject).not.toMatch(/[\u{1F600}-\u{1F64F}]/u);
      expect(subject).not.toMatch(/[\u{1F300}-\u{1F5FF}]/u);
      expect(subject).not.toMatch(/[\u{1F680}-\u{1F6FF}]/u);
      expect(subject).not.toMatch(/[\u{2600}-\u{26FF}]/u);
      expect(subject).not.toMatch(/[\u{2700}-\u{27BF}]/u);
    }
  });

  it("handles unknown event types", () => {
    const subject = getInstantAlertSubject(makeInstantEvent({ eventType: "unknown_type" }), "shop");
    expect(subject).toContain("Change detected");
  });
});

// ============================================
// INSTANT ALERT DESCRIPTIONS
// ============================================

describe("buildInstantAlertDescription", () => {
  it("describes price changes", () => {
    const desc = buildInstantAlertDescription(makeInstantEvent());
    expect(desc).toContain("Price changed from $89.00 to $8.90");
  });

  it("describes visibility changes", () => {
    const desc = buildInstantAlertDescription(makeInstantEvent({
      eventType: "visibility_change",
      beforeValue: "active",
      afterValue: "draft",
    }));
    expect(desc).toContain("Product hidden");
    expect(desc).toContain("no longer visible to customers");
  });

  it("describes inventory zero", () => {
    const desc = buildInstantAlertDescription(makeInstantEvent({
      eventType: "inventory_zero",
      beforeValue: "15",
    }));
    expect(desc).toContain("Cannot be purchased");
    expect(desc).toContain("15 units");
  });

  it("describes inventory low", () => {
    const desc = buildInstantAlertDescription(makeInstantEvent({
      eventType: "inventory_low",
      beforeValue: "20",
      afterValue: "3",
    }));
    expect(desc).toContain("3 units total");
    expect(desc).toContain("was 20");
  });

  it("appends velocity context", () => {
    const desc = buildInstantAlertDescription(makeInstantEvent({
      contextData: JSON.stringify({ velocityContext: "selling 8/day" }),
    }));
    expect(desc).toContain("selling 8/day");
  });

  it("appends location context", () => {
    const desc = buildInstantAlertDescription(makeInstantEvent({
      contextData: JSON.stringify({ locationContext: "Main Warehouse" }),
    }));
    expect(desc).toContain("Main Warehouse");
  });

  it("handles all V2 event types", () => {
    expect(buildInstantAlertDescription(makeInstantEvent({ eventType: "collection_created" })))
      .toContain("was created");
    expect(buildInstantAlertDescription(makeInstantEvent({ eventType: "collection_updated" })))
      .toContain("was updated");
    expect(buildInstantAlertDescription(makeInstantEvent({ eventType: "collection_deleted" })))
      .toContain("was deleted");
    expect(buildInstantAlertDescription(makeInstantEvent({ eventType: "discount_created" })))
      .toContain("was created");
    expect(buildInstantAlertDescription(makeInstantEvent({ eventType: "discount_changed", beforeValue: "10%", afterValue: "20%" })))
      .toContain("was modified");
    expect(buildInstantAlertDescription(makeInstantEvent({ eventType: "discount_deleted" })))
      .toContain("was deleted");
    expect(buildInstantAlertDescription(makeInstantEvent({ eventType: "app_permissions_changed" })))
      .toContain("permissions were changed");
    expect(buildInstantAlertDescription(makeInstantEvent({ eventType: "domain_changed" })))
      .toContain("was added or changed");
    expect(buildInstantAlertDescription(makeInstantEvent({ eventType: "domain_removed" })))
      .toContain("was removed");
  });
});

// ============================================
// getAlertColor
// ============================================

describe("getAlertColor", () => {
  it("returns correct colors for known event types", () => {
    expect(getAlertColor("price_change")).toBe("#f59e0b");
    expect(getAlertColor("inventory_zero")).toBe("#ef4444");
    expect(getAlertColor("theme_publish")).toBe("#06b6d4");
  });

  it("returns fallback gray for unknown event types", () => {
    expect(getAlertColor("unknown")).toBe("#6b7280");
  });
});

// ============================================
// EVENT_TYPE_CONFIG
// ============================================

describe("EVENT_TYPE_CONFIG", () => {
  it("covers all V1 + V2 event types", () => {
    const expectedTypes = [
      "price_change", "visibility_change", "inventory_low", "inventory_zero",
      "theme_publish", "collection_created", "collection_updated", "collection_deleted",
      "discount_created", "discount_changed", "discount_deleted",
      "app_permissions_changed", "domain_changed", "domain_removed",
    ];
    for (const type of expectedTypes) {
      expect(EVENT_TYPE_CONFIG[type]).toBeDefined();
      expect(EVENT_TYPE_CONFIG[type].title).toBeTruthy();
      expect(EVENT_TYPE_CONFIG[type].color).toMatch(/^#[0-9a-f]{6}$/);
      expect(typeof EVENT_TYPE_CONFIG[type].order).toBe("number");
    }
  });

  it("has unique display orders", () => {
    const orders = Object.values(EVENT_TYPE_CONFIG).map((c) => c.order);
    expect(new Set(orders).size).toBe(orders.length);
  });
});
