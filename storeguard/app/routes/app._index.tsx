import type { LoaderFunctionArgs, ActionFunctionArgs, HeadersFunction } from "react-router";
import { redirect, useLoaderData, useActionData, useNavigation, useRouteError, Form, useRevalidator } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { useState, useEffect, useCallback } from "react";
import { authenticate } from "../shopify.server";
import { isOnboarded, completeOnboarding, getOrCreateShop } from "../services/shopService.server";
import { getSyncStatus } from "../services/productSync.server";
import { runRiskScan, saveRiskScanResult, getCachedRiskScan } from "../services/riskScan.server";
import type { RiskScanResult } from "../services/riskScan.server";
import {
  ONBOARDING_STEPS,
  type OnboardingStep,
  type MonitorSelections,
  DEFAULT_MONITORS,
  validateEmailStep,
  validateMonitorStep,
} from "../services/onboarding.utils";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);

  await getOrCreateShop(session.shop);

  // DEBUG: ?reset=1 to re-trigger onboarding (temporary, remove before launch)
  const reqUrl = new URL(request.url);
  if (reqUrl.searchParams.get("reset") === "1") {
    const db = (await import("../db.server")).default;
    await db.shop.updateMany({
      where: { shopifyDomain: session.shop },
      data: { onboardedAt: null, riskScanResult: null, riskScannedAt: null },
    });
  }

  const onboarded = await isOnboarded(session.shop);

  if (onboarded) {
    const url = new URL(request.url);
    const params = url.searchParams.toString();
    throw redirect(`/app/changes${params ? `?${params}` : ""}`);
  }

  const syncStatus = await getSyncStatus(session.shop);

  // Check if we have a cached risk scan already (e.g. page refresh during results step)
  const cachedRiskScan = await getCachedRiskScan(session.shop);

  let riskScanResult: RiskScanResult | null = cachedRiskScan;

  // Auto-run risk scan when sync is completed and no cached result exists
  if (syncStatus.status === "completed" && !cachedRiskScan) {
    try {
      riskScanResult = await runRiskScan(session.shop, admin);
      await saveRiskScanResult(session.shop, riskScanResult);
    } catch (err) {
      console.error("[StoreGuard] Risk scan failed:", err);
    }
  }

  return {
    shop: session.shop,
    syncStatus,
    riskScanResult,
  };
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
  const { syncStatus, riskScanResult } = useLoaderData<typeof loader>();
  const actionData = useActionData<ActionResponse>();
  const navigation = useNavigation();
  const revalidator = useRevalidator();
  const isSubmitting = navigation.state === "submitting";

  const [step, setStep] = useState<OnboardingStep>("setup");
  const [email, setEmail] = useState("");
  const [emailError, setEmailError] = useState<string | null>(null);
  const [monitors, setMonitors] = useState<MonitorSelections>(DEFAULT_MONITORS);
  const [monitorError, setMonitorError] = useState<string | null>(null);
  const [scanStarted, setScanStarted] = useState(false);

  // If we already have risk scan results (e.g. from page refresh), jump to results
  useEffect(() => {
    if (riskScanResult && step === "setup") {
      setStep("results");
    }
  }, [riskScanResult, step]);

  // Poll for sync completion during scanning step, then trigger risk scan
  useEffect(() => {
    if (step !== "scanning") return;

    const interval = setInterval(() => {
      revalidator.revalidate();
    }, 2000);

    return () => clearInterval(interval);
  }, [step, revalidator]);

  // When sync completes and we're scanning, revalidate to trigger risk scan in loader
  useEffect(() => {
    if (step === "scanning" && syncStatus.status === "completed" && !scanStarted && !riskScanResult) {
      setScanStarted(true);
      revalidator.revalidate();
    }
  }, [step, syncStatus.status, scanStarted, riskScanResult, revalidator]);

  // When risk scan result arrives, move to results step
  useEffect(() => {
    if (step === "scanning" && riskScanResult) {
      setStep("results");
    }
  }, [step, riskScanResult]);

  const handleStartMonitoring = useCallback(() => {
    const emailErr = validateEmailStep(email);
    if (emailErr) {
      setEmailError(emailErr);
      return;
    }
    const monErr = validateMonitorStep(monitors);
    if (monErr) {
      setMonitorError(monErr);
      return;
    }
    setStep("scanning");
  }, [email, monitors]);

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
      {/* Progress indicator */}
      <div style={{ display: "flex", justifyContent: "center", gap: 8, marginBottom: 32 }}>
        {ONBOARDING_STEPS.map((s, i) => {
          const currentIndex = ONBOARDING_STEPS.indexOf(step);
          return (
            <div
              key={s}
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: i <= currentIndex ? "#000" : "#d1d5db",
                transition: "background 0.2s",
              }}
            />
          );
        })}
      </div>

      {step === "setup" && (
        <SetupStep
          email={email}
          setEmail={(v) => { setEmail(v); setEmailError(null); }}
          emailError={emailError}
          monitors={monitors}
          setMonitors={(v) => { setMonitors(v); setMonitorError(null); }}
          monitorError={monitorError}
          onStart={handleStartMonitoring}
        />
      )}
      {step === "scanning" && (
        <ScanningStep
          syncStatus={syncStatus}
          riskScanResult={riskScanResult}
        />
      )}
      {step === "results" && riskScanResult && (
        <ResultsStep
          result={riskScanResult}
          email={email}
          monitors={monitors}
          isSubmitting={isSubmitting}
          error={actionData?.error ?? null}
        />
      )}
    </div>
  );
}

