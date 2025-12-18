# InsightOps

**Real-time store activity monitoring and sales impact analysis for Shopify**

---

## What is InsightOps?

InsightOps is a Shopify embedded app that gives store owners and teams complete visibility into every change made to their store - and shows how those changes impact sales in real-time.

Think of it as a "security camera" for your Shopify store that doesn't just record what happened, but tells you **who** made the change, **what** exactly changed, and **how** it affected your revenue.

---

## The Problem It Solves

### 1. "Who changed this?"

Every Shopify store owner has experienced this:
- You notice a product price is wrong - who changed it?
- A product description was deleted - was it intentional?
- Inventory levels are off - what happened?

**Shopify's native admin doesn't show who made changes.** You're left guessing, scrolling through revision history, or asking your team.

### 2. "Did that change help or hurt sales?"

You update a price, change a product image, or tweak a description. But did it work?

- Was the 20% discount actually driving more sales?
- Did the new product photos help conversion?
- Should I roll back that price increase?

**Without data, you're making decisions blind.**

### 3. "What's happening in my store right now?"

If you have multiple team members, apps, or automation tools making changes, your store is constantly evolving. But you have no central view of:
- Recent activity across all products and collections
- Which team members are most active
- What automated systems are doing to your catalog

---

## How InsightOps Helps

### Real-Time Activity Feed

Every change to your products and collections appears instantly in a beautiful timeline:

- **Who**: See the exact team member or app that made the change
- **What**: Know exactly what changed (price, inventory, images, title, tags, etc.)
- **When**: Precise timestamps with relative time ("2 minutes ago")

### Sales Impact Analysis

The killer feature: **hover over any event to see its impact on sales**.

InsightOps correlates your store activity with your sales data to show:
- Sales trend before vs. after the change
- Percentage increase or decrease
- Visual chart showing the exact moment of the change

This turns guesswork into data-driven decisions.

### Comprehensive Change Tracking

InsightOps tracks **12 different fields** for every product:

| Field | Description |
|-------|-------------|
| Title | Product name changes |
| Description | Body content updates |
| Price | Primary variant pricing |
| Compare-at Price | Sale/discount pricing |
| Inventory | Stock level changes |
| Status | Active/Draft/Archived |
| Images | Photo additions/removals |
| Tags | Tag modifications |
| Vendor | Vendor field changes |
| Product Type | Category changes |
| SKU | SKU updates |
| Options | Variant options (Size, Color, etc.) |

Plus full collection tracking (create, update, delete).

---

## Technical Architecture

### Built for Reliability

InsightOps uses a **background job queue** architecture that ensures:

1. **No webhook timeouts**: Shopify requires webhook responses within 5 seconds. InsightOps acknowledges webhooks immediately and processes them in the background.

2. **Automatic retries**: If processing fails (network issues, API limits), jobs retry automatically with exponential backoff (2s, 4s, 8s).

3. **Deduplication**: Shopify occasionally sends duplicate webhooks. InsightOps uses webhook IDs to prevent duplicate events.

4. **No external dependencies**: Uses SQLite for job queue - no Redis or external services needed.

### Technology Stack

| Component | Technology |
|-----------|------------|
| Framework | React Router 7 + Shopify App Bridge |
| Database | Prisma + SQLite |
| Charts | Recharts |
| Styling | CSS-in-JS (zero dependencies) |
| API | Shopify Admin GraphQL + REST Events API |
| Analytics | ShopifyQL (with order-based fallback) |

### Data Models

```
EventLog        - Stores all tracked events with author attribution
ProductCache    - Lightweight cache for resolving product names on delete
WebhookJob      - Background job queue for reliable processing
Session         - Shopify session management
```

### Webhook Subscriptions

InsightOps listens to these Shopify webhooks:

- `products/create` - New product created
- `products/update` - Product modified
- `products/delete` - Product removed
- `collections/create` - New collection created
- `collections/update` - Collection modified
- `collections/delete` - Collection removed
- `inventory_levels/update` - Stock level changed
- `app/uninstalled` - App removal cleanup
- `app/scopes_update` - Permission changes

### Required Scopes

```
read_products    - Read product data
write_products   - Sync product cache
read_orders      - Fetch order data for sales charts
read_inventory   - Track inventory changes
read_reports     - Access ShopifyQL Analytics API
```

---

## Installation & Setup

### Prerequisites

- Node.js 20.19+ or 22.12+
- Shopify Partner account
- A Shopify development store

### Installation Steps

1. **Clone and install dependencies**
   ```bash
   cd insightops
   npm install
   ```

