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
      <p style={{ color: "#637381", marginBottom: "32px" }}><strong>Effective Date:</strong> January 30, 2026</p>

      <p>
        StoreGuard ("the App") provides store monitoring and change alert services to merchants
        who use Shopify to power their stores. This Privacy Policy describes how personal information
        is collected, used, and shared when you install or use the App in connection with your
        Shopify-supported store.
      </p>

      <h2 style={{ fontSize: "24px", marginTop: "32px" }}>1. Information We Collect</h2>
      <p>When you install the App, we are automatically able to access certain types of information from your Shopify account:</p>
      <ul>
        <li>
          <strong>Store Information:</strong> We collect data about your store's settings, products,
          inventory, collections, and themes to generate an audit log of changes.
        </li>
        <li>
          <strong>Staff Activity:</strong> We record the names of staff members who make changes to
          the store (e.g., "John Doe updated Product X") to provide accountability logs.
        </li>
        <li>
          <strong>Order Information (Non-Personal):</strong> We access order data to correlate sales
          trends with store changes.
          <ul style={{ marginTop: "8px" }}>
            <li><strong>What we store:</strong> Order ID, Order Timestamp, Total Amount, Currency, and Items Purchased.</li>
            <li>
              <strong>What we DO NOT store:</strong> We <strong>do not</strong> store customer names,
              shipping addresses, email addresses, or phone numbers. All Personally Identifiable
              Information (PII) is stripped from the order payload immediately upon receipt and is
              never saved to our database.
            </li>
          </ul>
        </li>
      </ul>

      <h2 style={{ fontSize: "24px", marginTop: "32px" }}>2. How We Use Your Information</h2>
      <p>We use the information we collect to provide the App's services, including:</p>
      <ul>
        <li><strong>Activity Logging:</strong> Creating a timeline of changes made to your store (e.g., price updates, inventory adjustments).</li>
        <li><strong>Impact Analysis:</strong> Calculating revenue trends before and after specific store changes to measure impact.</li>
        <li><strong>Troubleshooting:</strong> Helping you identify which staff member or app made a specific change that may have affected your store's performance.</li>
      </ul>

      <h2 style={{ fontSize: "24px", marginTop: "32px" }}>3. Sharing Your Information</h2>
      <p>
        We do not sell or rent your personal information or your customers' data. We may share your
        information to comply with applicable laws and regulations, or to respond to a subpoena,
        search warrant, or other lawful requests for information we receive.
      </p>

      <h2 style={{ fontSize: "24px", marginTop: "32px" }}>4. Data Retention</h2>
      <ul>
        <li><strong>Activity Logs:</strong> We retain store activity logs for the duration of your subscription to provide historical analysis (up to 90 days for Pro plans).</li>
        <li><strong>Order Data:</strong> Anonymized order totals are retained to facilitate week-over-week analytical comparisons.</li>
      </ul>
      <p>
        If you uninstall the App, your data will be deleted from our systems within 48 hours,
        in accordance with Shopify's data retention policies.
      </p>

      <h2 style={{ fontSize: "24px", marginTop: "32px" }}>5. Your Rights</h2>
      <p>
        If you are a European resident, you have the right to access personal information we hold
        about you and to ask that your personal information be corrected, updated, or deleted.
        If you would like to exercise this right, please contact us through the contact information below.
      </p>
      <p>
        Additionally, if you are a European resident, we note that we are processing your information
        in order to fulfill contracts we might have with you, or otherwise to pursue our legitimate
        business interests listed above.
      </p>

      <h2 style={{ fontSize: "24px", marginTop: "32px" }}>6. Changes</h2>
      <p>
        We may update this privacy policy from time to time in order to reflect, for example,
        changes to our practices or for other operational, legal, or regulatory reasons.
      </p>

      <h2 style={{ fontSize: "24px", marginTop: "32px" }}>7. Contact Us</h2>
      <p>
        For more information about our privacy practices, if you have questions, or if you would
        like to make a complaint, please contact us by e-mail at{" "}
        <a href="mailto:pedro@mintbird.io" style={{ color: "#008060" }}>pedro@mintbird.io</a>.
      </p>

      <div style={{ marginTop: "48px", paddingTop: "24px", borderTop: "1px solid #e1e3e5", color: "#637381", fontSize: "14px" }}>
        <p>&copy; 2025 MintBird Studio. All rights reserved.</p>
      </div>
    </div>
  );
}