// --- Step 1: Setup (email + monitors + Start) ---

function SetupStep({
  email,
  setEmail,
  emailError,
  monitors,
  setMonitors,
  monitorError,
  onStart,
}: {
  email: string;
  setEmail: (v: string) => void;
  emailError: string | null;
  monitors: MonitorSelections;
  setMonitors: (v: MonitorSelections) => void;
  monitorError: string | null;
  onStart: () => void;
}) {
  const toggle = (key: keyof MonitorSelections) => {
    setMonitors({ ...monitors, [key]: !monitors[key] });
  };

  return (
    <div style={cardStyle}>
      <div style={{ textAlign: "center", marginBottom: 20 }}>
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#000" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
        </svg>
      </div>

      <h1 style={{ fontSize: 20, fontWeight: 600, color: "#111827", marginBottom: 4, textAlign: "center" }}>
        Protect your store
      </h1>
      <p style={{ ...subStyle, textAlign: "center", marginBottom: 24 }}>
        StoreGuard scans your store for risks and monitors for changes that cost you money.
      </p>

      {/* Email input */}
      <label style={{ display: "block", marginBottom: 16 }}>
        <span style={{ fontSize: 13, fontWeight: 500, color: "#374151", display: "block", marginBottom: 6 }}>
          Alert email
        </span>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); onStart(); } }}
          placeholder="you@example.com"
          style={{
            width: "100%",
            padding: "10px 12px",
            fontSize: 14,
            border: emailError ? "1px solid #dc2626" : "1px solid #d1d5db",
            borderRadius: 8,
            outline: "none",
            boxSizing: "border-box",
          }}
        />
        {emailError && <p style={{ color: "#dc2626", fontSize: 12, marginTop: 4 }}>{emailError}</p>}
      </label>

      {/* Monitor toggles */}
      <div style={{ marginBottom: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 500, color: "#374151", display: "block", marginBottom: 8 }}>
          What to monitor
        </span>
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
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
        {monitorError && <p style={{ color: "#dc2626", fontSize: 12, marginTop: 8 }}>{monitorError}</p>}
      </div>

      {/* Pro-only teaser (greyed out) */}
      <div style={{ marginBottom: 20 }}>
        <div style={{
          display: "flex", alignItems: "center", gap: 10, padding: "10px 0",
          borderBottom: "1px solid #f3f4f6", opacity: 0.5,
        }}>
          <input type="checkbox" checked={false} disabled style={{ width: 18, height: 18, marginTop: 1 }} />
          <div>
            <div style={{ fontSize: 13, fontWeight: 500, color: "#111827" }}>
              Theme publish alerts
              <span style={{
                marginLeft: 6, fontSize: 10, fontWeight: 600, color: "#6b7280",
                background: "#f3f4f6", padding: "2px 6px", borderRadius: 4,
              }}>PRO</span>
            </div>
            <div style={{ fontSize: 12, color: "#6b7280", marginTop: 1 }}>Alert when your live theme changes</div>
          </div>
        </div>
        <div style={{
          display: "flex", alignItems: "center", gap: 10, padding: "10px 0", opacity: 0.5,
        }}>
          <input type="checkbox" checked={false} disabled style={{ width: 18, height: 18, marginTop: 1 }} />
          <div>
            <div style={{ fontSize: 13, fontWeight: 500, color: "#111827" }}>
              Instant alerts
              <span style={{
                marginLeft: 6, fontSize: 10, fontWeight: 600, color: "#6b7280",
                background: "#f3f4f6", padding: "2px 6px", borderRadius: 4,
              }}>PRO</span>
            </div>
            <div style={{ fontSize: 12, color: "#6b7280", marginTop: 1 }}>Get notified immediately, not just daily</div>
          </div>
        </div>
      </div>

      <button type="button" onClick={onStart} style={{ ...primaryButtonStyle, width: "100%" }}>
        Start monitoring
      </button>
    </div>
  );
}

// --- Step 2: Scanning ---

