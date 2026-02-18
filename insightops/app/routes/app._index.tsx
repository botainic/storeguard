import type { LoaderFunctionArgs, ActionFunctionArgs, HeadersFunction } from "react-router";
import { redirect, useLoaderData, useActionData, useNavigation, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { useState } from "react";
import { authenticate } from "../shopify.server";
import { isOnboarded, completeOnboarding, getOrCreateShop } from "../services/shopService.server";
import { getSyncStatus } from "../services/productSync.server";
import {
  ONBOARDING_STEPS,
  type OnboardingStep,
  type MonitorSelections,
  DEFAULT_MONITORS,
  validateEmailStep,
  validateMonitorStep,
} from "../services/onboarding.utils";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  await getOrCreateShop(session.shop);

  const onboarded = await isOnboarded(session.shop);

  if (onboarded) {
    const url = new URL(request.url);
    const params = url.searchParams.toString();
    throw redirect(`/app/changes${params ? `?${params}` : ""}`);
  }

  const syncStatus = await getSyncStatus(session.shop);

  return { shop: session.shop, syncStatus };
};

interface ActionResponse {
  success: boolean;
  error?: string;
}

export const action = async ({ request }: ActionFunctionArgs): Promise<ActionResponse> => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  if (intent === "complete") {
    const alertEmail = (formData.get("alertEmail") as string)?.trim() || null;
    const trackPrices = formData.get("trackPrices") === "true";
    const trackVisibility = formData.get("trackVisibility") === "true";
    const trackInventory = formData.get("trackInventory") === "true";
    const trackCollections = formData.get("trackCollections") === "true";

    try {
      await completeOnboarding(session.shop, {
        alertEmail,
        trackPrices,
        trackVisibility,
        trackInventory,
        trackCollections,
      });
      return { success: true };
    } catch (error) {
      console.error("[StoreGuard] Onboarding completion failed:", error);
      return { success: false, error: "Failed to save. Please try again." };
    }
  }

  return { success: false, error: "Unknown action" };
};

export default function Onboarding() {
  const { syncStatus } = useLoaderData<typeof loader>();
  const actionData = useActionData<ActionResponse>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  const [step, setStep] = useState<OnboardingStep>("welcome");
  const [email, setEmail] = useState("");
  const [emailError, setEmailError] = useState<string | null>(null);
  const [monitors, setMonitors] = useState<MonitorSelections>(DEFAULT_MONITORS);
  const [monitorError, setMonitorError] = useState<string | null>(null);

  const stepIndex = ONBOARDING_STEPS.indexOf(step);

  const goNext = () => {
    if (step === "email") {
      const err = validateEmailStep(email);
      if (err) {
        setEmailError(err);
        return;
      }
    }
    if (step === "monitors") {
      const err = validateMonitorStep(monitors);
      if (err) {
        setMonitorError(err);
        return;
      }
    }
    const nextIdx = stepIndex + 1;
    if (nextIdx < ONBOARDING_STEPS.length) {
      setStep(ONBOARDING_STEPS[nextIdx]);
    }
  };

  const goBack = () => {
    const prevIdx = stepIndex - 1;
    if (prevIdx >= 0) {
      setStep(ONBOARDING_STEPS[prevIdx]);
    }
  };

  // After action succeeds, redirect
  if (actionData?.success) {
    window.location.href = "/app/changes";
    return (
      <div style={{ ...containerStyle, textAlign: "center", paddingTop: 120 }}>
        <p style={{ fontSize: 14, color: "#6b7280" }}>Redirecting to your dashboard...</p>
      </div>
    );
  }

  return (
    <div style={containerStyle}>
      {/* Progress dots */}
      <div style={{ display: "flex", justifyContent: "center", gap: 8, marginBottom: 32 }}>
        {ONBOARDING_STEPS.map((s, i) => (
          <div
            key={s}
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: i <= stepIndex ? "#000" : "#d1d5db",
              transition: "background 0.2s",
            }}
          />
        ))}
      </div>

      {step === "welcome" && <WelcomeStep onNext={goNext} />}
      {step === "email" && (
        <EmailStep
          email={email}
          setEmail={(v) => { setEmail(v); setEmailError(null); }}
          error={emailError}
          onNext={goNext}
          onBack={goBack}
        />
      )}
      {step === "monitors" && (
        <MonitorStep
          monitors={monitors}
          setMonitors={(v) => { setMonitors(v); setMonitorError(null); }}
          error={monitorError}
          onNext={goNext}
          onBack={goBack}
        />
      )}
      {step === "sync" && (
        <SyncStep
          syncStatus={syncStatus}
          onNext={goNext}
          onBack={goBack}
        />
      )}
      {step === "done" && (
        <DoneStep
          email={email}
          monitors={monitors}
          isSubmitting={isSubmitting}
          error={actionData?.error ?? null}
          onBack={goBack}
        />
      )}
    </div>
  );
}

