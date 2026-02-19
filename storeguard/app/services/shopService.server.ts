import db from "../db.server";
import { ADMIN_SHOPS } from "../shopify.server";

export interface ShopSettings {
  plan: "free" | "pro";
  alertEmail: string | null;
  trackPrices: boolean;
  trackVisibility: boolean;
  trackInventory: boolean;
  trackThemes: boolean;
  trackCollections: boolean;
  trackDiscounts: boolean;
  trackAppPermissions: boolean;
  trackDomains: boolean;
  lowStockThreshold: number;
  instantAlerts: boolean;
}

/**
 * Get or create a Shop record for the given domain.
 * Called on every app access to ensure the shop exists.
 * Handles reinstalls gracefully by clearing uninstalledAt.
 */
export async function getOrCreateShop(shopDomain: string): Promise<ShopSettings> {
  const shop = await db.shop.upsert({
    where: { shopifyDomain: shopDomain },
    create: {
      shopifyDomain: shopDomain,
      plan: "free",
      alertEmail: null,
      trackPrices: true,
      trackVisibility: true,
      trackInventory: true,
      trackThemes: false, // Pro only by default
      trackCollections: true,
      trackDiscounts: false, // Pro only
      installedAt: new Date(),
    },
    update: {
      // On reinstall, clear uninstalledAt
      uninstalledAt: null,
    },
  });

  console.log(`[StoreGuard] Shop record ensured for ${shopDomain} (plan: ${shop.plan})`);

  return {
    plan: shop.plan as "free" | "pro",
    alertEmail: shop.alertEmail,
    trackPrices: shop.trackPrices,
    trackVisibility: shop.trackVisibility,
    trackInventory: shop.trackInventory,
    trackThemes: shop.trackThemes,
    trackCollections: shop.trackCollections,
    trackDiscounts: shop.trackDiscounts,
    trackAppPermissions: shop.trackAppPermissions,
    trackDomains: shop.trackDomains,
    lowStockThreshold: shop.lowStockThreshold,
    instantAlerts: shop.instantAlerts,
  };
}

/**
 * Get shop settings for display in the UI.
 * Returns null if shop doesn't exist.
 */
export async function getShopSettings(shopDomain: string): Promise<ShopSettings | null> {
  const shop = await db.shop.findUnique({
    where: { shopifyDomain: shopDomain },
  });

  if (!shop) return null;

  return {
    plan: shop.plan as "free" | "pro",
    alertEmail: shop.alertEmail,
    trackPrices: shop.trackPrices,
    trackVisibility: shop.trackVisibility,
    trackInventory: shop.trackInventory,
    trackThemes: shop.trackThemes,
    trackCollections: shop.trackCollections,
    trackDiscounts: shop.trackDiscounts,
    trackAppPermissions: shop.trackAppPermissions,
    trackDomains: shop.trackDomains,
    lowStockThreshold: shop.lowStockThreshold,
    instantAlerts: shop.instantAlerts,
  };
}

/**
 * Update shop settings.
 * Enforces plan restrictions (e.g., trackThemes only for Pro).
 */
