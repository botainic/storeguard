import type { ActionFunctionArgs, LoaderFunctionArgs, HeadersFunction } from "react-router";
import { Form, useLoaderData, useActionData, useNavigation, useNavigate, useRouteError, useSearchParams } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { useState } from "react";
import { authenticate, PRO_MONTHLY_PLAN } from "../shopify.server";
import { getOrCreateShop, updateShopSettings, type ShopSettings } from "../services/shopService.server";

interface ActionResponse {
  success: boolean;
  message: string;
  errors?: Record<string, string>;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, billing } = await authenticate.admin(request);
  const settings = await getOrCreateShop(session.shop);
  
  // Check billing status via Shopify Billing API and sync to DB
  const { hasActivePayment, appSubscriptions } = await billing.check({
    plans: [PRO_MONTHLY_PLAN],
  });
  
  const plan = hasActivePayment ? "pro" as const : "free" as const;
  
  // Sync billing status to DB (so webhook processors can check plan without billing API)
  if (settings.plan !== plan) {
    await import("../db.server").then(({ default: db }) =>
      db.shop.update({
        where: { shopifyDomain: session.shop },
        data: { plan },
      })
    );
  }
  
  const subscription = {
    plan,
    hasSubscription: hasActivePayment,
    subscriptionId: appSubscriptions[0]?.id || null,
  };
  
  return { settings: { ...settings, plan }, subscription, shop: session.shop };
};

