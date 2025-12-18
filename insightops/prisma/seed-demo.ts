/**
 * Demo Seed Script for Marketing Screenshots & Videos
 *
 * Run with: npx tsx prisma/seed-demo.ts
 *
 * Creates realistic data to showcase InsightOps:
 * - Activity feed with Staff/Bot avatars and detailed diffs
 * - Order events that create a sales chart pattern
 * - A "story" where a price mistake causes a sales dip, then recovery
 *
 * After running, access the app with ?demo=true to use generated chart data:
 *   https://insightops-app.fly.dev/app?demo=true
 *
 * Or run against your local dev store for real data screenshots.
 */

import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

// Your test store's shop domain
const SHOP = process.env.DEMO_SHOP || "insight-ops-dev.myshopify.com";

// Realistic staff names for variety
const STAFF = [
  "Sarah Chen",
  "Marcus Johnson",
  "Emily Rodriguez",
  "Jake Thompson",
];

// Bot/App names
const BOTS = [
  "System/App",
  "Shopify Flow",
  "Inventory Sync",
];

// Realistic products for a lifestyle/apparel store
const PRODUCTS = [
  { id: "8001", name: "Premium Wireless Headphones", price: 149.99, category: "electronics" },
  { id: "8002", name: "Organic Cotton T-Shirt", price: 34.99, category: "apparel" },
  { id: "8003", name: "Leather Messenger Bag", price: 189.00, category: "accessories" },
  { id: "8004", name: "Stainless Steel Water Bottle", price: 29.99, category: "lifestyle" },
  { id: "8005", name: "Yoga Mat Pro", price: 79.99, category: "fitness" },
  { id: "8006", name: "Bluetooth Speaker Mini", price: 59.99, category: "electronics" },
  { id: "8007", name: "Running Shoes Elite", price: 129.00, category: "footwear" },
  { id: "8008", name: "Smart Watch Band", price: 24.99, category: "accessories" },
  { id: "8009", name: "Ceramic Coffee Mug Set", price: 44.99, category: "home" },
  { id: "8010", name: "Bamboo Desk Organizer", price: 39.99, category: "office" },
];

const COLLECTIONS = [
  { id: "9001", name: "Summer Sale 2025" },
  { id: "9002", name: "New Arrivals" },
  { id: "9003", name: "Best Sellers" },
  { id: "9004", name: "Holiday Gift Guide" },
];

interface DemoEvent {
  shopifyId: string;
  topic: string;
  author: string;
  message: string;
  diff: string | null;
  hoursAgo: number;
  minutesAgo?: number; // For fine-grained timing
}

