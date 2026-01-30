import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Outlet, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";

import { authenticate } from "../shopify.server";
import { syncProducts, needsProductSync } from "../services/productSync.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const url = new URL(request.url);
  const resync = url.searchParams.get("resync") === "1" || url.searchParams.get("resync") === "true";
  const host = url.searchParams.get("host");

  // Sync products on first access (for baseline snapshots and delete name resolution)
  // Run in background so we don't block the UI - user can start using app immediately
  const needsSync = await needsProductSync(session.shop);
  if (needsSync || resync) {
    console.log(
      `[StoreGuard] ${resync ? "Manual resync" : "First visit"} - syncing products in background for ${session.shop}`
    );
    // Fire and forget - don't await
    syncProducts(session.shop, admin, { force: resync }).catch((err) => {
      console.error(`[StoreGuard] Background sync failed:`, err);
    });
  }

  // eslint-disable-next-line no-undef
  return { apiKey: process.env.SHOPIFY_API_KEY || "", host, shop: session.shop };
};

export default function App() {
  const { apiKey, host, shop } = useLoaderData<typeof loader>();
  const isEmbedded = Boolean(host);

  return (
    <AppProvider embedded={isEmbedded} apiKey={apiKey}>
      {!isEmbedded ? (
        <div style={{ padding: 20, fontFamily: "-apple-system, BlinkMacSystemFont, \"San Francisco\", \"Segoe UI\", Roboto, \"Helvetica Neue\", sans-serif" }}>
          <div style={{ maxWidth: 720, margin: "0 auto", background: "#fff", border: "1px solid #e1e3e5", borderRadius: 12, padding: 16 }}>
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 6 }}>Open StoreGuard from Shopify Admin</div>
            <div style={{ fontSize: 13, color: "#637381", marginBottom: 12 }}>
              This page is missing the required <code>host</code> parameter, so Shopify App Bridge can't authenticate requests (you'll see "Failed to fetch").
            </div>
            <div style={{ fontSize: 13, color: "#637381" }}>
              Go to <strong>Apps → StoreGuard</strong> inside Shopify Admin for <strong>{shop}</strong>.
            </div>
          </div>
        </div>
      ) : (
        <>
          <s-app-nav>
            <s-link href="/app">Home</s-link>
          </s-app-nav>
          <Outlet />
        </>
      )}
    </AppProvider>
  );
}

// Shopify needs React Router to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
