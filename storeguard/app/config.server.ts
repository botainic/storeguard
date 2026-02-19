// Admin shops that get Pro features for free (test/dev stores)
// Reads from ADMIN_SHOPS env var (comma-separated) + hardcoded defaults
export const ADMIN_SHOPS = [
  "storeguard-dev.myshopify.com",
  "insight-ops-dev.myshopify.com",
  ...(process.env.ADMIN_SHOPS?.split(",").map((s) => s.trim()).filter(Boolean) || []),
];
