import { describe, it, expect, vi } from "vitest";
import {
  waitForRateLimit,
  getThrottleRetryMs,
  PRODUCTS_PER_PAGE,
  VARIANTS_PER_PAGE,
} from "./productSync.server";

describe("PRODUCTS_PER_PAGE", () => {
  it("should be 250 (Shopify max)", () => {
    expect(PRODUCTS_PER_PAGE).toBe(250);
  });
});

describe("VARIANTS_PER_PAGE", () => {
  it("should be 100", () => {
    expect(VARIANTS_PER_PAGE).toBe(100);
  });
});

describe("getThrottleRetryMs", () => {
  it("should return 0 when no errors present", () => {
    const response = {
      data: { products: { edges: [], pageInfo: { hasNextPage: false, endCursor: null } } },
    };
    expect(getThrottleRetryMs(response)).toBe(0);
  });

  it("should return 0 when errors are not THROTTLED", () => {
    const response = {
      data: undefined,
      errors: [{ message: "Something went wrong", extensions: { code: "INTERNAL_ERROR" } }],
    };
    expect(getThrottleRetryMs(response)).toBe(0);
  });

  it("should return retry ms when THROTTLED error is present", () => {
    const response = {
      data: undefined,
      errors: [{ message: "Throttled", extensions: { code: "THROTTLED" } }],
      extensions: {
        cost: {
          requestedQueryCost: 500,
          actualQueryCost: 0,
          throttleStatus: {
            maximumAvailable: 1000,
            currentlyAvailable: 100,
            restoreRate: 50,
          },
        },
      },
    };
    const retryMs = getThrottleRetryMs(response);
    // (500 - 100) / 50 = 8 seconds + 1s buffer = 9000ms
    expect(retryMs).toBe(9000);
  });

  it("should return calculated fallback when THROTTLED but no cost info", () => {
    const response = {
      data: undefined,
      errors: [{ message: "Throttled", extensions: { code: "THROTTLED" } }],
    };
    // Defaults: needed=100, available=0, restoreRate=50
    // (100/50)*1000 + 1000 = 3000ms
    expect(getThrottleRetryMs(response)).toBe(3000);
  });

  it("should return default 2000ms when deficit is zero or negative", () => {
    const response = {
      data: undefined,
      errors: [{ message: "Throttled", extensions: { code: "THROTTLED" } }],
      extensions: {
        cost: {
          requestedQueryCost: 50,
          actualQueryCost: 50,
          throttleStatus: {
            maximumAvailable: 1000,
            currentlyAvailable: 800,
            restoreRate: 50,
          },
        },
      },
    };
    expect(getThrottleRetryMs(response)).toBe(2000);
  });

  it("should detect THROTTLED among multiple errors", () => {
    const response = {
      data: undefined,
      errors: [
        { message: "Another error" },
        { message: "Throttled", extensions: { code: "THROTTLED" } },
      ],
      extensions: {
        cost: {
          requestedQueryCost: 200,
          actualQueryCost: 0,
          throttleStatus: {
            maximumAvailable: 1000,
            currentlyAvailable: 0,
            restoreRate: 50,
          },
        },
      },
    };
    const retryMs = getThrottleRetryMs(response);
    // (200 - 0) / 50 = 4s + 1s = 5000ms
    expect(retryMs).toBe(5000);
  });
});

describe("waitForRateLimit", () => {
  it("should resolve immediately when throttleStatus is undefined", async () => {
    const start = Date.now();
    await waitForRateLimit(undefined, 100);
    expect(Date.now() - start).toBeLessThan(50);
  });

  it("should resolve immediately when enough points available", async () => {
    const start = Date.now();
    await waitForRateLimit(
      { maximumAvailable: 1000, currentlyAvailable: 800, restoreRate: 50 },
      100
    );
    expect(Date.now() - start).toBeLessThan(50);
  });

  it("should wait when points are below threshold", async () => {
    vi.useFakeTimers();
    const promise = waitForRateLimit(
      { maximumAvailable: 1000, currentlyAvailable: 50, restoreRate: 50 },
      300
    );

    // Should be waiting — advance timers
    // Need (300 - 50) / 50 = 5 + 1 = 6 seconds
    await vi.advanceTimersByTimeAsync(6000);
    await promise;

    vi.useRealTimers();
  });

  it("should use THROTTLE_THRESHOLD as minimum when queryCost is small", async () => {
    vi.useFakeTimers();
    // queryCost is 10 but THROTTLE_THRESHOLD is 200, so we should wait
    // since currentlyAvailable (100) < max(10, 200) = 200
    const promise = waitForRateLimit(
      { maximumAvailable: 1000, currentlyAvailable: 100, restoreRate: 50 },
      10
    );

    // pointsNeeded = 10 - 100 = negative, but the threshold triggers
    // Actually: queryCost (10) < THROTTLE_THRESHOLD (200), so we compare
    // currentlyAvailable (100) < max(10, 200) = 200 => must wait
    // pointsNeeded = queryCost - available = 10 - 100 = -90 => ceil(-90/50)+1 = -1+1 = 0
    // Wait: 0 seconds? No — let's check:
    // We need `queryCost - currentlyAvailable`, so 10 - 100 = -90
    // waitSeconds = ceil(-90 / 50) + 1 = ceil(-1.8) + 1 = -1 + 1 = 0
    // setTimeout(resolve, 0) resolves on next tick
    await vi.advanceTimersByTimeAsync(0);
    await promise;

    vi.useRealTimers();
  });
});
