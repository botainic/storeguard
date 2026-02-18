/**
 * Pure utility functions for the job processor.
 * Extracted from jobProcessor.server.ts for testability.
 */

/**
 * All webhook topics handled by the job processor.
 * This is the single source of truth for topic routing.
 */
export const HANDLED_TOPICS = [
  "products/update",
  "products/create",
  "products/delete",
  "collections/create",
  "collections/update",
  "collections/delete",
  "inventory/levels/update",
  "themes/publish",
  "discounts/create",
  "discounts/update",
  "discounts/delete",
  "domains/create",
  "domains/update",
  "domains/destroy",
  "app/scopes/update",
] as const;

export type HandledTopic = (typeof HANDLED_TOPICS)[number];

/**
 * Normalize a Shopify webhook topic to the format used in the job processor switch.
 * Shopify sends topics as either "products/update" or "PRODUCTS_UPDATE".
 *
 * Examples:
 *   "PRODUCTS_UPDATE" -> "products/update"
 *   "inventory_levels/update" -> "inventory/levels/update"
 *   "APP_SCOPES_UPDATE" -> "app/scopes/update"
 *   "themes/publish" -> "themes/publish"
 */
export function normalizeTopic(topic: string): string {
  return topic.toLowerCase().replace(/_/g, "/");
}

/**
 * Check if a normalized topic is handled by the job processor.
 */
export function isHandledTopic(normalizedTopic: string): normalizedTopic is HandledTopic {
  return (HANDLED_TOPICS as readonly string[]).includes(normalizedTopic);
}

/**
 * Get the handler category for a topic. Used for logging and routing.
 */
export function getTopicCategory(
  normalizedTopic: string
): "product" | "collection" | "inventory" | "theme" | "discount" | "domain" | "app_scopes" | "unknown" {
  if (normalizedTopic.startsWith("products/")) return "product";
  if (normalizedTopic.startsWith("collections/")) return "collection";
  if (normalizedTopic.startsWith("inventory/")) return "inventory";
  if (normalizedTopic.startsWith("themes/")) return "theme";
  if (normalizedTopic.startsWith("discounts/")) return "discount";
  if (normalizedTopic.startsWith("domains/")) return "domain";
  if (normalizedTopic === "app/scopes/update") return "app_scopes";
  return "unknown";
}

/**
 * Diff two sets of OAuth scopes.
 * Returns added and removed scopes.
 */
export function diffScopes(
  previousScopes: string[],
  currentScopes: string[]
): { added: string[]; removed: string[] } {
  const added = currentScopes.filter((s) => !previousScopes.includes(s));
  const removed = previousScopes.filter((s) => !currentScopes.includes(s));
  return { added, removed };
}

/**
 * Determine the verb (action) from a webhook topic.
 * Used by domain and discount processors to decide behavior.
 *
 * Examples:
 *   "domains/create" -> "create"
 *   "domains/destroy" -> "destroy"
 *   "discounts/update" -> "update"
 */
export function getTopicVerb(topic: string): string {
  const parts = topic.split("/");
  return parts[parts.length - 1];
}
