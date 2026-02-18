export default function Privacy() {
  return (
    <div style={{
      maxWidth: "800px",
      margin: "0 auto",
      padding: "40px 20px",
      fontFamily: '-apple-system, BlinkMacSystemFont, "San Francisco", "Segoe UI", Roboto, "Helvetica Neue", sans-serif',
      lineHeight: 1.6,
      color: "#1a1a1a"
    }}>
      <h1 style={{ fontSize: "32px", marginBottom: "8px" }}>Privacy Policy for StoreGuard</h1>
      <p style={{ color: "#637381", marginBottom: "32px" }}><strong>Effective Date:</strong> February 18, 2026</p>

      <p>
        StoreGuard (&quot;the App&quot;) provides store monitoring, change detection, and alert services
        to merchants who use Shopify to power their stores. This Privacy Policy describes how
        information is collected, used, and shared when you install or use the App.
      </p>

      <h2 style={{ fontSize: "24px", marginTop: "32px" }}>1. Information We Collect</h2>
      <p>When you install the App, we access certain types of information from your Shopify account:</p>
      <ul>
        <li>
          <strong>Store Information:</strong> Your store domain, settings, and preferences for
          configuring monitoring and alerts.
        </li>
        <li>
          <strong>Product &amp; Inventory Data:</strong> Product titles, prices, variants, inventory
          levels, and visibility status — used to detect changes and generate alerts.
        </li>
        <li>
          <strong>Collection Data:</strong> Collection names and products — used to monitor
          collection changes.
        </li>
        <li>
          <strong>Discount Data:</strong> Discount codes and values — used to alert on discount
          creation, changes, and deletion.
        </li>
        <li>
          <strong>Domain &amp; Theme Data:</strong> Domain and theme publish events — used to alert
          on critical infrastructure changes.
        </li>
        <li>
          <strong>Order Data (Non-Personal):</strong> We access aggregate order data to calculate
          sales velocity for business impact context in alerts.
          <ul style={{ marginTop: "8px" }}>
            <li><strong>What we use:</strong> Product quantities and amounts for velocity calculations.</li>
            <li>
              <strong>What we DO NOT store:</strong> We <strong>do not</strong> store customer names,
              shipping addresses, email addresses, phone numbers, or any customer PII.
            </li>
          </ul>
        </li>
      </ul>

      <h2 style={{ fontSize: "24px", marginTop: "32px" }}>2. How We Use Your Information</h2>
      <p>We use the information we collect to provide the App&apos;s core services:</p>
      <ul>
        <li><strong>Change Detection:</strong> Monitoring your store for product, inventory, pricing, collection, discount, domain, and theme changes.</li>
        <li><strong>Alerts &amp; Digests:</strong> Sending daily digest emails and instant critical alerts so you never miss important changes.</li>
        <li><strong>Business Context:</strong> Calculating revenue impact estimates (Money Saved) to help you understand the business significance of detected changes.</li>
        <li><strong>Data Retention:</strong> Change event data is automatically purged after 90 days. Processed webhook jobs are purged after 7 days.</li>
      </ul>

      <h2 style={{ fontSize: "24px", marginTop: "32px" }}>3. Sharing Your Information</h2>
      <p>
        We do not sell or rent your information or your customers&apos; data. We may share information
        only to comply with applicable laws and regulations, or to respond to lawful requests.
      </p>
      <p>We use the following third-party services:</p>
      <ul>
        <li><strong>Render:</strong> Cloud hosting and database (Oregon, USA)</li>
        <li><strong>Resend:</strong> Email delivery for digest and alert emails</li>
        <li><strong>Stripe:</strong> Payment processing for Pro subscriptions</li>
      </ul>

      <h2 style={{ fontSize: "24px", marginTop: "32px" }}>4. Data Storage &amp; Security</h2>
      <p>
        Your data is stored securely on Render&apos;s infrastructure in the United States (Oregon region).
        We use encrypted connections (TLS) for all data in transit. Database access is restricted to
        the application service only.
      </p>

      <h2 style={{ fontSize: "24px", marginTop: "32px" }}>5. GDPR &amp; Data Rights</h2>
      <p>
        We comply with Shopify&apos;s mandatory GDPR webhooks. When you uninstall the App, all your
        store data is automatically deleted within 48 hours via Shopify&apos;s shop/redact webhook.
      </p>
      <p>You have the right to:</p>
      <ul>
        <li>Request access to your stored data</li>
        <li>Request deletion of your data at any time</li>
        <li>Uninstall the App to trigger automatic data deletion</li>
      </ul>

      <h2 style={{ fontSize: "24px", marginTop: "32px" }}>6. Changes to This Policy</h2>
      <p>
        We may update this Privacy Policy from time to time. We will notify you of any changes by
        posting the new Privacy Policy on this page with an updated effective date.
      </p>

      <h2 style={{ fontSize: "24px", marginTop: "32px" }}>7. Contact Us</h2>
      <p>
        For questions about this Privacy Policy or your data, contact us at{" "}
        <a href="mailto:support@storeguard.app" style={{ color: "#0070f3" }}>support@storeguard.app</a>.
      </p>

      <p style={{ color: "#637381", marginTop: "40px", fontSize: "14px" }}>
        StoreGuard is developed by MintBird Studio.
      </p>
    </div>
  );
}