export const action = async ({ request }: ActionFunctionArgs): Promise<ActionResponse> => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();

  const alertEmail = formData.get("alertEmail") as string | null;
  const trackPrices = formData.get("trackPrices") === "on";
  const trackVisibility = formData.get("trackVisibility") === "on";
  const trackInventory = formData.get("trackInventory") === "on";
  const trackThemes = formData.get("trackThemes") === "on";
  const trackCollections = formData.get("trackCollections") === "on";
  const trackDiscounts = formData.get("trackDiscounts") === "on";
  const trackAppPermissions = formData.get("trackAppPermissions") === "on";
  const trackDomains = formData.get("trackDomains") === "on";
  const lowStockThreshold = parseInt(formData.get("lowStockThreshold") as string) || 5;
  const instantAlerts = formData.get("instantAlerts") === "on";

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
      trackCollections,
      trackDiscounts,
      trackAppPermissions,
      trackDomains,
      lowStockThreshold,
      instantAlerts,
    });
    return { success: true, message: "Settings saved" };
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
  const { settings } = useLoaderData<typeof loader>();
  const actionData = useActionData<ActionResponse>();
  const navigation = useNavigation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const isSubmitting = navigation.state === "submitting";
  const [billingLoading, setBillingLoading] = useState(false);
  const [billingError, setBillingError] = useState<string | null>(null);

  // Email chips state
  const initialEmails = settings.alertEmail
    ? settings.alertEmail.split(",").map(e => e.trim()).filter(e => e)
    : [];
  const [emails, setEmails] = useState<string[]>(initialEmails);
  const [newEmail, setNewEmail] = useState("");
  const [emailError, setEmailError] = useState<string | null>(null);

  const upgraded = searchParams.get("upgraded") === "true";
  const canceled = searchParams.get("canceled") === "true";

  const handleCancelSubscription = async () => {
    setBillingLoading(true);
    setBillingError(null);
    try {
      const response = await fetch("/api/billing/checkout?action=cancel", { method: "POST" });
      const data = await response.json();
      if (data.error) {
        setBillingError(data.error);
        setBillingLoading(false);
        return;
      }
      if (data.success) {
        window.location.reload();
        return;
      }
    } catch {
      setBillingError("Failed to cancel subscription. Please try again.");
      setBillingLoading(false);
    }
  };

  const addEmail = () => {
    const email = newEmail.trim();
    if (!email) return;
    if (!isValidEmail(email)) {
      setEmailError("Invalid email format");
      return;
    }
    if (emails.includes(email)) {
      setEmailError("Email already added");
      return;
    }
    setEmails([...emails, email]);
    setNewEmail("");
    setEmailError(null);
  };

  const removeEmail = (emailToRemove: string) => {
    setEmails(emails.filter(e => e !== emailToRemove));
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addEmail();
    }
  };

  return (
    <div style={{ padding: 16, fontFamily: "system-ui, sans-serif", maxWidth: 540 }}>
      {/* Billing return messages */}
      {upgraded && (
        <div style={{ padding: 12, marginBottom: 16, borderRadius: 8, background: "#f0fdf4", border: "1px solid #bbf7d0", color: "#166534", fontSize: 14 }}>
          Welcome to Pro! Your subscription is now active.
        </div>
      )}
      {canceled && (
        <div style={{ padding: 12, marginBottom: 16, borderRadius: 8, background: "#fefce8", border: "1px solid #fef08a", color: "#854d0e", fontSize: 14 }}>
          Checkout was canceled. You can upgrade anytime.
        </div>
      )}

      <Form method="post">
        {/* Hidden input for emails */}
        <input type="hidden" name="alertEmail" value={emails.join(", ")} />

        {/* 1. Change Tracking - Main Value */}
        <Section title="Change Tracking">
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
            label="Inventory alerts"
            description="Track low stock and out of stock"
            defaultChecked={settings.trackInventory}
          />
          {settings.trackInventory && (
            <div style={{ marginLeft: 28, marginBottom: 10 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "#374151" }}>
                Alert when stock drops below
                <input
                  type="number"
                  name="lowStockThreshold"
                  defaultValue={settings.lowStockThreshold}
                  min={1}
                  max={100}
                  style={{
                    width: 60,
                    padding: "4px 8px",
                    fontSize: 13,
                    border: "1px solid #d1d5db",
                    borderRadius: 4,
                    textAlign: "center",
                  }}
                />
                units
              </label>
            </div>
          )}
          <Toggle
            name="trackCollections"
            label="Collection changes"
            description="Track when collections are created, updated, or deleted"
            defaultChecked={settings.trackCollections}
          />
          <Toggle
            name="trackDiscounts"
            label="Discount changes"
            description="Track when discounts are created, modified, or deleted"
            defaultChecked={settings.trackDiscounts}
            disabled={settings.plan !== "pro"}
            proOnly
          />
          <Toggle
            name="trackThemes"
            label="Theme publishes"
            description="Track when a new theme becomes your live theme"
            defaultChecked={settings.trackThemes}
            disabled={settings.plan !== "pro"}
            proOnly
          />
          <Toggle
            name="trackAppPermissions"
            label="App permission changes"
            description="Track when installed apps expand or change their permissions"
            defaultChecked={settings.trackAppPermissions}
            disabled={settings.plan !== "pro"}
            proOnly
          />
          <Toggle
            name="trackDomains"
            label="Domain changes"
            description="Track when domains are added, changed, or removed"
            defaultChecked={settings.trackDomains}
            disabled={settings.plan !== "pro"}
            proOnly
          />
        </Section>

        {/* 2. Your Plan */}
        <Section title="Your Plan">
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
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
              <span style={{ color: "#166534", fontSize: 13 }}>Active</span>
            )}
          </div>

          {billingError && (
            <div style={{ padding: 10, marginBottom: 12, borderRadius: 6, background: "#fef2f2", color: "#991b1b", fontSize: 13 }}>
              {billingError}
            </div>
          )}

          {settings.plan === "free" ? (
            <button
              type="button"
              onClick={async () => {
                setBillingLoading(true);
                setBillingError(null);
                try {
                  // Call our billing API to get the Shopify confirmation URL
                  const resp = await fetch("/api/billing/checkout", { method: "POST" });
                  // App Bridge intercepts 401 responses with X-Shopify-API-Request-Failure-Reauthorize-Url
                  // and automatically redirects the top frame to the payment page
                  if (!resp.ok) {
                    const data = await resp.json().catch(() => ({}));
                    setBillingError(data.error || "Billing request failed");
                  }
                } catch {
                  // App Bridge redirect throws — this is expected
                } finally {
                  setBillingLoading(false);
                }
              }}
              disabled={billingLoading}
              style={{
                background: billingLoading ? "#93c5fd" : "#1d4ed8",
                color: "#fff",
                padding: "10px 16px",
                fontSize: 13,
                fontWeight: 500,
                border: "none",
                borderRadius: 6,
                cursor: billingLoading ? "not-allowed" : "pointer",
              }}
            >
              {billingLoading ? "Redirecting..." : "Upgrade to Pro — $19/mo"}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => {
                if (confirm("Are you sure you want to cancel your Pro subscription? You'll lose access to Pro features.")) {
                  handleCancelSubscription();
                }
              }}
              disabled={billingLoading}
              style={{
                background: "#fff",
                color: "#374151",
                padding: "10px 16px",
                fontSize: 13,
                fontWeight: 500,
                border: "1px solid #d1d5db",
                borderRadius: 6,
                cursor: billingLoading ? "not-allowed" : "pointer",
              }}
            >
              {billingLoading ? "Loading..." : "Cancel subscription"}
            </button>
          )}
        </Section>

        {/* 3. Notifications */}
        <Section title="Notifications">
          <Toggle
            name="instantAlerts"
            label="Instant alerts"
            description="Send email immediately when changes are detected"
            defaultChecked={settings.instantAlerts}
            disabled={settings.plan !== "pro"}
            proOnly
          />
          <div style={{ height: 8 }} />
          <p style={{ color: "#637381", fontSize: 13, marginBottom: 12 }}>
            Recipients will also receive a daily summary of all changes.
          </p>

          {/* Email chips */}
          {emails.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
              {emails.map(email => (
                <div
                  key={email}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    background: "#f3f4f6",
                    padding: "6px 10px",
                    borderRadius: 6,
                    fontSize: 13,
                  }}
                >
                  <span>{email}</span>
                  <button
                    type="button"
                    onClick={() => removeEmail(email)}
                    style={{
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                      padding: 0,
                      color: "#6b7280",
                      fontSize: 16,
                      lineHeight: 1,
                    }}
                    aria-label={`Remove ${email}`}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Add email input */}
          <div style={{ display: "flex", gap: 8 }}>
            <input
              type="email"
              value={newEmail}
              onChange={(e) => {
                setNewEmail(e.target.value);
                setEmailError(null);
              }}
              onKeyDown={handleKeyDown}
              placeholder="Add email address"
              style={{
                flex: 1,
                padding: "8px 12px",
                fontSize: 13,
                border: emailError ? "1px solid #dc2626" : "1px solid #d1d5db",
                borderRadius: 6,
                outline: "none",
              }}
            />
            <button
              type="button"
              onClick={addEmail}
              style={{
                background: "#f3f4f6",
                color: "#374151",
                padding: "8px 14px",
                fontSize: 13,
                fontWeight: 500,
                border: "1px solid #d1d5db",
                borderRadius: 6,
                cursor: "pointer",
              }}
            >
              Add
            </button>
          </div>
          {emailError && (
            <div style={{ color: "#dc2626", fontSize: 12, marginTop: 4 }}>{emailError}</div>
          )}
          {emails.length === 0 && (
            <div style={{ color: "#9ca3af", fontSize: 12, marginTop: 8 }}>
              No recipients added. Digest emails are disabled.
            </div>
          )}
        </Section>

        {/* Save Button */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 20 }}>
          <button
            type="submit"
            disabled={isSubmitting}
            style={{
              background: isSubmitting ? "#9ca3af" : "#000",
              color: "#fff",
              padding: "10px 20px",
              fontSize: 14,
              fontWeight: 500,
              border: "none",
              borderRadius: 6,
              cursor: isSubmitting ? "not-allowed" : "pointer",
            }}
          >
            {isSubmitting ? "Saving..." : "Save changes"}
          </button>
          {actionData && (
            <span style={{ fontSize: 13, color: actionData.success ? "#166534" : "#dc2626" }}>
              {actionData.message}
            </span>
          )}
        </div>
      </Form>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        background: "#fff",
        border: "1px solid #e5e7eb",
        borderRadius: 10,
        padding: "14px 16px",
        marginBottom: 12,
      }}
    >
      <h2 style={{ fontSize: 14, fontWeight: 600, marginBottom: 10, color: "#111827" }}>{title}</h2>
      {children}
    </div>
  );
}

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
        gap: 10,
        padding: "10px 0",
        borderBottom: "1px solid #f3f4f6",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <input
        type="checkbox"
        name={name}
        defaultChecked={defaultChecked}
        disabled={disabled}
        style={{
          width: 18,
          height: 18,
          marginTop: 1,
          accentColor: "#000",
          cursor: disabled ? "not-allowed" : "pointer",
        }}
      />
      <div style={{ flex: 1 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 13, fontWeight: 500, color: "#111827" }}>{label}</span>
          {proOnly && (
            <span
              style={{
                padding: "1px 5px",
                borderRadius: 3,
                fontSize: 9,
                fontWeight: 600,
                background: "#dbeafe",
                color: "#1d4ed8",
                textTransform: "uppercase",
              }}
            >
              Pro
            </span>
          )}
        </div>
        <div style={{ fontSize: 12, color: "#6b7280", marginTop: 1 }}>{description}</div>
      </div>
    </label>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
