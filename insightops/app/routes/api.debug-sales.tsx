import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);

  // Fetch orders from today
  const response = await admin.graphql(
    `#graphql
      query GetOrders($query: String!) {
        orders(first: 50, query: $query) {
          edges {
            node {
              id
              name
              createdAt
              totalPriceSet {
                shopMoney {
                  amount
                  currencyCode
                }
              }
            }
          }
        }
      }
    `,
    {
      variables: {
        query: `created_at:>=${startOfToday.toISOString()}`,
      },
    }
  );

  const data = await response.json();
  const orders = data.data?.orders?.edges || [];

  // Debug info
  const debug = {
    serverTime: {
      now: now.toISOString(),
      nowLocal: now.toLocaleString(),
      localHour: now.getHours(),
      utcHour: now.getUTCHours(),
      timezoneOffset: now.getTimezoneOffset(),
    },
    query: {
      startOfToday: startOfToday.toISOString(),
      startOfTodayLocal: startOfToday.toLocaleString(),
    },
    orders: orders.map((edge: { node: { id: string; name: string; createdAt: string; totalPriceSet: { shopMoney: { amount: string; currencyCode: string } } } }) => ({
      id: edge.node.id,
      name: edge.node.name,
      createdAt: edge.node.createdAt,
      createdAtLocal: new Date(edge.node.createdAt).toLocaleString(),
      amount: edge.node.totalPriceSet.shopMoney.amount,
      currency: edge.node.totalPriceSet.shopMoney.currencyCode,
    })),
    totalOrders: orders.length,
    totalSales: orders.reduce((sum: number, edge: { node: { totalPriceSet: { shopMoney: { amount: string } } } }) =>
      sum + parseFloat(edge.node.totalPriceSet.shopMoney.amount), 0
    ),
  };

  return new Response(JSON.stringify(debug, null, 2), {
    headers: { "Content-Type": "application/json" },
  });
};

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