// --- Step Components ---

function WelcomeStep({ onNext }: { onNext: () => void }) {
  return (
    <div style={cardStyle}>
      <div style={{ textAlign: "center" }}>
        <div style={{ marginBottom: 16 }}>
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#000" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
          </svg>
        </div>
        <h1 style={{ fontSize: 22, fontWeight: 600, color: "#111827", marginBottom: 8 }}>
          Welcome to StoreGuard
        </h1>
        <p style={{ fontSize: 14, color: "#6b7280", lineHeight: 1.6, maxWidth: 360, margin: "0 auto 24px" }}>
          StoreGuard monitors your store for changes that cost you money — price errors, hidden
          products, stockouts, and more. {"Let's"} get you set up in under a minute.
        </p>
        <button type="button" onClick={onNext} style={primaryButtonStyle}>
          Get started
        </button>
      </div>
    </div>
  );
}

function EmailStep({
  email,
  setEmail,
  error,
  onNext,
  onBack,
}: {
  email: string;
  setEmail: (v: string) => void;
  error: string | null;
  onNext: () => void;
  onBack: () => void;
}) {
  return (
    <div style={cardStyle}>
      <h2 style={headingStyle}>Where should we send alerts?</h2>
      <p style={subStyle}>
        {"You'll"} receive a daily digest of all detected changes, plus instant alerts if you upgrade later.
      </p>

      <input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); onNext(); } }}
        placeholder="you@example.com"
        style={{
          width: "100%",
          padding: "10px 12px",
          fontSize: 14,
          border: error ? "1px solid #dc2626" : "1px solid #d1d5db",
          borderRadius: 8,
          outline: "none",
          boxSizing: "border-box",
          marginBottom: error ? 4 : 0,
        }}
      />
      {error && <p style={{ color: "#dc2626", fontSize: 12, marginTop: 4 }}>{error}</p>}

      <div style={buttonRowStyle}>
        <button type="button" onClick={onBack} style={secondaryButtonStyle}>Back</button>
        <button type="button" onClick={onNext} style={primaryButtonStyle}>Continue</button>
      </div>
    </div>
  );
}

function MonitorStep({
  monitors,
  setMonitors,
  error,
  onNext,
  onBack,
}: {
  monitors: MonitorSelections;
  setMonitors: (v: MonitorSelections) => void;
  error: string | null;
  onNext: () => void;
  onBack: () => void;
}) {
  const toggle = (key: keyof MonitorSelections) => {
    setMonitors({ ...monitors, [key]: !monitors[key] });
  };

  return (
    <div style={cardStyle}>
      <h2 style={headingStyle}>What should we watch?</h2>
      <p style={subStyle}>
        Choose which changes to monitor. You can adjust these later in Settings.
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: 2, marginBottom: 16 }}>
        <MonitorOption
          checked={monitors.trackPrices}
          onChange={() => toggle("trackPrices")}
          label="Price changes"
          description="Alert when variant prices are modified"
        />
        <MonitorOption
          checked={monitors.trackVisibility}
          onChange={() => toggle("trackVisibility")}
          label="Visibility changes"
          description="Alert when products are published, hidden, or archived"
        />
        <MonitorOption
          checked={monitors.trackInventory}
          onChange={() => toggle("trackInventory")}
          label="Inventory alerts"
          description="Alert on low stock and out of stock"
        />
        <MonitorOption
          checked={monitors.trackCollections}
          onChange={() => toggle("trackCollections")}
          label="Collection changes"
          description="Alert when collections are created, updated, or deleted"
        />
      </div>

      {error && <p style={{ color: "#dc2626", fontSize: 12, marginBottom: 8 }}>{error}</p>}

      <div style={buttonRowStyle}>
        <button type="button" onClick={onBack} style={secondaryButtonStyle}>Back</button>
        <button type="button" onClick={onNext} style={primaryButtonStyle}>Continue</button>
      </div>
    </div>
  );
}

