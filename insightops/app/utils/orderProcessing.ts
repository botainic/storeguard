/**
 * Order Processing Utility Functions
 * Extracted for testing and reuse
 */

export interface LineItem {
  title: string;
  quantity: number;
  price: string;
  variant_title: string | null;
  product_id: number | null;
}

export interface OrderPayload {
  id: number;
  name: string;
  total_price: string;
  subtotal_price: string;
  currency: string;
  financial_status: string;
  created_at: string;
  line_items: LineItem[];
  discount_codes: Array<{ code: string; amount: string }>;
}

export interface ProcessedOrder {
  message: string;
  diff: string;
  shopifyId: string;
  itemCount: number;
  itemSummary: string;
  formattedAmount: string;
}

/**
 * Calculate total item count from line items
 */
export function calculateItemCount(lineItems: LineItem[]): number {
  return lineItems.reduce((sum, item) => sum + item.quantity, 0);
}

/**
 * Generate item summary string
 */
export function generateItemSummary(lineItems: LineItem[]): string {
  const itemCount = calculateItemCount(lineItems);
  const firstItem = lineItems[0]?.title || "items";
  return itemCount === 1 ? firstItem : `${itemCount} items`;
}

/**
 * Format currency amount
 */
export function formatAmount(amount: string, currency: string): string {
  const parsed = parseFloat(amount);
  return parsed.toLocaleString("en-US", {
    style: "currency",
    currency: currency || "USD",
  });
}

/**
 * Generate order message for timeline display
 */
export function generateOrderMessage(orderName: string, formattedAmount: string): string {
  return `💰 Order ${orderName} - ${formattedAmount}`;
}

/**
 * Build order diff JSON for storage
 */
export function buildOrderDiff(order: OrderPayload, itemCount: number, itemSummary: string): string {
  return JSON.stringify({
    orderId: order.id,
    orderName: order.name,
    total: order.total_price,
    subtotal: order.subtotal_price,
    currency: order.currency,
    status: order.financial_status,
    itemCount,
    itemSummary,
    items: order.line_items.map((item) => ({
      title: item.title,
      variant: item.variant_title,
      quantity: item.quantity,
      price: item.price,
      productId: item.product_id,
    })),
    discounts: order.discount_codes,
  });
}

/**
 * Process an order payload into structured data for storage
 */
export function processOrderPayload(order: OrderPayload): ProcessedOrder {
  const itemCount = calculateItemCount(order.line_items);
  const itemSummary = generateItemSummary(order.line_items);
  const formattedAmount = formatAmount(order.total_price, order.currency);
  const message = generateOrderMessage(order.name, formattedAmount);
  const diff = buildOrderDiff(order, itemCount, itemSummary);

  return {
    message,
    diff,
    shopifyId: String(order.id),
    itemCount,
    itemSummary,
    formattedAmount,
  };
}
