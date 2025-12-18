/**
 * Impact Analysis Utility Functions
 * Extracted for testing and reuse
 */

export interface SalesDataPoint {
  hour: string;
  sales: number;
  timestamp: number;
}

export interface ImpactAnalysis {
  baselineSales: number;
  postSales: number;
  percentChange: number;
  diff: number;
  isNegative: boolean;
  isZeroBaseline: boolean;
  isSmartBaseline: boolean;
}

export interface EventLog {
  id: string;
  topic: string;
  diff: string | null;
  timestamp: Date;
}

/**
 * Check if an event is "strategic" (merchant decision) vs "consequential" (result of sales)
 * Strategic: Price changes, title updates, description edits - things merchants DECIDE to do
 * Consequential: Inventory updates, orders, stock-only changes - these are RESULTS of sales
 */
export function isStrategicEvent(topic: string, diff: string | null): boolean {
  const lowerTopic = topic.toLowerCase();

  // Skip inventory updates and orders - these are consequences, not causes
  if (lowerTopic.includes("inventory")) return false;
  if (lowerTopic.includes("orders")) return false;

  // For product updates, check if it's just a stock change (not strategic)
  // vs. an actual attribute change like price/title (strategic)
  if (lowerTopic.includes("products") && diff) {
    try {
      const diffData = JSON.parse(diff);
      const changes = diffData.changes || [];
      // If the only change is inventory/stock, it's not strategic
      if (changes.length > 0) {
        const hasNonStockChange = changes.some(
          (c: { field: string }) => c.field !== "inventory" && c.field !== "stock"
        );
        if (!hasNonStockChange) return false;
      }
    } catch {
      // If we can't parse diff, assume it's strategic
    }
  }

  return true;
}

/**
 * Calculate average sales over a window of time slots
 */
export function calcAvgSales(
  salesData: SalesDataPoint[],
  startIdx: number,
  count: number
): number {
  let sum = 0;
  let validCount = 0;
  for (let i = 0; i < count; i++) {
    const idx = startIdx + i;
    if (idx >= 0 && idx < salesData.length) {
      sum += salesData[idx].sales;
      validCount++;
    }
  }
  return validCount > 0 ? sum / validCount : 0;
}

/**
 * Calculate impact analysis for a given event
 */
export function calculateImpactAnalysis(
  event: EventLog,
  salesData: SalesDataPoint[],
  matchThreshold: number
): ImpactAnalysis | null {
  if (salesData.length < 4) return null;

  // Only show impact for STRATEGIC events (merchant decisions)
  if (!isStrategicEvent(event.topic, event.diff)) return null;

  const eventTime = new Date(event.timestamp).getTime();
  const eventIndex = salesData.findIndex(
    (d) => Math.abs(d.timestamp - eventTime) < matchThreshold
  );

  if (eventIndex === -1) return null;

  // POST-EVENT: Average of next 2 time slots after the change
  const lookAhead = 2;
  const postSales = calcAvgSales(salesData, eventIndex + 1, lookAhead);

  // SMART BASELINE: Try to find same time slot 7 days ago (Week-over-Week)
  const oneWeekMs = 7 * 24 * 60 * 60 * 1000;
  const refTime = eventTime - oneWeekMs;
  const refIndex = salesData.findIndex(
    (d) => Math.abs(d.timestamp - refTime) < matchThreshold
  );

  let baselineSales: number;
  let isSmartBaseline: boolean;

  if (refIndex !== -1) {
    // SMART MODE: We have data from same time last week
    baselineSales = calcAvgSales(salesData, refIndex, lookAhead);
    isSmartBaseline = true;
  } else {
    // FALLBACK MODE: Use naive "previous 2 hours" comparison
    baselineSales = calcAvgSales(salesData, eventIndex - lookAhead, lookAhead);
    isSmartBaseline = false;
  }

  // CADENCE CHECK: If baseline is $0 AND post is $0, this is normal quiet time
  if (baselineSales < 1 && postSales < 1) {
    return null;
  }

  const diff = postSales - baselineSales;
  const isZeroBaseline = baselineSales < 1;

  // Calculate percent only if we have a baseline
  const percentChange = isZeroBaseline
    ? 0
    : Math.round((diff / baselineSales) * 100 * 10) / 10;

  return {
    baselineSales: Math.round(baselineSales),
    postSales: Math.round(postSales),
    percentChange: Math.abs(percentChange),
    diff: Math.round(diff),
    isNegative: diff < 0,
    isZeroBaseline,
    isSmartBaseline,
  };
}

/**
 * Extract item name from message (product, collection, or order)
 */
export function getItemName(message: string, topic: string): string {
  // For orders, extract the order name and amount from the message
  if (topic.toLowerCase().includes("orders")) {
    const orderMatch = message.match(/Order\s+(#\d+)\s*-\s*(\$[\d,.]+)/);
    if (orderMatch) {
      return `${orderMatch[1]} (${orderMatch[2]})`;
    }
    const numMatch = message.match(/#\d+/);
    return numMatch ? numMatch[0] : "Order";
  }

  // For other events, look for text in quotes
  const match = message.match(/"([^"]+)"/);
  return match ? match[1] : "Unknown";
}

/**
 * Extract action from message
 */
export function getAction(message: string, topic: string): string {
  if (topic.toLowerCase().includes("orders")) return "placed";
  if (topic.includes("delete")) return "deleted";
  if (topic.includes("create")) return "created";
  return "updated";
}

/**
 * Get item type from topic
 */
export function getItemType(topic: string): string {
  const lowerTopic = topic.toLowerCase();
  if (lowerTopic.includes("orders")) return "order";
  if (lowerTopic.includes("collection")) return "collection";
  if (lowerTopic.includes("inventory")) return "inventory for";
  return "product";
}