function ScanningStep({
  syncStatus,
  riskScanResult,
}: {
  syncStatus: { status: string; syncedProducts: number; totalProducts: number | null };
  riskScanResult: RiskScanResult | null;
}) {
  const syncDone = syncStatus.status === "completed";
  const scanDone = !!riskScanResult;

  return (
    <div style={cardStyle}>
      <h2 style={{ ...headingStyle, textAlign: "center" }}>Scanning your store...</h2>
      <p style={{ ...subStyle, textAlign: "center" }}>
        Looking for risks and building your protection baseline.
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: "16px 0" }}>
        <ScanLine
          label="Products scanned"
          value={syncStatus.syncedProducts}
          total={syncStatus.totalProducts}
          done={syncDone}
        />
        <ScanLine
          label="Variants analyzed"
          value={syncDone ? (riskScanResult?.totalVariants ?? null) : null}
          done={syncDone}
        />
        <ScanLine
          label="Inventory checked"
          value={syncDone ? (riskScanResult?.totalVariants ?? null) : null}
          done={syncDone}
        />
        <ScanLine
          label="Discounts reviewed"
          value={scanDone ? (riskScanResult?.totalDiscounts ?? 0) : null}
          done={scanDone}
        />
        <ScanLine
          label="Theme status"
          value={scanDone ? "checked" : null}
          done={scanDone}
        />
      </div>

      {!syncDone && (
        <div style={{ textAlign: "center", marginTop: 8 }}>
          <div style={spinnerStyle} />
        </div>
      )}
    </div>
  );
}

function ScanLine({
  label,
  value,
  total,
  done,
}: {
  label: string;
  value: number | string | null;
  total?: number | null;
  done: boolean;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 0" }}>
      <span style={{ fontSize: 13, color: "#374151" }}>{label}</span>
      <span style={{ fontSize: 13, fontWeight: 500, color: done ? "#16a34a" : "#9ca3af" }}>
        {value !== null ? (
          <>
            {typeof value === "number" && total ? `${value} / ${total}` : value}
            {done && (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginLeft: 6, verticalAlign: "middle" }}>
                <path d="M20 6L9 17l-5-5" />
              </svg>
            )}
          </>
        ) : (
          <span style={{ color: "#d1d5db" }}>--</span>
        )}
      </span>
    </div>
  );
}

// --- Step 3: Risk Scan Results ---

