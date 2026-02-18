/**
 * Context Enricher for StoreGuard
 *
 * Centralizes business context enrichment for ChangeEvents.
 * Each event type gets a human-readable summary stored in contextData JSON.
 *
 * Context structure (stored as JSON string in ChangeEvent.contextData):
 * {
 *   summary: string;           // Human-readable one-liner for emails/UI
 *   velocityContext?: string;   // e.g., "selling 8/day"
 *   revenueImpact?: number;    // Estimated $/hr impact
 *   locationContext?: string;   // e.g., "Warehouse A"
 *   percentChange?: number;    // For price changes
 *   direction?: "up" | "down"; // For price changes
 * }
 */

import type { ProductVelocity } from "./salesVelocity.utils";
import { formatVelocityContext, estimateRevenueImpact } from "./salesVelocity.utils";

export interface EnrichedContext {
  summary: string;
  velocityContext: string | null;
  revenueImpact: number | null;
  locationContext: string | null;
  percentChange: number | null;
  direction: "up" | "down" | null;
}

/**
 * Enrich a price change event with business context.
 * Calculates % change, direction, and flags likely typos (>=90% drop).
 */
export function enrichPriceChange(
  resourceName: string,
  beforePrice: string,
  afterPrice: string,
  velocity: ProductVelocity | null
): EnrichedContext {
  const oldVal = parseFloat(beforePrice.replace(/^\$/, ""));
  const newVal = parseFloat(afterPrice.replace(/^\$/, ""));

  let percentChange: number | null = null;
  let direction: "up" | "down" | null = null;

  if (!isNaN(oldVal) && !isNaN(newVal) && oldVal > 0) {
    percentChange = Math.round(((newVal - oldVal) / oldVal) * 100);
    direction = newVal > oldVal ? "up" : "down";
  }

  const velocityContext = formatVelocityContext(velocity);
  const priceDiff = !isNaN(oldVal) && !isNaN(newVal) ? Math.abs(newVal - oldVal) : 0;
  const revenueImpact = estimateRevenueImpact(velocity, "price_error", {
    priceDifference: priceDiff,
  });

  let summary = `${resourceName} changed from ${beforePrice} to ${afterPrice}`;
  if (percentChange !== null) {
    const absPercent = Math.abs(percentChange);
    const dirWord = direction === "up" ? "increase" : "decrease";
    summary += ` (${absPercent}% ${dirWord})`;
    if (direction === "down" && absPercent >= 90) {
      summary += " — probably a typo";
    }
  }
  if (velocityContext) {
    summary += ` — ${velocityContext}`;
  }

  return {
    summary,
    velocityContext,
    revenueImpact,
    locationContext: null,
    percentChange,
    direction,
  };
}

/**
 * Enrich an inventory zero event with business context.
 * Includes revenue at risk based on sales velocity.
 */
export function enrichInventoryZero(
  resourceName: string,
  previousQuantity: string,
  velocity: ProductVelocity | null,
  locationContext: string | null
): EnrichedContext {
  const velocityCtx = formatVelocityContext(velocity);
  const revenueImpact = estimateRevenueImpact(velocity, "stockout", {});

  let summary = `${resourceName} hit zero stock (was ${previousQuantity} units)`;
  if (velocityCtx) {
    summary += ` — you've been ${velocityCtx}`;
  }
  if (locationContext) {
    summary += ` at ${locationContext}`;
  }

  return {
    summary,
    velocityContext: velocityCtx,
    revenueImpact,
    locationContext,
    percentChange: null,
    direction: null,
  };
}

/**
 * Enrich a low stock event with business context.
 */
export function enrichLowStock(
  resourceName: string,
  previousQuantity: string,
  currentQuantity: string,
  velocity: ProductVelocity | null,
  locationContext: string | null
): EnrichedContext {
  const velocityCtx = formatVelocityContext(velocity);
  const revenueImpact = estimateRevenueImpact(velocity, "stockout", {});

  let summary = `${resourceName} dropped to ${currentQuantity} units (was ${previousQuantity})`;
  if (velocityCtx) {
    summary += ` — ${velocityCtx}`;
  }
  if (locationContext) {
    summary += ` at ${locationContext}`;
  }

  return {
    summary,
    velocityContext: velocityCtx,
    revenueImpact,
    locationContext,
    percentChange: null,
    direction: null,
  };
}

/**
 * Enrich a visibility change event with business context.
 * Includes what the transition means and recent sales data.
 */
export function enrichVisibilityChange(
  resourceName: string,
  beforeStatus: string,
  afterStatus: string,
  velocity: ProductVelocity | null
): EnrichedContext {
  const velocityCtx = formatVelocityContext(velocity);
  const revenueImpact = estimateRevenueImpact(velocity, "visibility", {});

  const goingHidden = afterStatus === "draft" || afterStatus === "archived";
  const visibilityLabel = goingHidden ? "no longer visible to customers" : "now visible to customers";

  let summary = `${resourceName} went ${beforeStatus} → ${afterStatus} — ${visibilityLabel}`;
  if (velocityCtx) {
    summary += ` (${velocityCtx})`;
  }

  return {
    summary,
    velocityContext: velocityCtx,
    revenueImpact,
    locationContext: null,
    percentChange: null,
    direction: null,
  };
}

/**
 * Enrich a theme publish event.
 */
export function enrichThemePublish(themeName: string): EnrichedContext {
  const time = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  const summary = `Theme "${themeName}" went live at ${time}`;

  return {
    summary,
    velocityContext: null,
    revenueImpact: null,
    locationContext: null,
    percentChange: null,
    direction: null,
  };
}

/**
 * Serialize EnrichedContext to JSON string for storage in contextData field.
 * Returns null if context has no meaningful data.
 */
export function serializeContext(context: EnrichedContext): string | null {
  // Always store if we have a summary
  if (!context.summary) return null;

  const data: Record<string, unknown> = { summary: context.summary };
  if (context.velocityContext) data.velocityContext = context.velocityContext;
  if (context.revenueImpact !== null) data.revenueImpact = context.revenueImpact;
  if (context.locationContext) data.locationContext = context.locationContext;
  if (context.percentChange !== null) data.percentChange = context.percentChange;
  if (context.direction) data.direction = context.direction;

  return JSON.stringify(data);
}

/**
 * Parse contextData JSON string back to structured data.
 * Safe — returns defaults on invalid/missing data.
 */
export function parseContextData(contextData: string | null | undefined): {
  summary: string | null;
  velocityContext: string | null;
  revenueImpact: number | null;
  locationContext: string | null;
  percentChange: number | null;
  direction: "up" | "down" | null;
} {
  if (!contextData) {
    return { summary: null, velocityContext: null, revenueImpact: null, locationContext: null, percentChange: null, direction: null };
  }
  try {
    const ctx = JSON.parse(contextData) as Record<string, unknown>;
    return {
      summary: typeof ctx.summary === "string" ? ctx.summary : null,
      velocityContext: typeof ctx.velocityContext === "string" ? ctx.velocityContext : null,
      revenueImpact: typeof ctx.revenueImpact === "number" ? ctx.revenueImpact : null,
      locationContext: typeof ctx.locationContext === "string" ? ctx.locationContext : null,
      percentChange: typeof ctx.percentChange === "number" ? ctx.percentChange : null,
      direction: ctx.direction === "up" || ctx.direction === "down" ? ctx.direction : null,
    };
  } catch {
    return { summary: null, velocityContext: null, revenueImpact: null, locationContext: null, percentChange: null, direction: null };
  }
}
