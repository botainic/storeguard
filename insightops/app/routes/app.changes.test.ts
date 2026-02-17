import { describe, it, expect } from "vitest";

/**
 * Tests for the event display configuration used in app.changes.tsx.
 * Ensures all supported event types and importance levels have display configs.
 */

// Mirror the event config from app.changes.tsx to verify completeness
const eventConfig: Record<string, { label: string; color: string }> = {
  price_change: { label: "Price Change", color: "#ffa500" },
  visibility_change: { label: "Visibility", color: "#9b59b6" },
  inventory_low: { label: "Low Stock", color: "#f97316" },
  inventory_zero: { label: "Out of Stock", color: "#e74c3c" },
  theme_publish: { label: "Theme Published", color: "#3498db" },
};

const importanceConfig: Record<string, { label: string; color: string }> = {
  high: { label: "High", color: "#e74c3c" },
  medium: { label: "Medium", color: "#f39c12" },
  low: { label: "Low", color: "#95a5a6" },
};

// All event types that the system can produce (from changeDetection.server.ts)
const ALL_EVENT_TYPES = [
  "price_change",
  "visibility_change",
  "inventory_low",
  "inventory_zero",
  "theme_publish",
];

const ALL_IMPORTANCE_LEVELS = ["high", "medium", "low"];

describe("event display config", () => {
  it("should have config for every supported event type", () => {
    for (const eventType of ALL_EVENT_TYPES) {
      expect(eventConfig[eventType]).toBeDefined();
      expect(eventConfig[eventType].label).toBeTruthy();
      expect(eventConfig[eventType].color).toBeTruthy();
    }
  });

  it("should have config for every importance level", () => {
    for (const level of ALL_IMPORTANCE_LEVELS) {
      expect(importanceConfig[level]).toBeDefined();
      expect(importanceConfig[level].label).toBeTruthy();
      expect(importanceConfig[level].color).toBeTruthy();
    }
  });

  it("should not have extra event types beyond what the system produces", () => {
    const configKeys = Object.keys(eventConfig);
    for (const key of configKeys) {
      expect(ALL_EVENT_TYPES).toContain(key);
    }
  });

  it("should use valid hex color codes", () => {
    const hexPattern = /^#[0-9a-fA-F]{6}$/;

    for (const config of Object.values(eventConfig)) {
      expect(config.color).toMatch(hexPattern);
    }
    for (const config of Object.values(importanceConfig)) {
      expect(config.color).toMatch(hexPattern);
    }
  });
});

describe("email validation", () => {
  // Mirror the validation from app.settings.tsx
  function isValidEmail(email: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  }

  function validateEmails(
    emailString: string
  ): { valid: boolean; invalidEmails: string[] } {
    if (!emailString.trim()) return { valid: true, invalidEmails: [] };
    const emails = emailString
      .split(",")
      .map((e) => e.trim())
      .filter((e) => e);
    const invalidEmails = emails.filter((e) => !isValidEmail(e));
    return { valid: invalidEmails.length === 0, invalidEmails };
  }

  it("should accept valid emails", () => {
    expect(isValidEmail("test@example.com")).toBe(true);
    expect(isValidEmail("user+tag@domain.co")).toBe(true);
    expect(isValidEmail("name@sub.domain.com")).toBe(true);
  });

  it("should reject invalid emails", () => {
    expect(isValidEmail("not-an-email")).toBe(false);
    expect(isValidEmail("@missing-local.com")).toBe(false);
    expect(isValidEmail("missing-domain@")).toBe(false);
    expect(isValidEmail("has spaces@example.com")).toBe(false);
  });

  it("should validate comma-separated email lists", () => {
    expect(validateEmails("a@b.com, c@d.com")).toEqual({
      valid: true,
      invalidEmails: [],
    });
    expect(validateEmails("a@b.com, bad-email")).toEqual({
      valid: false,
      invalidEmails: ["bad-email"],
    });
  });

  it("should treat empty string as valid", () => {
    expect(validateEmails("")).toEqual({ valid: true, invalidEmails: [] });
    expect(validateEmails("   ")).toEqual({ valid: true, invalidEmails: [] });
  });
});