function ResultsStep({
  result,
  email,
  monitors,
  isSubmitting,
  error,
}: {
  result: RiskScanResult;
  email: string;
  monitors: MonitorSelections;
  isSubmitting: boolean;
  error: string | null;
}) {
  const hasRisks = result.zeroStockProducts.length > 0 ||
    result.lowStockVariants.length > 0 ||
    result.highDiscounts.length > 0;

  return (
    <div style={cardStyle}>
      <h2 style={{ ...headingStyle, textAlign: "center" }}>Your store scan is complete</h2>

      {/* Immediate Risks */}
      <div style={sectionStyle}>
        <h3 style={sectionHeadingStyle}>Immediate Risks</h3>
        {hasRisks ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {result.zeroStockProducts.length > 0 && (
              <RiskItem
                severity="high"
                text={`${result.zeroStockProducts.length} product${result.zeroStockProducts.length === 1 ? "" : "s"} cannot be purchased right now (inventory = 0)`}
              />
            )}
            {result.lowStockVariants.length > 0 && (
              <RiskItem
                severity="medium"
                text={`${result.lowStockVariants.length} variant${result.lowStockVariants.length === 1 ? "" : "s"} ${result.lowStockVariants.length === 1 ? "is" : "are"} below your low-stock threshold`}
              />
            )}
            {result.highDiscounts.length > 0 && (
              <RiskItem
                severity="medium"
                text={`${result.highDiscounts.length} active discount${result.highDiscounts.length === 1 ? "" : "s"} over 40% off`}
              />
            )}
          </div>
        ) : (
          <p style={{ fontSize: 13, color: "#16a34a", padding: "8px 0" }}>
            No immediate risks detected. Your store looks healthy.
          </p>
        )}
      </div>

      {/* Recent Activity */}
      <div style={sectionStyle}>
        <h3 style={sectionHeadingStyle}>Recent Activity</h3>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {result.recentlyModifiedProducts > 0 && (
            <ActivityItem
              text={`${result.recentlyModifiedProducts} product${result.recentlyModifiedProducts === 1 ? " was" : "s were"} edited in the last 30 days`}
              subtext="Changes happen more often than most owners realize."
            />
          )}
          {result.recentlyModifiedCollections > 0 && (
            <ActivityItem
              text={`${result.recentlyModifiedCollections} collection${result.recentlyModifiedCollections === 1 ? " was" : "s were"} modified`}
            />
          )}
          {result.themeLastPublished && (
            <ActivityItem
              text={`Your live theme was changed ${result.themeLastPublished.daysAgo === 0 ? "today" : `${result.themeLastPublished.daysAgo} day${result.themeLastPublished.daysAgo === 1 ? "" : "s"} ago`}`}
              subtext={result.themeLastPublished.daysAgo > 0 ? "If that wasn't intentional, we would have alerted you." : undefined}
            />
          )}
          {result.recentlyModifiedProducts === 0 && result.recentlyModifiedCollections === 0 && !result.themeLastPublished && (
            <p style={{ fontSize: 13, color: "#6b7280", padding: "4px 0" }}>
              No recent activity detected in the last 30 days.
            </p>
          )}
        </div>
      </div>

      {/* Monitoring Activated */}
      <div style={sectionStyle}>
        <h3 style={sectionHeadingStyle}>Monitoring Activated</h3>
        <p style={{ fontSize: 13, color: "#374151", lineHeight: 1.6, marginBottom: 8 }}>
          From this moment forward, StoreGuard will alert you when:
        </p>
        <ul style={{ fontSize: 13, color: "#374151", lineHeight: 1.8, paddingLeft: 20, margin: 0 }}>
          {monitors.trackPrices && <li>Prices change unexpectedly</li>}
          {monitors.trackInventory && <li>Inventory hits zero</li>}
          {monitors.trackVisibility && <li>Products go invisible</li>}
          {monitors.trackCollections && <li>Collections are edited</li>}
        </ul>
      </div>

      {/* Scan stats */}
      <div style={{ display: "flex", justifyContent: "center", gap: 24, padding: "12px 0", margin: "8px 0" }}>
        <StatBadge label="Products" value={result.totalProducts} />
        <StatBadge label="Variants" value={result.totalVariants} />
        <StatBadge label="Discounts" value={result.totalDiscounts} />
        <StatBadge label="Collections" value={result.totalCollections} />
      </div>

      {error && (
        <p style={{ color: "#dc2626", fontSize: 12, marginBottom: 8 }}>{error}</p>
      )}

      <Form method="post">
        <input type="hidden" name="intent" value="complete" />
        <input type="hidden" name="alertEmail" value={email} />
        <input type="hidden" name="trackPrices" value={String(monitors.trackPrices)} />
        <input type="hidden" name="trackVisibility" value={String(monitors.trackVisibility)} />
        <input type="hidden" name="trackInventory" value={String(monitors.trackInventory)} />
        <input type="hidden" name="trackCollections" value={String(monitors.trackCollections)} />

        <button type="submit" disabled={isSubmitting} style={{
          ...primaryButtonStyle,
          width: "100%",
          opacity: isSubmitting ? 0.6 : 1,
          cursor: isSubmitting ? "not-allowed" : "pointer",
        }}>
          {isSubmitting ? "Finishing..." : "Start protecting my store"}
        </button>
      </Form>
    </div>
  );
}

// --- Shared sub-components ---

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

function RiskItem({ severity, text }: { severity: "high" | "medium"; text: string }) {
  const color = severity === "high" ? "#dc2626" : "#d97706";
  const bgColor = severity === "high" ? "#fef2f2" : "#fffbeb";
  return (
    <div style={{
      display: "flex", alignItems: "flex-start", gap: 8,
      padding: "8px 10px", background: bgColor, borderRadius: 6, border: `1px solid ${color}20`,
    }}>
      <span style={{ color, fontSize: 14, flexShrink: 0, marginTop: 1 }}>
        {severity === "high" ? "\u26A0" : "\u26A0"}
      </span>
      <span style={{ fontSize: 13, color: "#111827", lineHeight: 1.4 }}>{text}</span>
    </div>
  );
}

function ActivityItem({ text, subtext }: { text: string; subtext?: string }) {
  return (
    <div style={{ padding: "6px 0" }}>
      <p style={{ fontSize: 13, color: "#111827", margin: 0 }}>{text}</p>
      {subtext && (
        <p style={{ fontSize: 12, color: "#6b7280", margin: "2px 0 0", fontStyle: "italic" }}>{subtext}</p>
      )}
    </div>
  );
}

function StatBadge({ label, value }: { label: string; value: number }) {
  return (
    <div style={{ textAlign: "center" }}>
      <div style={{ fontSize: 18, fontWeight: 600, color: "#111827" }}>{value}</div>
      <div style={{ fontSize: 11, color: "#6b7280" }}>{label}</div>
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

const sectionStyle: React.CSSProperties = {
  marginBottom: 20,
  paddingBottom: 16,
  borderBottom: "1px solid #f3f4f6",
};

const sectionHeadingStyle: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 600,
  color: "#111827",
  marginBottom: 10,
};

const primaryButtonStyle: React.CSSProperties = {
  background: "#000",
  color: "#fff",
  padding: "12px 20px",
  fontSize: 14,
  fontWeight: 500,
  border: "none",
  borderRadius: 8,
  cursor: "pointer",
  minHeight: 44,
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