export async function updateShopSettings(
  shopDomain: string,
  settings: Partial<Omit<ShopSettings, "plan">>
): Promise<ShopSettings> {
  const shop = await db.shop.findUnique({
    where: { shopifyDomain: shopDomain },
  });

  if (!shop) {
    throw new Error(`Shop not found: ${shopDomain}`);
  }

  // Enforce plan restrictions
  let trackThemes = settings.trackThemes ?? shop.trackThemes;
  if (shop.plan !== "pro" && trackThemes) {
    console.log(`[StoreGuard] Blocking trackThemes for free plan: ${shopDomain}`);
    trackThemes = false;
  }

  // Discounts are Pro-only
  let trackDiscounts = settings.trackDiscounts ?? shop.trackDiscounts;
  if (shop.plan !== "pro" && trackDiscounts) {
    console.log(`[StoreGuard] Blocking trackDiscounts for free plan: ${shopDomain}`);
    trackDiscounts = false;
  }

  // App permissions are Pro-only
  let trackAppPermissions = settings.trackAppPermissions ?? shop.trackAppPermissions;
  if (shop.plan !== "pro" && trackAppPermissions) {
    console.log(`[StoreGuard] Blocking trackAppPermissions for free plan: ${shopDomain}`);
    trackAppPermissions = false;
  }

  // Domains are Pro-only
  let trackDomains = settings.trackDomains ?? shop.trackDomains;
  if (shop.plan !== "pro" && trackDomains) {
    console.log(`[StoreGuard] Blocking trackDomains for free plan: ${shopDomain}`);
    trackDomains = false;
  }

  // Instant alerts are Pro-only
  let instantAlerts = settings.instantAlerts ?? shop.instantAlerts;
  if (shop.plan !== "pro" && instantAlerts) {
    console.log(`[StoreGuard] Blocking instantAlerts for free plan: ${shopDomain}`);
    instantAlerts = false;
  }

  // Validate low stock threshold (1-100 range)
  let lowStockThreshold = settings.lowStockThreshold ?? shop.lowStockThreshold;
  if (lowStockThreshold < 1) lowStockThreshold = 1;
  if (lowStockThreshold > 100) lowStockThreshold = 100;

  const updated = await db.shop.update({
    where: { shopifyDomain: shopDomain },
    data: {
      alertEmail: settings.alertEmail ?? shop.alertEmail,
      trackPrices: settings.trackPrices ?? shop.trackPrices,
      trackVisibility: settings.trackVisibility ?? shop.trackVisibility,
      trackInventory: settings.trackInventory ?? shop.trackInventory,
      trackThemes,
      trackCollections: settings.trackCollections ?? shop.trackCollections,
      trackDiscounts,
      trackAppPermissions,
      trackDomains,
      lowStockThreshold,
      instantAlerts,
    },
  });

  console.log(`[StoreGuard] Updated settings for ${shopDomain}`);

  return {
    plan: updated.plan as "free" | "pro",
    alertEmail: updated.alertEmail,
    trackPrices: updated.trackPrices,
    trackVisibility: updated.trackVisibility,
    trackInventory: updated.trackInventory,
    trackThemes: updated.trackThemes,
    trackCollections: updated.trackCollections,
    trackDiscounts: updated.trackDiscounts,
    trackAppPermissions: updated.trackAppPermissions,
    trackDomains: updated.trackDomains,
    lowStockThreshold: updated.lowStockThreshold,
    instantAlerts: updated.instantAlerts,
  };
}

/**
 * Mark a shop as uninstalled.
 * Called from app/uninstalled webhook.
 */
export async function markShopUninstalled(shopDomain: string): Promise<void> {
  try {
    await db.shop.update({
      where: { shopifyDomain: shopDomain },
      data: { uninstalledAt: new Date() },
    });
    console.log(`[StoreGuard] Marked shop as uninstalled: ${shopDomain}`);
  } catch (error) {
    // Shop might not exist if they never accessed the app
    console.log(`[StoreGuard] Could not mark shop uninstalled (may not exist): ${shopDomain}`);
  }
}

/**
 * Upgrade a shop to Pro plan.
 * Called when Shopify Billing subscription is activated.
 */
export async function upgradeShopToPro(shopDomain: string): Promise<void> {
  await db.shop.update({
    where: { shopifyDomain: shopDomain },
    data: { plan: "pro" },
  });
  console.log(`[StoreGuard] Upgraded to Pro: ${shopDomain}`);
}

/**
 * Downgrade a shop to Free plan.
 * Called when Shopify Billing subscription is cancelled.
 */
export async function downgradeShopToFree(shopDomain: string): Promise<void> {
  await db.shop.update({
    where: { shopifyDomain: shopDomain },
    data: {
      plan: "free",
      trackThemes: false, // Disable Pro-only features
      trackDiscounts: false, // Disable Pro-only features
      trackAppPermissions: false, // Disable Pro-only features
      trackDomains: false, // Disable Pro-only features
      instantAlerts: false, // Disable Pro-only features
    },
  });
  console.log(`[StoreGuard] Downgraded to Free: ${shopDomain}`);
}