function randomChoice<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function createDemoEvents(): DemoEvent[] {
  const events: DemoEvent[] = [];

  // ============================================
  // THE STORY: A Day at the Store
  // ============================================
  // Morning: Normal operations
  // ~4 hours ago: Marcus accidentally drops price from $149 to $49
  // ~3-4 hours ago: Sales tank (suspicious activity)
  // ~2 hours ago: Sarah notices and fixes the price
  // ~1-2 hours ago: Sales recover
  // Recent: Normal activity continues
  // ============================================

  // === THE MISTAKE (4 hours ago) ===
  events.push({
    shopifyId: `gid://shopify/Product/${PRODUCTS[0].id}`,
    topic: "products/update",
    author: "Marcus Johnson",
    message: `Marcus Johnson updated "${PRODUCTS[0].name}"`,
    diff: JSON.stringify({
      changes: [
        { field: "price", label: "Price", old: "$149.99", new: "$49.99" },
      ],
      snapshot: { title: PRODUCTS[0].name, price: "49.99" },
    }),
    hoursAgo: 4,
  });

  // === THE FIX (2 hours ago) ===
  events.push({
    shopifyId: `gid://shopify/Product/${PRODUCTS[0].id}`,
    topic: "products/update",
    author: "Sarah Chen",
    message: `Sarah Chen updated "${PRODUCTS[0].name}"`,
    diff: JSON.stringify({
      changes: [
        { field: "price", label: "Price", old: "$49.99", new: "$149.99" },
      ],
      snapshot: { title: PRODUCTS[0].name, price: "149.99" },
    }),
    hoursAgo: 2,
  });

  // === MORNING ACTIVITY (Earlier in the day) ===

  // Product description update
  events.push({
    shopifyId: `gid://shopify/Product/${PRODUCTS[2].id}`,
    topic: "products/update",
    author: "Emily Rodriguez",
    message: `Emily Rodriguez updated "${PRODUCTS[2].name}"`,
    diff: JSON.stringify({
      changes: [
        { field: "description", label: "Description", old: "Leather messenger bag", new: "Premium full-grain leather messenger bag with brass hardware. Fits 15\" laptop." },
        { field: "price", label: "Price", old: "$189.00", new: "$169.00" },
      ],
      snapshot: { title: PRODUCTS[2].name, price: "169.00" },
    }),
    hoursAgo: 6,
  });

  // New product created
  events.push({
    shopifyId: `gid://shopify/Product/${PRODUCTS[4].id}`,
    topic: "products/create",
    author: "Jake Thompson",
    message: `Jake Thompson created "${PRODUCTS[4].name}"`,
    diff: JSON.stringify({
      changes: [],
      snapshot: { title: PRODUCTS[4].name, price: "79.99", status: "active" },
    }),
    hoursAgo: 7,
  });

  // Inventory adjustment by bot
  events.push({
    shopifyId: `gid://shopify/Product/${PRODUCTS[1].id}`,
    topic: "inventory_levels/update",
    author: "Inventory Sync",
    message: `Inventory Sync adjusted inventory for "${PRODUCTS[1].name}"`,
    diff: JSON.stringify({
      changes: [
        { field: "inventory", label: "Stock", old: "150", new: "12" },
      ],
      snapshot: { title: PRODUCTS[1].name, inventory: 12 },
    }),
    hoursAgo: 5,
  });

  // Status change
  events.push({
    shopifyId: `gid://shopify/Product/${PRODUCTS[3].id}`,
    topic: "products/update",
    author: "Sarah Chen",
    message: `Sarah Chen updated "${PRODUCTS[3].name}"`,
    diff: JSON.stringify({
      changes: [
        { field: "status", label: "Status", old: "Draft", new: "Active" },
      ],
      snapshot: { title: PRODUCTS[3].name, status: "active" },
    }),
    hoursAgo: 8,
  });

  // Collection created
  events.push({
    shopifyId: `gid://shopify/Collection/${COLLECTIONS[0].id}`,
    topic: "collections/create",
    author: "Emily Rodriguez",
    message: `Emily Rodriguez created collection "${COLLECTIONS[0].name}"`,
    diff: null,
    hoursAgo: 9,
  });

  // Shopify Flow automation
  events.push({
    shopifyId: `gid://shopify/Product/${PRODUCTS[5].id}`,
    topic: "products/update",
    author: "Shopify Flow",
    message: `Shopify Flow updated "${PRODUCTS[5].name}"`,
    diff: JSON.stringify({
      changes: [
        { field: "tags", label: "Tags", old: "electronics", new: "electronics, on-sale, featured" },
      ],
      snapshot: { title: PRODUCTS[5].name, tags: ["electronics", "on-sale", "featured"] },
    }),
    hoursAgo: 3,
  });

  // === RECENT ACTIVITY (Last 2 hours) ===

  // Image update
  events.push({
    shopifyId: `gid://shopify/Product/${PRODUCTS[6].id}`,
    topic: "products/update",
    author: "Jake Thompson",
    message: `Jake Thompson updated "${PRODUCTS[6].name}"`,
    diff: JSON.stringify({
      changes: [
        { field: "images", label: "Images", old: "2 images", new: "5 images" },
      ],
      snapshot: { title: PRODUCTS[6].name, imageCount: 5 },
    }),
    hoursAgo: 1,
    minutesAgo: 30,
  });

  // Compare-at price (sale setup)
  events.push({
    shopifyId: `gid://shopify/Product/${PRODUCTS[7].id}`,
    topic: "products/update",
    author: "Sarah Chen",
    message: `Sarah Chen updated "${PRODUCTS[7].name}"`,
    diff: JSON.stringify({
      changes: [
        { field: "compareAtPrice", label: "Compare Price", old: "none", new: "$34.99" },
        { field: "price", label: "Price", old: "$24.99", new: "$19.99" },
      ],
      snapshot: { title: PRODUCTS[7].name, price: "19.99", compareAtPrice: "34.99" },
    }),
    hoursAgo: 1,
  });

  // Inventory restock
  events.push({
    shopifyId: `gid://shopify/Product/${PRODUCTS[0].id}`,
    topic: "inventory_levels/update",
    author: "System/App",
    message: `System/App adjusted inventory for "${PRODUCTS[0].name}"`,
    diff: JSON.stringify({
      changes: [
        { field: "inventory", label: "Stock", old: "45", new: "42" },
      ],
    }),
    hoursAgo: 0,
    minutesAgo: 45,
  });

  // Very recent update
  events.push({
    shopifyId: `gid://shopify/Product/${PRODUCTS[8].id}`,
    topic: "products/update",
    author: "Marcus Johnson",
    message: `Marcus Johnson updated "${PRODUCTS[8].name}"`,
    diff: JSON.stringify({
      changes: [
        { field: "title", label: "Title", old: "Coffee Mug Set", new: "Ceramic Coffee Mug Set" },
        { field: "vendor", label: "Vendor", old: "Generic", new: "Artisan Co." },
      ],
      snapshot: { title: PRODUCTS[8].name },
    }),
    hoursAgo: 0,
    minutesAgo: 20,
  });

  // Collection update
  events.push({
    shopifyId: `gid://shopify/Collection/${COLLECTIONS[1].id}`,
    topic: "collections/update",
    author: "Emily Rodriguez",
    message: `Emily Rodriguez updated collection "${COLLECTIONS[1].name}"`,
    diff: null,
    hoursAgo: 0,
    minutesAgo: 10,
  });

  // === OLDER ACTIVITY (For Pro users viewing 7d range) ===

  // Product deleted 2 days ago
  events.push({
    shopifyId: "gid://shopify/Product/9999",
    topic: "products/delete",
    author: "Jake Thompson",
    message: `Jake Thompson deleted "Discontinued Winter Jacket"`,
    diff: null,
    hoursAgo: 48,
  });

  // Big inventory update 3 days ago
  events.push({
    shopifyId: `gid://shopify/Product/${PRODUCTS[2].id}`,
    topic: "inventory_levels/update",
    author: "Inventory Sync",
    message: `Inventory Sync adjusted inventory for "${PRODUCTS[2].name}"`,
    diff: JSON.stringify({
      changes: [
        { field: "inventory", label: "Stock", old: "0", new: "50" },
      ],
      snapshot: { title: PRODUCTS[2].name, inventory: 50 },
    }),
    hoursAgo: 72,
  });

  return events;
}

