import type { ActionFunctionArgs, LoaderFunctionArgs, HeadersFunction } from "react-router";
import { Form, useLoaderData, useActionData, useNavigation, useRouteError, useSearchParams } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { useState } from "react";
import { authenticate } from "../shopify.server";
import { getOrCreateShop, updateShopSettings, type ShopSettings } from "../services/shopService.server";
import { getSubscriptionStatus } from "../services/stripeService.server";

interface ActionResponse {
  success: boolean;
  message: string;
  errors?: Record<string, string>;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  // Use getOrCreateShop to ensure shop record exists (handles direct navigation, reinstalls)
  const settings = await getOrCreateShop(session.shop);
  const subscription = await getSubscriptionStatus(session.shop);

  return { settings, subscription, shop: session.shop };
};

export const action = async ({ request }: ActionFunctionArgs): Promise<ActionResponse> => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();

  // Parse form values
  const alertEmail = formData.get("alertEmail") as string | null;
  const trackPrices = formData.get("trackPrices") === "on";
  const trackVisibility = formData.get("trackVisibility") === "on";
  const trackInventory = formData.get("trackInventory") === "on";
  const trackThemes = formData.get("trackThemes") === "on";

  // Validate emails (supports multiple comma-separated)
  const trimmedEmail = alertEmail?.trim() || null;
  if (trimmedEmail) {
    const { valid, invalidEmails } = validateEmails(trimmedEmail);
    if (!valid) {
      return {
        success: false,
        message: `Invalid email${invalidEmails.length > 1 ? "s" : ""}: ${invalidEmails.join(", ")}`,
        errors: { alertEmail: "One or more email addresses are invalid" },
      };
    }
  }

  try {
    await updateShopSettings(session.shop, {
      alertEmail: trimmedEmail,
      trackPrices,
      trackVisibility,
      trackInventory,
      trackThemes,
    });

    return { success: true, message: "Settings saved successfully." };
  } catch (error) {
    console.error("[StoreGuard] Failed to update settings:", error);
    return { success: false, message: "Failed to save settings. Please try again." };
  }
};

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function validateEmails(emailString: string): { valid: boolean; invalidEmails: string[] } {
  if (!emailString.trim()) return { valid: true, invalidEmails: [] };
  const emails = emailString.split(",").map(e => e.trim()).filter(e => e);
  const invalidEmails = emails.filter(e => !isValidEmail(e));
  return { valid: invalidEmails.length === 0, invalidEmails };
}

