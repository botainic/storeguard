import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

/**
 * Webhook completeness test
 *
 * Verifies that every webhook subscription in shopify.app.toml has a
 * corresponding route handler, and vice versa. Also checks that required
 * scopes are declared and the job processor handles all queued topics.
 */

const ROOT = path.resolve(__dirname, "../..");
const TOML_PATH = path.join(ROOT, "shopify.app.toml");
const ROUTES_DIR = path.join(ROOT, "app/routes");
const JOB_PROCESSOR_PATH = path.join(ROOT, "app/services/jobProcessor.server.ts");

/** Parse webhook topics and URIs from shopify.app.toml (simple regex, no TOML lib needed) */
function parseTomlWebhooks(): { topics: string[]; uris: Map<string, string>; complianceTopics: string[] } {
  const content = fs.readFileSync(TOML_PATH, "utf-8");
  const topics: string[] = [];
  const complianceTopics: string[] = [];
  const uris = new Map<string, string>();

  // Match [[webhooks.subscriptions]] blocks
  const blocks = content.split("[[webhooks.subscriptions]]").slice(1);

  for (const block of blocks) {
    const uriMatch = block.match(/uri\s*=\s*"([^"]+)"/);
    const topicsMatch = block.match(/topics\s*=\s*\[\s*"([^"]+)"\s*\]/);
    const complianceMatch = block.match(/compliance_topics\s*=\s*\[([^\]]+)\]/);

    if (complianceMatch) {
      const matches = complianceMatch[1].matchAll(/"([^"]+)"/g);
      for (const m of matches) {
        complianceTopics.push(m[1]);
      }
    }

    if (topicsMatch && uriMatch) {
      topics.push(topicsMatch[1]);
      uris.set(topicsMatch[1], uriMatch[1]);
    }
  }

  return { topics, uris, complianceTopics };
}

/** Convert a webhook URI to the expected route file name */
function uriToRouteFile(uri: string): string {
  // "/webhooks/products/delete" -> "webhooks.products.delete.tsx"
  return uri.replace(/^\//, "").replace(/\//g, ".") + ".tsx";
}

/** Convert a webhook topic to the normalized form used in jobProcessor switch */
function topicToNormalized(topic: string): string {
  // "inventory_levels/update" -> "inventory/levels/update"
  return topic.toLowerCase().replace(/_/g, "/");
}

/** Get all webhook route handler files */
function getWebhookRouteFiles(): string[] {
  return fs.readdirSync(ROUTES_DIR).filter((f) => f.startsWith("webhooks.") && f.endsWith(".tsx"));
}

/** Parse job processor switch cases */
function getJobProcessorTopics(): string[] {
  const content = fs.readFileSync(JOB_PROCESSOR_PATH, "utf-8");
  const cases: string[] = [];
  const caseRegex = /case\s+"([^"]+)":/g;
  let match;
  while ((match = caseRegex.exec(content)) !== null) {
    cases.push(match[1]);
  }
  return cases;
}

/** Parse scopes from shopify.app.toml */
function parseTomlScopes(): string[] {
  const content = fs.readFileSync(TOML_PATH, "utf-8");
  const scopesMatch = content.match(/scopes\s*=\s*"([^"]+)"/);
  return scopesMatch ? scopesMatch[1].split(",").map((s) => s.trim()) : [];
}