2. **Configure Shopify CLI**
   ```bash
   npm run config:link
   ```

3. **Set up the database**
   ```bash
   npx prisma db push
   ```

4. **Start development server**
   ```bash
   npm run dev
   ```

5. **Install on your store**

   The Shopify CLI will provide a URL to install the app on your development store.

### Production Deployment

1. **Build the app**
   ```bash
   npm run build
   ```

2. **Deploy**
   ```bash
   npm run deploy
   ```

3. **Configure your hosting** (Fly.io, Railway, Heroku, etc.)
   - Set `DATABASE_URL` environment variable
   - Run `npm run setup` before starting

---

## Dashboard Features

### KPI Cards

Three key metrics at a glance:
- **Total Sales**: Revenue for the selected period
- **Store Changes**: Number of tracked events
- **Avg / Change**: Average revenue per store change

### Sales Chart

Interactive area chart showing:
- Sales over time (hourly for today/yesterday, daily for 7/30/90 days)
- Red dashed lines marking when events occurred
- Hover interaction with event timeline

### Date Range Selector

Quick filters: Today, Yesterday, 7 Days, 30 Days, 90 Days

### Activity Timeline

Scrollable feed showing:
- Author avatar (initials for humans, bot icon for systems/apps)
- Action description with product/collection name
- Color-coded badges (Created/Updated/Deleted)
- Change details ("Price: $29.99 → $24.99")
- Relative timestamps

### Impact Analysis Banner

When you hover over an event:
- Shows sales trend comparison (before vs. after)
- Percentage change with visual indicator
- Chart highlights the exact moment

---

## How It Works

### 1. Webhook Reception

When Shopify sends a webhook:

```
Shopify → Webhook Handler → Job Queue → 200 OK (immediate)
```

The webhook handler:
- Validates the webhook signature
- Checks for duplicates
- Queues the job with a 2-second delay (for Events API propagation)
- Returns 200 OK within milliseconds

### 2. Background Processing

After the delay, the job processor:

```
Job Queue → Process Job → Shopify Events API → Database → Done
```

For each job:
1. Retrieves the session for API access
2. Fetches author attribution from Shopify Events API
3. Compares with previous snapshot to detect changes
4. Creates human-readable change summary
5. Stores the event log

### 3. Dashboard Loading

When you open the dashboard:

```
Dashboard → Fetch Events → Fetch Sales Data → Render
```

- Events are fetched from the local database (fast)
- Sales data uses ShopifyQL for aggregated data (efficient)
- Falls back to order-based queries if ShopifyQL unavailable

---

## API Endpoints

### Dashboard
`GET /app` - Main dashboard with events and sales data

Query params:
- `range`: "today" | "yesterday" | "7d" | "30d" | "90d"

### Job Processing (Internal)
`POST /api/jobs/process` - Process pending webhook jobs

---

## Performance Considerations

### Scalability

- **Unlimited products**: No arbitrary limits on product sync
- **Efficient queries**: Database indexes on shop, timestamp, and composite keys
- **Aggregated analytics**: ShopifyQL returns pre-aggregated data

### Reliability

- **Job retries**: Failed jobs retry up to 3 times
- **Cleanup**: Old completed/failed jobs auto-purge after 7 days
- **Deduplication**: Webhook IDs prevent duplicate processing

### Resource Usage

- **Minimal database**: SQLite file, typically < 50MB
- **Low API calls**: Events API called only during processing
- **No polling**: Pure webhook-driven architecture

---

## Limitations & Known Issues

1. **Author attribution delay**: Shopify's Events API can take 1-2 seconds to populate. InsightOps delays processing to handle this, but occasionally the author may show as "System/App" if the API hasn't updated yet.

2. **Delete event names**: When a product is deleted, Shopify doesn't include the product title. InsightOps maintains a cache to resolve names, but if the product was never tracked, it shows "Product #ID".

3. **Bulk operations**: Bulk updates (CSV imports, etc.) may generate many events quickly. The dashboard shows the most recent 50 events.

4. **Multi-variant products**: Currently shows changes for the first variant only. Future versions may track all variants independently.

---

## Future Roadmap

Potential enhancements:
- Email/Slack notifications for specific events
- Custom event filtering and search
- Team member analytics ("Who makes the most changes?")
- Multi-variant tracking
- Export event history to CSV
- Webhook for external integrations

---

## Support

For issues, feature requests, or contributions:
- GitHub: [Repository URL]
- Email: [Support Email]

---

## License

[Your License]

---

*Built with care for Shopify merchants who want to understand their store better.*