export default function Settings() {
  const { settings, subscription } = useLoaderData<typeof loader>();
  const actionData = useActionData<ActionResponse>();
  const navigation = useNavigation();
  const [searchParams] = useSearchParams();
  const isSubmitting = navigation.state === "submitting";
  const [billingLoading, setBillingLoading] = useState(false);
  const [billingError, setBillingError] = useState<string | null>(null);

  // Check for billing return messages
  const upgraded = searchParams.get("upgraded") === "true";
  const canceled = searchParams.get("canceled") === "true";

  // Handle billing redirect (Stripe Checkout or Customer Portal)
  const handleBillingRedirect = async (action?: string) => {
    setBillingLoading(true);
    setBillingError(null);

    try {
      const url = action ? `/api/billing/checkout?action=${action}` : "/api/billing/checkout";
      const response = await fetch(url, { method: "POST" });
      const data = await response.json();

      if (data.error) {
        setBillingError(data.error);
        setBillingLoading(false);
        return;
      }

      if (data.redirectUrl) {
        // Use window.open with _top to break out of the iframe
        window.open(data.redirectUrl, "_top");
      }
    } catch (error) {
      setBillingError("Failed to connect to billing. Please try again.");
      setBillingLoading(false);
    }
  };

  return (
    <div style={{ padding: 16, fontFamily: "system-ui, sans-serif", maxWidth: 600 }}>
      <h1 style={{ fontSize: 24, fontWeight: 600, marginBottom: 8 }}>Settings</h1>
      <p style={{ color: "#637381", marginBottom: 24 }}>
        Configure what changes StoreGuard tracks and where to send alerts.
      </p>

      {/* Billing return messages */}
      {upgraded && (
        <div
          style={{
            padding: 12,
            marginBottom: 24,
            borderRadius: 8,
            background: "#f0fdf4",
            border: "1px solid #bbf7d0",
            color: "#166534",
          }}
        >
          Welcome to Pro! Your subscription is now active.
        </div>
      )}
      {canceled && (
        <div
          style={{
            padding: 12,
            marginBottom: 24,
            borderRadius: 8,
            background: "#fefce8",
            border: "1px solid #fef08a",
            color: "#854d0e",
          }}
        >
          Checkout was canceled. You can upgrade anytime.
        </div>
      )}

      <Form method="post">
        {/* Email Section */}
        <Section title="Daily Digest Recipients">
          <p style={{ color: "#637381", fontSize: 14, marginBottom: 12 }}>
            Receive a daily summary of all detected changes.
          </p>
          <div style={{ marginBottom: 8 }}>
            <label
              htmlFor="alertEmail"
              style={{ display: "block", fontSize: 14, fontWeight: 500, marginBottom: 4 }}
            >
              Email addresses
            </label>
            <input
              type="text"
              id="alertEmail"
              name="alertEmail"
              defaultValue={settings.alertEmail || ""}
              placeholder="alerts@yourstore.com, team@yourstore.com"
              style={{
                width: "100%",
                padding: "10px 12px",
                fontSize: 14,
                border: actionData?.errors?.alertEmail ? "1px solid #dc2626" : "1px solid #c9cccf",
                borderRadius: 8,
                outline: "none",
                boxSizing: "border-box",
              }}
            />
            {actionData?.errors?.alertEmail && (
              <div style={{ color: "#991b1b", fontSize: 12, marginTop: 4 }}>
                {actionData.errors.alertEmail}
              </div>
            )}
            <div style={{ color: "#8c9196", fontSize: 12, marginTop: 6 }}>
              Add multiple recipients separated by commas. Leave empty to disable.
            </div>
          </div>
        </Section>

        {/* Tracking Toggles Section */}
        <Section title="Change Tracking">
          <p style={{ color: "#637381", fontSize: 14, marginBottom: 16 }}>
            Choose which types of changes to track and include in your digest.
          </p>

          <Toggle
            name="trackPrices"
            label="Price changes"
            description="Track when product variant prices are modified"
            defaultChecked={settings.trackPrices}
          />

          <Toggle
            name="trackVisibility"
            label="Visibility changes"
            description="Track when products are published, hidden, or archived"
            defaultChecked={settings.trackVisibility}
          />

          <Toggle
            name="trackInventory"
            label="Out of stock alerts"
            description="Track when inventory drops to zero"
            defaultChecked={settings.trackInventory}
          />

          <Toggle
            name="trackThemes"
            label="Theme publishes"
            description="Track when a new theme becomes your live theme"
            defaultChecked={settings.trackThemes}
            disabled={settings.plan !== "pro"}
            proOnly
          />
        </Section>

        {/* Plan Info */}
        <Section title="Your Plan">
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginBottom: 12,
            }}
          >
            <span
              style={{
                padding: "4px 12px",
                borderRadius: 12,
                fontSize: 13,
                fontWeight: 600,
                background: settings.plan === "pro" ? "#dbeafe" : "#f3f4f6",
                color: settings.plan === "pro" ? "#1d4ed8" : "#374151",
              }}
            >
              {settings.plan === "pro" ? "Pro" : "Free"}
            </span>
            {settings.plan === "pro" && (
              <span style={{ color: "#166534", fontSize: 13 }}>Active subscription</span>
            )}
          </div>

          {billingError && (
            <div
              style={{
                padding: 12,
                marginBottom: 16,
                borderRadius: 8,
                background: "#fef2f2",
                border: "1px solid #fecaca",
                color: "#991b1b",
                fontSize: 14,
              }}
            >
              {billingError}
            </div>
          )}

          {settings.plan === "free" ? (
            <>
              <p style={{ color: "#637381", fontSize: 14, marginBottom: 16 }}>
                Upgrade to Pro for $19/month to unlock:
              </p>
              <ul style={{ color: "#374151", fontSize: 14, marginBottom: 16, paddingLeft: 20 }}>
                <li>Theme publish alerts</li>
                <li>Unlimited products</li>
                <li>90 days of history</li>
              </ul>
              <button
                type="button"
                onClick={() => handleBillingRedirect()}
                disabled={billingLoading}
                style={{
                  background: billingLoading ? "#93c5fd" : "#1d4ed8",
                  color: "#fff",
                  padding: "12px 24px",
                  fontSize: 14,
                  fontWeight: 500,
                  border: "none",
                  borderRadius: 8,
                  cursor: billingLoading ? "not-allowed" : "pointer",
                  width: "100%",
                }}
              >
                {billingLoading ? "Redirecting..." : "Upgrade to Pro — $19/month"}
              </button>
            </>
          ) : (
            <>
              <p style={{ color: "#637381", fontSize: 14, marginBottom: 16 }}>
                You have full access to all Pro features.
              </p>
              <button
                type="button"
                onClick={() => handleBillingRedirect("portal")}
                disabled={billingLoading}
                style={{
                  background: "#fff",
                  color: "#374151",
                  padding: "12px 24px",
                  fontSize: 14,
                  fontWeight: 500,
                  border: "1px solid #d1d5db",
                  borderRadius: 8,
                  cursor: billingLoading ? "not-allowed" : "pointer",
                  width: "100%",
                }}
              >
                {billingLoading ? "Redirecting..." : "Manage subscription"}
              </button>
            </>
          )}
        </Section>

        {/* Submit Button */}
        <div style={{ marginTop: 24, display: "flex", flexDirection: "column", gap: 12 }}>
          <button
            type="submit"
            disabled={isSubmitting}
            style={{
              background: isSubmitting ? "#9ca3af" : "#000",
              color: "#fff",
              padding: "12px 24px",
              fontSize: 14,
              fontWeight: 500,
              border: "none",
              borderRadius: 8,
              cursor: isSubmitting ? "not-allowed" : "pointer",
              width: "100%",
            }}
          >
            {isSubmitting ? "Saving..." : "Save settings"}
          </button>
          {actionData && (
            <div
              style={{
                padding: "10px 12px",
                borderRadius: 6,
                fontSize: 14,
                background: actionData.success ? "#f0fdf4" : "#fef2f2",
                color: actionData.success ? "#166534" : "#991b1b",
                textAlign: "center",
              }}
            >
              {actionData.message}
            </div>
          )}
        </div>
      </Form>
    </div>
  );
}

