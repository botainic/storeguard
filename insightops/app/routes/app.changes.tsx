import type { LoaderFunctionArgs, HeadersFunction } from "react-router";
import { useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import db from "../db.server";

interface ChangeEvent {
  id: string;
  entityType: string;
  entityId: string;
  eventType: string;
  resourceName: string;
  beforeValue: string | null;
  afterValue: string | null;
  detectedAt: string;
  source: string;
  importance: string;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  const events = await db.changeEvent.findMany({
    where: { shop: session.shop },
    orderBy: { detectedAt: "desc" },
    take: 50,
  });

  return {
    events: events.map((e) => ({
      ...e,
      detectedAt: e.detectedAt.toISOString(),
    })),
  };
};

// Event type display config
const eventConfig: Record<string, { label: string; emoji: string; color: string }> = {
  price_change: { label: "Price Change", emoji: "\uD83D\uDCB0", color: "#ffa500" },
  visibility_change: { label: "Visibility", emoji: "\uD83D\uDC41\uFE0F", color: "#9b59b6" },
  inventory_zero: { label: "Out of Stock", emoji: "\uD83D\uDEA8", color: "#e74c3c" },
  theme_publish: { label: "Theme Published", emoji: "\uD83C\uDFA8", color: "#3498db" },
};

const importanceConfig: Record<string, { label: string; color: string }> = {
  high: { label: "High", color: "#e74c3c" },
  medium: { label: "Medium", color: "#f39c12" },
  low: { label: "Low", color: "#95a5a6" },
};

export default function RecentChanges() {
  const { events } = useLoaderData<typeof loader>();

  return (
    <div style={{ padding: 16, fontFamily: "system-ui, sans-serif" }}>
      <h1 style={{ fontSize: 24, fontWeight: 600, marginBottom: 8 }}>Recent Changes</h1>
      <p style={{ color: "#637381", marginBottom: 24 }}>
        Last 50 detected changes. This page is for debugging/verification.
      </p>

      {events.length === 0 ? (
        <div
          style={{
            background: "#f4f6f8",
            borderRadius: 8,
            padding: 32,
            textAlign: "center",
            color: "#637381",
          }}
        >
          No changes detected yet. Changes will appear here when products are updated, visibility
          changes, inventory hits zero, or themes are published.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {events.map((event: ChangeEvent) => {
            const config = eventConfig[event.eventType] || {
              label: event.eventType,
              emoji: "\uD83D\uDD14",
              color: "#666",
            };
            const importance = importanceConfig[event.importance] || importanceConfig.medium;
            const detectedDate = new Date(event.detectedAt);

            return (
              <div
                key={event.id}
                style={{
                  background: "#fff",
                  border: "1px solid #e1e3e5",
                  borderLeft: `4px solid ${config.color}`,
                  borderRadius: 8,
                  padding: 16,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "flex-start",
                    marginBottom: 8,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 20 }}>{config.emoji}</span>
                    <span
                      style={{
                        background: config.color,
                        color: "#fff",
                        padding: "2px 8px",
                        borderRadius: 4,
                        fontSize: 12,
                        fontWeight: 500,
                      }}
                    >
                      {config.label}
                    </span>
                    <span
                      style={{
                        background: "#f4f6f8",
                        color: importance.color,
                        padding: "2px 8px",
                        borderRadius: 4,
                        fontSize: 12,
                        fontWeight: 500,
                        border: `1px solid ${importance.color}`,
                      }}
                    >
                      {importance.label}
                    </span>
                  </div>
                  <span style={{ color: "#637381", fontSize: 12 }}>
                    {detectedDate.toLocaleDateString()} {detectedDate.toLocaleTimeString()}
                  </span>
                </div>

                <div style={{ fontWeight: 600, fontSize: 16, marginBottom: 8 }}>
                  {event.resourceName}
                </div>

                {(event.beforeValue || event.afterValue) && (
                  <div
                    style={{
                      display: "flex",
                      gap: 8,
                      alignItems: "center",
                      fontSize: 14,
                      color: "#637381",
                    }}
                  >
                    {event.beforeValue && (
                      <span
                        style={{
                          background: "#fdf2f2",
                          color: "#991b1b",
                          padding: "2px 8px",
                          borderRadius: 4,
                          textDecoration: "line-through",
                        }}
                      >
                        {event.beforeValue}
                      </span>
                    )}
                    {event.beforeValue && event.afterValue && <span>→</span>}
                    {event.afterValue && (
                      <span
                        style={{
                          background: "#f0fdf4",
                          color: "#166534",
                          padding: "2px 8px",
                          borderRadius: 4,
                        }}
                      >
                        {event.afterValue}
                      </span>
                    )}
                  </div>
                )}

                <div
                  style={{
                    display: "flex",
                    gap: 16,
                    marginTop: 8,
                    fontSize: 11,
                    color: "#8c9196",
                  }}
                >
                  <span>Entity: {event.entityType}</span>
                  <span>ID: {event.entityId}</span>
                  <span>Source: {event.source}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Required for Shopify to handle exit-iframe redirect via App Bridge
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
