import { describe, it, expect } from "vitest";
import {
  ONBOARDING_STEPS,
  getStepIndex,
  isValidStep,
  getNextStep,
  getPreviousStep,
  isValidEmail,
  validateEmailStep,
  validateMonitorStep,
  DEFAULT_MONITORS,
  type MonitorSelections,
} from "./onboarding.utils";

describe("ONBOARDING_STEPS", () => {
  it("has exactly 5 steps in correct order", () => {
    expect(ONBOARDING_STEPS).toEqual(["welcome", "email", "monitors", "sync", "done"]);
    expect(ONBOARDING_STEPS).toHaveLength(5);
  });
});

describe("getStepIndex", () => {
  it("returns correct index for each step", () => {
    expect(getStepIndex("welcome")).toBe(0);
    expect(getStepIndex("email")).toBe(1);
    expect(getStepIndex("monitors")).toBe(2);
    expect(getStepIndex("sync")).toBe(3);
    expect(getStepIndex("done")).toBe(4);
  });
});

describe("isValidStep", () => {
  it("returns true for valid steps", () => {
    expect(isValidStep("welcome")).toBe(true);
    expect(isValidStep("email")).toBe(true);
    expect(isValidStep("monitors")).toBe(true);
    expect(isValidStep("sync")).toBe(true);
    expect(isValidStep("done")).toBe(true);
  });

  it("returns false for invalid steps", () => {
    expect(isValidStep("invalid")).toBe(false);
    expect(isValidStep("")).toBe(false);
    expect(isValidStep("setup")).toBe(false);
  });
});

describe("getNextStep", () => {
  it("returns the next step", () => {
    expect(getNextStep("welcome")).toBe("email");
    expect(getNextStep("email")).toBe("monitors");
    expect(getNextStep("monitors")).toBe("sync");
    expect(getNextStep("sync")).toBe("done");
  });

  it("returns null for the last step", () => {
    expect(getNextStep("done")).toBeNull();
  });
});

describe("getPreviousStep", () => {
  it("returns the previous step", () => {
    expect(getPreviousStep("email")).toBe("welcome");
    expect(getPreviousStep("monitors")).toBe("email");
    expect(getPreviousStep("sync")).toBe("monitors");
    expect(getPreviousStep("done")).toBe("sync");
  });

  it("returns null for the first step", () => {
    expect(getPreviousStep("welcome")).toBeNull();
  });
});

describe("isValidEmail", () => {
  it("accepts valid emails", () => {
    expect(isValidEmail("user@example.com")).toBe(true);
    expect(isValidEmail("user+tag@domain.co.uk")).toBe(true);
    expect(isValidEmail("a@b.c")).toBe(true);
  });

  it("rejects invalid emails", () => {
    expect(isValidEmail("")).toBe(false);
    expect(isValidEmail("noatsign")).toBe(false);
    expect(isValidEmail("no@domain")).toBe(false);
    expect(isValidEmail("@no-user.com")).toBe(false);
    expect(isValidEmail("spaces in@email.com")).toBe(false);
  });
});

describe("validateEmailStep", () => {
  it("returns error for empty email", () => {
    expect(validateEmailStep("")).toBe("Please enter an email address to receive alerts.");
    expect(validateEmailStep("   ")).toBe("Please enter an email address to receive alerts.");
  });

  it("returns error for invalid email", () => {
    expect(validateEmailStep("notanemail")).toBe("Please enter a valid email address.");
  });

  it("returns null for valid email", () => {
    expect(validateEmailStep("user@example.com")).toBeNull();
    expect(validateEmailStep("  user@example.com  ")).toBeNull();
  });
});

describe("validateMonitorStep", () => {
  it("returns error when no monitors selected", () => {
    const noMonitors: MonitorSelections = {
      trackPrices: false,
      trackVisibility: false,
      trackInventory: false,
      trackCollections: false,
    };
    expect(validateMonitorStep(noMonitors)).toBe("Please select at least one monitor.");
  });

  it("returns null when at least one monitor is selected", () => {
    expect(validateMonitorStep({ ...DEFAULT_MONITORS, trackPrices: true, trackVisibility: false, trackInventory: false, trackCollections: false })).toBeNull();
    expect(validateMonitorStep(DEFAULT_MONITORS)).toBeNull();
  });
});

describe("DEFAULT_MONITORS", () => {
  it("has all monitors enabled by default", () => {
    expect(DEFAULT_MONITORS).toEqual({
      trackPrices: true,
      trackVisibility: true,
      trackInventory: true,
      trackCollections: true,
    });
  });
});
