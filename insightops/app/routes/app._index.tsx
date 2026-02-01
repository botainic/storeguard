import type { LoaderFunctionArgs, HeadersFunction } from "react-router";
import { redirect, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";

// StoreGuard: Redirect to Changes page (the main view)
// Uses server-side redirect to preserve all Shopify URL params
export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);

  // Preserve all query params when redirecting to /app/changes
  const url = new URL(request.url);
  const params = url.searchParams.toString();
  throw redirect(`/app/changes${params ? `?${params}` : ""}`);
};

// Required for Shopify to handle exit-iframe redirect via App Bridge
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
