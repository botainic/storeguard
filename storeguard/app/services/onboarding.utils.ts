/**
 * Onboarding step definitions and validation logic.
 * Pure functions — no database or server dependencies.
 *
 * New 3-step flow (BOT-29 Risk Scan onboarding):
 *   1. setup   — email + monitor toggles + "Start Monitoring" button
 *   2. scanning — live risk scan progress
 *   3. results  — risk scan results with tension language
 */

export const ONBOARDING_STEPS = ["setup", "scanning", "results"] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

export function getStepIndex(step: OnboardingStep): number {
  return ONBOARDING_STEPS.indexOf(step);
}

export function isValidStep(step: string): step is OnboardingStep {
  return ONBOARDING_STEPS.includes(step as OnboardingStep);
}

export function getNextStep(current: OnboardingStep): OnboardingStep | null {
  const idx = getStepIndex(current);
  if (idx < 0 || idx >= ONBOARDING_STEPS.length - 1) return null;
  return ONBOARDING_STEPS[idx + 1];
}

export function getPreviousStep(current: OnboardingStep): OnboardingStep | null {
  const idx = getStepIndex(current);
  if (idx <= 0) return null;
  return ONBOARDING_STEPS[idx - 1];
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export interface MonitorSelections {
  trackPrices: boolean;
  trackVisibility: boolean;
  trackInventory: boolean;
  trackCollections: boolean;
}

export const DEFAULT_MONITORS: MonitorSelections = {
  trackPrices: true,
  trackVisibility: true,
  trackInventory: true,
  trackCollections: true,
};

export function validateEmailStep(email: string): string | null {
  const trimmed = email.trim();
  if (!trimmed) return "Please enter an email address to receive alerts.";
  if (!isValidEmail(trimmed)) return "Please enter a valid email address.";
  return null;
}

export function validateMonitorStep(monitors: MonitorSelections): string | null {
  const hasAny = monitors.trackPrices || monitors.trackVisibility ||
    monitors.trackInventory || monitors.trackCollections;
  if (!hasAny) return "Please select at least one monitor.";
  return null;
}