function MonitorOption({
  checked,
  onChange,
  label,
  description,
}: {
  checked: boolean;
  onChange: () => void;
  label: string;
  description: string;
}) {
  return (
    <label
      aria-label={label}
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 10,
        padding: "10px 0",
        borderBottom: "1px solid #f3f4f6",
        cursor: "pointer",
      }}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        style={{ width: 18, height: 18, marginTop: 1, accentColor: "#000", cursor: "pointer" }}
      />
      <div>
        <div style={{ fontSize: 13, fontWeight: 500, color: "#111827" }}>{label}</div>
        <div style={{ fontSize: 12, color: "#6b7280", marginTop: 1 }}>{description}</div>
      </div>
    </label>
  );
}

function SyncStep({
  syncStatus,
  onNext,
  onBack,
}: {
  syncStatus: { status: string; syncedProducts: number; totalProducts: number | null };
  onNext: () => void;
  onBack: () => void;
}) {
  const isSyncing = syncStatus.status === "syncing" || syncStatus.status === "pending";
  const isCompleted = syncStatus.status === "completed";
  const isFailed = syncStatus.status === "failed";

  return (
    <div style={cardStyle}>
      <h2 style={headingStyle}>Syncing your products</h2>
      <p style={subStyle}>
        StoreGuard is creating baseline snapshots of your products so it can detect future changes.
      </p>

      <div style={{
        padding: 16,
        background: "#f9fafb",
        borderRadius: 8,
        textAlign: "center",
        marginBottom: 16,
      }}>
        {isSyncing && (
          <>
            <div style={spinnerStyle} />
            <p style={{ fontSize: 14, fontWeight: 500, color: "#111827", marginTop: 12 }}>
              Syncing products...
            </p>
            <p style={{ fontSize: 13, color: "#6b7280", marginTop: 4 }}>
              {syncStatus.syncedProducts} products synced
              {syncStatus.totalProducts ? ` of ${syncStatus.totalProducts}` : ""}
            </p>
          </>
        )}
        {isCompleted && (
          <>
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 6L9 17l-5-5" />
            </svg>
            <p style={{ fontSize: 14, fontWeight: 500, color: "#111827", marginTop: 8 }}>
              Sync complete
            </p>
            <p style={{ fontSize: 13, color: "#6b7280", marginTop: 4 }}>
              {syncStatus.syncedProducts} products ready for monitoring
            </p>
          </>
        )}
        {isFailed && (
          <>
            <p style={{ fontSize: 14, fontWeight: 500, color: "#dc2626" }}>
              Sync encountered an issue
            </p>
            <p style={{ fontSize: 13, color: "#6b7280", marginTop: 4 }}>
              {"Don't"} worry — StoreGuard will retry automatically. You can continue setup.
            </p>
          </>
        )}
        {syncStatus.status === "not_started" && (
          <>
            <p style={{ fontSize: 14, fontWeight: 500, color: "#111827" }}>
              Sync will start automatically
            </p>
            <p style={{ fontSize: 13, color: "#6b7280", marginTop: 4 }}>
              Your products will be synced in the background. You can continue setup.
            </p>
          </>
        )}
      </div>

      <div style={buttonRowStyle}>
        <button type="button" onClick={onBack} style={secondaryButtonStyle}>Back</button>
        <button type="button" onClick={onNext} style={primaryButtonStyle}>
          Continue
        </button>
      </div>
    </div>
  );
}