/**
 * Check if a shop is on the Pro plan.
 */
export async function isProPlan(shopDomain: string): Promise<boolean> {
  if (ADMIN_SHOPS.includes(shopDomain)) return true;
  const shop = await db.shop.findUnique({
    where: { shopifyDomain: shopDomain },
    select: { plan: true },
  });
  return shop?.plan === "pro";
}

/**
 * Check feature access based on plan and settings.
 */
export async function canTrackFeature(
  shopDomain: string,
  feature: "prices" | "visibility" | "inventory" | "themes" | "collections" | "discounts" | "app_permissions" | "domains"
): Promise<boolean> {
  const shop = await db.shop.findUnique({
    where: { shopifyDomain: shopDomain },
  });

  if (!shop) return false;

  const isPro = shop.plan === "pro" || ADMIN_SHOPS.includes(shopDomain);

  switch (feature) {
    case "prices":
      return shop.trackPrices;
    case "visibility":
      return shop.trackVisibility;
    case "inventory":
      return shop.trackInventory;
    case "themes":
      return isPro && shop.trackThemes;
    case "collections":
      return shop.trackCollections;
    case "discounts":
      return isPro && shop.trackDiscounts;
    case "app_permissions":
      return isPro && shop.trackAppPermissions;
    case "domains":
      return isPro && shop.trackDomains;
    default:
      return false;
  }
}

/**
 * Get the low stock threshold for a shop.
 * Returns the threshold or null if shop doesn't exist or inventory tracking is disabled.
 */
export async function getLowStockThreshold(shopDomain: string): Promise<number | null> {
  const shop = await db.shop.findUnique({
    where: { shopifyDomain: shopDomain },
    select: { trackInventory: true, lowStockThreshold: true },
  });

  if (!shop || !shop.trackInventory) return null;
  return shop.lowStockThreshold;
}

/**
 * Check if instant alerts are enabled for a shop.
 * Returns true only for Pro shops with instant alerts enabled.
 */
export async function hasInstantAlerts(shopDomain: string): Promise<boolean> {
  const shop = await db.shop.findUnique({
    where: { shopifyDomain: shopDomain },
    select: { plan: true, instantAlerts: true, alertEmail: true },
  });

  return shop?.plan === "pro" && shop?.instantAlerts && !!shop?.alertEmail;
}

/**
 * Get shop alert email for instant notifications.
 */
export async function getShopAlertEmail(shopDomain: string): Promise<string | null> {
  const shop = await db.shop.findUnique({
    where: { shopifyDomain: shopDomain },
    select: { alertEmail: true },
  });

  return shop?.alertEmail ?? null;
}

/**
 * Check if a shop has completed onboarding.
 */
export async function isOnboarded(shopDomain: string): Promise<boolean> {
  const shop = await db.shop.findUnique({
    where: { shopifyDomain: shopDomain },
    select: { onboardedAt: true },
  });
  return shop?.onboardedAt !== null && shop?.onboardedAt !== undefined;
}

/**
 * Mark a shop as onboarded and save initial settings from the onboarding flow.
 */
export async function completeOnboarding(
  shopDomain: string,
  settings: {
    alertEmail: string | null;
    trackPrices: boolean;
    trackVisibility: boolean;
    trackInventory: boolean;
    trackCollections: boolean;
  }
): Promise<void> {
  await db.shop.update({
    where: { shopifyDomain: shopDomain },
    data: {
      alertEmail: settings.alertEmail,
      trackPrices: settings.trackPrices,
      trackVisibility: settings.trackVisibility,
      trackInventory: settings.trackInventory,
      trackCollections: settings.trackCollections,
      onboardedAt: new Date(),
    },
  });
  console.log(`[StoreGuard] Onboarding completed for ${shopDomain}`);
}