// Section component for grouping settings
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        background: "#fff",
        border: "1px solid #e1e3e5",
        borderRadius: 12,
        padding: "16px",
        marginBottom: 16,
      }}
    >
      <h2 style={{ fontSize: 15, fontWeight: 600, marginBottom: 12, color: "#202223" }}>{title}</h2>
      {children}
    </div>
  );
}

// Toggle component for feature switches
function Toggle({
  name,
  label,
  description,
  defaultChecked,
  disabled = false,
  proOnly = false,
}: {
  name: string;
  label: string;
  description: string;
  defaultChecked: boolean;
  disabled?: boolean;
  proOnly?: boolean;
}) {
  return (
    <label
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 12,
        padding: "12px 0",
        borderBottom: "1px solid #f3f4f6",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.6 : 1,
      }}
    >
      <input
        type="checkbox"
        name={name}
        defaultChecked={defaultChecked}
        disabled={disabled}
        style={{
          width: 20,
          height: 20,
          marginTop: 2,
          accentColor: "#000",
          cursor: disabled ? "not-allowed" : "pointer",
        }}
      />
      <div style={{ flex: 1 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 14, fontWeight: 500 }}>{label}</span>
          {proOnly && (
            <span
              style={{
                padding: "2px 6px",
                borderRadius: 4,
                fontSize: 10,
                fontWeight: 600,
                background: "#dbeafe",
                color: "#1d4ed8",
              }}
            >
              PRO
            </span>
          )}
        </div>
        <div style={{ fontSize: 13, color: "#637381", marginTop: 2 }}>{description}</div>
      </div>
    </label>
  );
}

// Required for Shopify to handle exit-iframe redirect via App Bridge
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
