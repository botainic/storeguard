import type { HeadersFunction, LoaderFunctionArgs, ShouldRevalidateFunction } from "react-router";
import { Link, Outlet, useLoaderData, useRouteError, useLocation, useSearchParams } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";

import { authenticate } from "../shopify.server";
import { syncProducts, needsProductSync } from "../services/productSync.server";
import { getOrCreateShop } from "../services/shopService.server";
import { initScheduler } from "../services/scheduler.server";

// Start the in-process scheduler (digest + cleanup) on first load
initScheduler();

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);

  const { session, admin } = await authenticate.admin(request);
  const resync = url.searchParams.get("resync") === "1" || url.searchParams.get("resync") === "true";

  // Ensure Shop record exists (creates on first install, clears uninstalledAt on reinstall)
  await getOrCreateShop(session.shop);

  // Sync products on first access (for baseline snapshots and delete name resolution)
  const needsSync = await needsProductSync(session.shop);
  if (needsSync || resync) {
    console.log(
      `[StoreGuard] ${resync ? "Manual resync" : "First visit"} - syncing products in background for ${session.shop}`
    );
    syncProducts(session.shop, admin, { force: resync }).catch((err) => {
      console.error(`[StoreGuard] Background sync failed:`, err);
    });
  }

  // eslint-disable-next-line no-undef
  return { apiKey: process.env.SHOPIFY_API_KEY || "" };
};

export default function App() {
  const { apiKey } = useLoaderData<typeof loader>();
  const location = useLocation();
  const [searchParams] = useSearchParams();

  const isActive = (path: string) => location.pathname.startsWith(path);

  // Preserve all Shopify embedded context params on internal navigation
  // These are required for authenticate.admin() to work on subsequent requests
  const getNavLink = (path: string) => {
    const params = new URLSearchParams();

    // Essential params for embedded auth
    const host = searchParams.get("host");
    const embedded = searchParams.get("embedded");
    const shop = searchParams.get("shop");
    const session = searchParams.get("session"); // Session ID for stored session lookup
    const locale = searchParams.get("locale");

    if (host) params.set("host", host);
    if (embedded) params.set("embedded", embedded);
    if (shop) params.set("shop", shop);
    if (session) params.set("session", session);
    if (locale) params.set("locale", locale);

    const queryString = params.toString();
    return queryString ? `${path}?${queryString}` : path;
  };

  const navLinkStyle = (active: boolean) => ({
    padding: "8px 16px",
    textDecoration: "none",
    color: active ? "#000" : "#637381",
    fontWeight: active ? 600 : 400,
    borderBottom: active ? "2px solid #000" : "2px solid transparent",
  });

  return (
    <AppProvider embedded apiKey={apiKey}>
      <nav style={{
        display: "flex",
        gap: 4,
        padding: "0 16px",
        borderBottom: "1px solid #e1e3e5",
        fontFamily: "system-ui, sans-serif",
        fontSize: 14,
      }}>
        <Link to={getNavLink("/app/changes")} style={navLinkStyle(isActive("/app/changes"))}>Changes</Link>
        <Link to={getNavLink("/app/settings")} style={navLinkStyle(isActive("/app/settings"))}>Settings</Link>
      </nav>
      <Outlet />
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

// Prevent the layout loader from re-running on child route navigation.
// The initial load authenticates with id_token from URL params, but
// child navigation (e.g., /app/changes) doesn't have those params.
// Re-running the loader would cause auth to fail.
export const shouldRevalidate: ShouldRevalidateFunction = ({
  currentUrl,
  nextUrl,
  formAction,
  defaultShouldRevalidate,
}) => {
  // Always revalidate if there's a form submission
  if (formAction) {
    return defaultShouldRevalidate;
  }

  // Don't revalidate for child route navigation within /app/*
  if (currentUrl.pathname.startsWith("/app") && nextUrl.pathname.startsWith("/app")) {
    return false;
  }

  return defaultShouldRevalidate;
};