function DoneStep({
  email,
  monitors,
  isSubmitting,
  error,
  onBack,
}: {
  email: string;
  monitors: MonitorSelections;
  isSubmitting: boolean;
  error: string | null;
  onBack: () => void;
}) {
  const activeMonitors = [
    monitors.trackPrices && "Price changes",
    monitors.trackVisibility && "Visibility changes",
    monitors.trackInventory && "Inventory alerts",
    monitors.trackCollections && "Collection changes",
  ].filter(Boolean);

  return (
    <div style={cardStyle}>
      <h2 style={headingStyle}>{"You're"} all set</h2>
      <p style={subStyle}>
        {"Here's"} a summary of your setup. You can change these anytime in Settings.
      </p>

      <div style={{ marginBottom: 20 }}>
        <div style={summaryRowStyle}>
          <span style={summaryLabelStyle}>Alert email</span>
          <span style={{ fontSize: 13, color: "#111827" }}>{email}</span>
        </div>
        <div style={summaryRowStyle}>
          <span style={summaryLabelStyle}>Monitors</span>
          <span style={{ fontSize: 13, color: "#111827" }}>{activeMonitors.join(", ")}</span>
        </div>
      </div>

      {error && (
        <p style={{ color: "#dc2626", fontSize: 12, marginBottom: 8 }}>{error}</p>
      )}

      <form method="post">
        <input type="hidden" name="intent" value="complete" />
        <input type="hidden" name="alertEmail" value={email} />
        <input type="hidden" name="trackPrices" value={String(monitors.trackPrices)} />
        <input type="hidden" name="trackVisibility" value={String(monitors.trackVisibility)} />
        <input type="hidden" name="trackInventory" value={String(monitors.trackInventory)} />
        <input type="hidden" name="trackCollections" value={String(monitors.trackCollections)} />

        <div style={buttonRowStyle}>
          <button type="button" onClick={onBack} disabled={isSubmitting} style={secondaryButtonStyle}>
            Back
          </button>
          <button type="submit" disabled={isSubmitting} style={{
            ...primaryButtonStyle,
            opacity: isSubmitting ? 0.6 : 1,
            cursor: isSubmitting ? "not-allowed" : "pointer",
          }}>
            {isSubmitting ? "Finishing..." : "Start protecting my store"}
          </button>
        </div>
      </form>
    </div>
  );
}

// --- Styles ---

const containerStyle: React.CSSProperties = {
  maxWidth: 480,
  margin: "0 auto",
  padding: "40px 16px",
  fontFamily: "system-ui, sans-serif",
};

const cardStyle: React.CSSProperties = {
  background: "#fff",
  border: "1px solid #e5e7eb",
  borderRadius: 12,
  padding: "24px 20px",
};

const headingStyle: React.CSSProperties = {
  fontSize: 18,
  fontWeight: 600,
  color: "#111827",
  marginBottom: 6,
};

const subStyle: React.CSSProperties = {
  fontSize: 13,
  color: "#6b7280",
  lineHeight: 1.5,
  marginBottom: 20,
};

const buttonRowStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: 12,
  marginTop: 20,
};

const primaryButtonStyle: React.CSSProperties = {
  background: "#000",
  color: "#fff",
  padding: "10px 20px",
  fontSize: 14,
  fontWeight: 500,
  border: "none",
  borderRadius: 8,
  cursor: "pointer",
  minHeight: 44,
};

const secondaryButtonStyle: React.CSSProperties = {
  background: "#fff",
  color: "#374151",
  padding: "10px 16px",
  fontSize: 14,
  fontWeight: 500,
  border: "1px solid #d1d5db",
  borderRadius: 8,
  cursor: "pointer",
  minHeight: 44,
};

const summaryRowStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  padding: "10px 0",
  borderBottom: "1px solid #f3f4f6",
};

const summaryLabelStyle: React.CSSProperties = {
  fontSize: 13,
  color: "#6b7280",
  fontWeight: 500,
};

const spinnerStyle: React.CSSProperties = {
  width: 24,
  height: 24,
  border: "3px solid #e5e7eb",
  borderTop: "3px solid #000",
  borderRadius: "50%",
  animation: "spin 1s linear infinite",
  margin: "0 auto",
};

// Required for Shopify to handle exit-iframe redirect via App Bridge
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
