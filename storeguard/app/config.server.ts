// Admin shops that get Pro features for free (test/dev stores)
const envShops = process.env.ADMIN_SHOPS ? process.env.ADMIN_SHOPS.split(",").map(s => s.trim()).filter(Boolean) : [];

export const ADMIN_SHOPS: string[] = [
  "storeguard-dev.myshopify.com",
  "insight-ops-dev.myshopify.com",
  ...envShops,
];