describe("webhook completeness", () => {
  const { topics, uris, complianceTopics } = parseTomlWebhooks();
  const routeFiles = getWebhookRouteFiles();
  const processorTopics = getJobProcessorTopics();
  const scopes = parseTomlScopes();

  it("every webhook topic in shopify.app.toml has a route handler", () => {
    const missing: string[] = [];

    for (const topic of topics) {
      const uri = uris.get(topic)!;
      const expectedFile = uriToRouteFile(uri);
      if (!routeFiles.includes(expectedFile)) {
        missing.push(`${topic} -> expected ${expectedFile}`);
      }
    }

    expect(missing, `Missing route handlers:\n${missing.join("\n")}`).toEqual([]);
  });

  it("compliance topics have a shared route handler", () => {
    expect(complianceTopics.length).toBeGreaterThan(0);
    expect(routeFiles).toContain("webhooks.compliance.tsx");
  });

  it("every webhook route handler has a subscription in shopify.app.toml", () => {
    const expectedUris = new Set(uris.values());
    // Compliance handler uses a different format
    expectedUris.add("/webhooks/compliance");
    // app/uninstalled is a mandatory webhook that Shopify manages
    expectedUris.add("/webhooks/app/uninstalled");

    const orphaned: string[] = [];
    for (const file of routeFiles) {
      const uri = "/" + file.replace(/\.tsx$/, "").replace(/\./g, "/");
      if (!expectedUris.has(uri)) {
        orphaned.push(`${file} -> ${uri} has no subscription`);
      }
    }

    expect(orphaned, `Orphaned handlers (no subscription):\n${orphaned.join("\n")}`).toEqual([]);
  });

  // Topics that are handled directly in the webhook handler (not queued to job processor)
  const DIRECT_HANDLED_TOPICS = new Set([
    "app/uninstalled", // Handles cleanup directly (Stripe cancel, session delete)
  ]);

  it("every queued webhook topic is handled in jobProcessor switch", () => {
    const missing: string[] = [];

    for (const topic of topics) {
      if (DIRECT_HANDLED_TOPICS.has(topic)) continue;

      const normalized = topicToNormalized(topic);
      if (!processorTopics.includes(normalized)) {
        missing.push(`${topic} (normalized: ${normalized})`);
      }
    }

    expect(missing, `Topics not handled in jobProcessor:\n${missing.join("\n")}`).toEqual([]);
  });

  it("required scopes are declared for subscribed webhook topics", () => {
    // Map webhook topics to required scopes
    // See: https://shopify.dev/docs/api/admin-rest/2025-10/resources/webhook
    const TOPIC_SCOPE_MAP: Record<string, string> = {
      "products/create": "read_products",
      "products/update": "read_products",
      "products/delete": "read_products",
      "collections/create": "read_products",
      "collections/update": "read_products",
      "collections/delete": "read_products",
      "inventory_levels/update": "read_inventory",
      "themes/publish": "read_themes",
      "discounts/create": "read_discounts",
      "discounts/update": "read_discounts",
      "discounts/delete": "read_discounts",
      // These don't require explicit scopes:
      // "app/uninstalled", "app/scopes_update", "domains/*"
    };

    const missing: string[] = [];
    for (const topic of topics) {
      const requiredScope = TOPIC_SCOPE_MAP[topic];
      if (requiredScope && !scopes.includes(requiredScope)) {
        missing.push(`${topic} requires scope "${requiredScope}"`);
      }
    }

    expect(missing, `Missing scopes:\n${missing.join("\n")}`).toEqual([]);
  });

  it("has all V2 webhook topics subscribed", () => {
    // From PRD_V2.md and CLAUDE.md V2 section
    const requiredTopics = [
      // V1 core
      "products/create",
      "products/update",
      "products/delete",
      "inventory_levels/update",
      "themes/publish",
      "app/uninstalled",
      // V2 additions
      "collections/create",
      "collections/update",
      "collections/delete",
      "discounts/create",
      "discounts/update",
      "discounts/delete",
      "domains/create",
      "domains/update",
      "domains/destroy",
      "app/scopes_update",
    ];

    const allTopics = new Set([...topics, "app/uninstalled"]);
    const missing = requiredTopics.filter((t) => !allTopics.has(t));

    expect(missing, `Missing V2 webhook topics:\n${missing.join("\n")}`).toEqual([]);
  });

  it("has no duplicate webhook subscriptions", () => {
    const seen = new Set<string>();
    const duplicates: string[] = [];

    for (const topic of topics) {
      if (seen.has(topic)) {
        duplicates.push(topic);
      }
      seen.add(topic);
    }

    expect(duplicates, `Duplicate subscriptions:\n${duplicates.join("\n")}`).toEqual([]);
  });
});
