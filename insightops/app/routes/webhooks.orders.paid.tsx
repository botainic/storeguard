import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";

// Note: We intentionally don't access customer data to avoid needing
// protected customer data approval. We only use order-level info.
interface LineItem {
  title: string;
  quantity: number;
  price: string;
  variant_title: string | null;
  product_id: number | null;
}

interface OrderPayload {
  id: number;
  name: string; // Order number like "#1001"
  total_price: string;
  subtotal_price: string;
  currency: string;
  financial_status: string;
  created_at: string;
  line_items: LineItem[];
  discount_codes: Array<{ code: string; amount: string }>;
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const webhookId = request.headers.get("X-Shopify-Webhook-Id");

  const { shop, session, topic, payload } =
    await authenticate.webhook(request);

  console.log(`[StoreGuard] Received ${topic} webhook for ${shop} (ID: ${webhookId})`);

  if (!session) {
    console.log(`[StoreGuard] No session found for ${shop}, skipping order`);
    return new Response();
  }

  // Check for duplicate
  if (webhookId) {
    const existing = await db.eventLog.findFirst({
      where: { webhookId },
    });
    if (existing) {
      console.log(`[StoreGuard] Duplicate order webhook ${webhookId}, skipping`);
      return new Response();
    }
  }

  const order = payload as OrderPayload;

  // Build order summary (no customer data - just item info)
  const itemCount = order.line_items.reduce((sum, item) => sum + item.quantity, 0);
  const firstItem = order.line_items[0]?.title || "items";
  const itemSummary = itemCount === 1
    ? firstItem
    : `${itemCount} items`;

  // Format the amount
  const amount = parseFloat(order.total_price);
  const formattedAmount = amount.toLocaleString("en-US", {
    style: "currency",
    currency: order.currency || "USD",
  });

  // Create an exciting message (no customer PII)
  const message = `💰 Order ${order.name} - ${formattedAmount}`;

  // Build diff with order details (no customer data)
  const diff = JSON.stringify({
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

  // Log the order event
  await db.eventLog.create({
    data: {
      shop,
      shopifyId: String(order.id),
      topic: "ORDERS_CREATE",
      author: "Customer", // Generic - no PII
      message,
      diff,
      webhookId,
    },
  });

  console.log(`[StoreGuard] ✅ Logged order: ${message}`);

  return new Response();
};