function createOrderEvents(): DemoEvent[] {
  const orders: DemoEvent[] = [];
  const now = new Date();

  // Generate orders for the past 12 hours with a pattern
  // More orders = more sales in the chart

  // Order amounts vary by time of day
  const getOrderPattern = (hoursAgo: number): { count: number; avgAmount: number } => {
    // THE DIP: 4-5 hours ago (when wrong price was active)
    if (hoursAgo >= 3.5 && hoursAgo <= 5) {
      return { count: 2, avgAmount: 35 }; // Very few, cheap orders
    }
    // RECOVERING: 2-3.5 hours ago
    if (hoursAgo >= 2 && hoursAgo < 3.5) {
      return { count: 4, avgAmount: 65 };
    }
    // RECOVERED: After fix
    if (hoursAgo >= 1 && hoursAgo < 2) {
      return { count: 6, avgAmount: 95 };
    }
    // RECENT: Last hour - back to normal
    if (hoursAgo < 1) {
      return { count: 5, avgAmount: 110 };
    }
    // NORMAL: Before the incident
    return { count: 5, avgAmount: 100 };
  };

  let orderNumber = 1001;

  // Generate orders for each hour
  for (let h = 12; h >= 0; h -= 0.5) {
    const pattern = getOrderPattern(h);

    for (let i = 0; i < pattern.count; i++) {
      const amount = pattern.avgAmount + (Math.random() - 0.5) * pattern.avgAmount * 0.4;
      const product = randomChoice(PRODUCTS);
      const quantity = Math.ceil(Math.random() * 3);

      const orderId = 1000000 + orderNumber;
      const orderName = `#${orderNumber}`;
      orderNumber++;

      const minutesVariation = Math.random() * 25; // Spread within the half-hour

      orders.push({
        shopifyId: String(orderId),
        topic: "ORDERS_CREATE",
        author: "Customer",
        message: `💰 Order ${orderName} - $${amount.toFixed(2)}`,
        diff: JSON.stringify({
          orderId,
          orderName,
          total: amount.toFixed(2),
          subtotal: (amount * 0.9).toFixed(2),
          currency: "USD",
          status: "paid",
          itemCount: quantity,
          itemSummary: quantity === 1 ? product.name : `${quantity} items`,
          items: [{
            title: product.name,
            variant: null,
            quantity,
            price: (amount / quantity).toFixed(2),
            productId: parseInt(product.id),
          }],
          discounts: [],
        }),
        hoursAgo: h,
        minutesAgo: minutesVariation,
      });
    }
  }

  return orders;
}

