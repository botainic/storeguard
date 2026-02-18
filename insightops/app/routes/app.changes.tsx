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
  contextData: string | null;
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

export default function RecentChanges() {
  const { events } = useLoaderData<typeof loader>();

  return (
    <div style={{ padding: 16, fontFamily: "system-ui, sans-serif", maxWidth: 800 }}>
      <h1 style={{ fontSize: 22, fontWeight: 600, marginBottom: 8, color: "#202223" }}>Recent Changes</h1>
      <p style={{ color: "#637381", marginBottom: 20, fontSize: 14 }}>
        Your store's detected changes from the last 50 events.
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
                  borderLeft: `3px solid ${config.color}`,
                  borderRadius: 8,
                  padding: "12px 14px",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: 8,
                    marginBottom: 8,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                    <span
                      style={{
                        background: config.color,
                        color: "#fff",
                        padding: "3px 10px",
                        borderRadius: 4,
                        fontSize: 11,
                        fontWeight: 500,
                        textTransform: "uppercase",
                        letterSpacing: "0.5px",
                      }}
                    >
                      {config.label}
                    </span>
                    <span
                      style={{
                        background: "#f4f6f8",
                        color: importance.color,
                        padding: "3px 8px",
                        borderRadius: 4,
                        fontSize: 11,
                        fontWeight: 500,
                      }}
                    >
                      {importance.label}
                    </span>
                  </div>
                  <span style={{ color: "#8c9196", fontSize: 12 }}>
                    {detectedDate.toLocaleDateString()}
                  </span>
                </div>

                <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 6, color: "#202223" }}>
                  {event.resourceName}
                </div>

                {(event.beforeValue || event.afterValue) && (
                  <div
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      gap: 6,
                      alignItems: "center",
                      fontSize: 13,
                    }}
                  >
                    {event.beforeValue && (
                      <span
                        style={{
                          background: "#fef2f2",
                          color: "#b91c1c",
                          padding: "4px 10px",
                          borderRadius: 4,
                          textDecoration: "line-through",
                        }}
                      >
                        {event.beforeValue}
                      </span>
                    )}
                    {event.beforeValue && event.afterValue && (
                      <span style={{ color: "#9ca3af" }}>→</span>
                    )}
                    {event.afterValue && (
                      <span
                        style={{
                          background: "#f0fdf4",
                          color: "#15803d",
                          padding: "4px 10px",
                          borderRadius: 4,
                        }}
                      >
                        {event.afterValue}
                      </span>
                    )}
                  </div>
                )}

                {event.contextData && (() => {
                  try {
                    const ctx = JSON.parse(event.contextData) as {
                      velocityContext?: string | null;
                      revenueImpact?: number | null;
                    };
                    if (!ctx.velocityContext && ctx.revenueImpact === null) return null;
                    return (
                      <div style={{ marginTop: 6, fontSize: 12, color: "#6b7280" }}>
                        {ctx.velocityContext && (
                          <span style={{ marginRight: 8 }}>{ctx.velocityContext}</span>
                        )}
                        {ctx.revenueImpact !== null && ctx.revenueImpact !== undefined && (
                          <span style={{ color: "#dc2626", fontWeight: 500 }}>
                            ~${ctx.revenueImpact.toFixed(2)}/hr impact
                          </span>
                        )}
                      </div>
                    );
                  } catch {
                    return null;
                  }
                })()}

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