async function seed() {
  console.log("🌱 Seeding demo data for screenshots & videos...\n");
  console.log(`   Shop: ${SHOP}`);

  // Clear existing data for this shop
  const deleted = await db.eventLog.deleteMany({
    where: { shop: SHOP },
  });
  console.log(`   Cleared ${deleted.count} existing events\n`);

  const activityEvents = createDemoEvents();
  const orderEvents = createOrderEvents();
  const allEvents = [...activityEvents, ...orderEvents];
  const now = new Date();

  console.log("📝 Creating activity events...\n");

  for (const event of activityEvents) {
    const hoursMs = event.hoursAgo * 60 * 60 * 1000;
    const minutesMs = (event.minutesAgo || 0) * 60 * 1000;
    const timestamp = new Date(now.getTime() - hoursMs - minutesMs);

    await db.eventLog.create({
      data: {
        shop: SHOP,
        shopifyId: event.shopifyId,
        topic: event.topic,
        author: event.author,
        message: event.message,
        diff: event.diff,
        timestamp,
        webhookId: `demo-activity-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      },
    });

    const isBot = ["System/App", "Shopify Flow", "Inventory Sync"].includes(event.author);
    const icon = isBot ? "🤖" : "👤";
    const timeAgo = event.hoursAgo < 1
      ? `${event.minutesAgo || 0}m ago`
      : `${event.hoursAgo}h ago`;
    console.log(`   ${icon} ${event.author.padEnd(16)} │ ${event.topic.padEnd(22)} │ ${timeAgo}`);
  }

  console.log(`\n💰 Creating ${orderEvents.length} order events...\n`);

  let orderCount = 0;
  for (const event of orderEvents) {
    const hoursMs = event.hoursAgo * 60 * 60 * 1000;
    const minutesMs = (event.minutesAgo || 0) * 60 * 1000;
    const timestamp = new Date(now.getTime() - hoursMs - minutesMs);

    await db.eventLog.create({
      data: {
        shop: SHOP,
        shopifyId: event.shopifyId,
        topic: event.topic,
        author: event.author,
        message: event.message,
        diff: event.diff,
        timestamp,
        webhookId: `demo-order-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      },
    });
    orderCount++;
  }
  console.log(`   Created ${orderCount} orders with sales pattern showing the price mistake impact`);

  console.log(`\n✅ Created ${allEvents.length} total events`);

  console.log("\n" + "═".repeat(60));
  console.log("📸 SCREENSHOT & VIDEO CHECKLIST");
  console.log("═".repeat(60));
  console.log(`
1. THE HERO SHOT (Sales Impact):
   - Access: ${process.env.SHOPIFY_APP_URL || 'https://insightops-app.fly.dev'}/app?demo=true
   - Click on the price drop event (~4h ago)
   - Show the before/after sales dip in the chart

2. ACTIVITY FEED (Staff vs Bots):
   - Mix of 👤 staff avatars and 🤖 bot avatars
   - Show variety: price changes, inventory, collections

3. DIFF CARDS:
   - Hover over events to show detailed change diffs
   - Price: $149.99 → $49.99 (the mistake)
   - Price: $49.99 → $149.99 (the fix)
   - Inventory: 150 → 12 (low stock alert)

4. PRO FEATURES:
   - Switch to "7d" or "30d" view
   - Show longer history and Week-over-Week comparison

💡 TIP: Use "Today" view for the price mistake story
💡 TIP: Add ?demo=true to URL for fake chart data if no real orders
`);
}

seed()
  .catch((e) => {
    console.error("❌ Seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
