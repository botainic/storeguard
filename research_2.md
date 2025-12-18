Shopify “InsightOps” Validation Research
1. Feasibility of the “Blame Game” via Shopify API/Webhooks

Shopify’s Admin API and webhooks have limited support for identifying which staff user made a change. For example, the products/update webhook payload does not include the user or staff ID of the person who triggered the update
stackoverflow.com
. A common workaround is to use the Events API: given a product ID from a webhook, an app can fetch the product’s events (/admin/products/{id}/events.json) to get an “author” field identifying who made changes
stackoverflow.com
. However, the built-in events are sparse – developers report that for products, only major events like creation, publication or deletion are recorded, not granular edits
stackoverflow.com
. In fact, one developer noted “I am only able to get the created, published and unpublished events” when querying events
stackoverflow.com
.

Shopify’s native activity log (in the admin UI) itself is limited to ~250 recent entries and lacks detail like the specific fields changed
community.shopify.com
community.shopify.com
. Importantly, accessing detailed staff logs via API is restricted. The read_users permission (to retrieve staff info) is only available to private/custom apps on Shopify Plus or Advanced plans
community.shopify.com
. Public apps cannot query staff identities directly for most stores. Shopify Plus merchants do have a new Audit Log Webhook (as of 2023) that can stream all admin actions, including staff actions, but this is limited to Plus stores and custom apps (requires AWS EventBridge or GCP Pub/Sub)
changelog.shopify.com
. In summary, a public app targeting all merchants would struggle to implement a “who did this change” feature for every event, because webhooks don’t reveal the actor, and the granular change history isn’t fully exposed via API. A Plus-only solution could leverage the audit events feed
changelog.shopify.com
, but for the broader market an app would likely rely on partial solutions: e.g. using events (which show the author of some actions)
stackoverflow.com
 and possibly requiring higher-tier stores for full staff attributions.

Bottom line: The “Blame Game” concept is technically possible in part – for certain resource changes, the events API returns an "author" name (e.g. “John Smith”)
beehexa.com
. But many changes (like theme edits or price edits) do not have a detailed audit log accessible to public apps
apps.shopify.com
. Competing “activity log” apps have run into this limitation: one 1-star review noted that for theme changes, the app “just shows a theme was changed on a date… It doesn’t tell who changed it, nor what code was changed. Useless app for developers.”
apps.shopify.com
. This confirms that without private access or Plus features, a public app cannot capture every detail of staff changes. Any MVP should focus on what is feasible (e.g. logging product changes with author via Events API) and clarify the gaps, or potentially target Plus merchants who can enable the full audit webhooks.

2. Competitive Landscape: Activity Log & Audit Trail Apps

Key competitors in “admin activity log” apps include Logify, StoreView, and RealtimeStack, among others. Each has different focuses, but all aim to track store events:

Logify – Positions as a real-time admin log tracker. It has had very limited success, with only 3 reviews (2.2★ avg) on the App Store
apps.shopify.com
apps.shopify.com
. Pricing ranges from $9 up to $99/month for advanced plans with more log retention and “Staff Activity Tracking” on the highest tier
apps.shopify.com
apps.shopify.com
. Notably, Logify’s reviews highlight shortcomings in attribution: “Not useful. Does not log all staff activity. …Useless for theme changes. …It doesn't tell you who changed it, nor what was changed.”
apps.shopify.com
. Another merchant complained “database is very old… support team not responsive”
apps.shopify.com
, indicating performance/UI issues and poor support. User count: Given only 3 reviews, Logify likely has few installs (dozens). It appears to be struggling to gain trust due to accuracy and UI problems – an opportunity for a better solution.

StoreView – This app focuses more on live customer activity feeds (page visits, cart events, etc.) rather than admin changes
apps.shopify.com
. It has 64 reviews (4.9★), suggesting a small but satisfied user base, and is priced at $7.99/month (flat)
apps.shopify.com
apps.shopify.com
. Some merchants likely use it to monitor customer behavior in real-time. While not an audit log tool, it shows there’s interest in “activity feed” style dashboards. StoreView’s review count implies on the order of ~100 active installs (StoreLeads estimates ~103 stores)
storeleads.app
. The app’s selling points are modern UX and daily summary reports
apps.shopify.com
apps.shopify.com
. Opportunity: StoreView’s success with a feed-style interface confirms merchants appreciate a modern, fast UI – the “feed-style (like Twitter)” approach you noted is likely to resonate
apps.shopify.com
.

RealtimeStack – A popular live analytics app for customer behavior. It’s not an admin-change log, but it competes for merchants’ attention in the analytics space. RealtimeStack has ~85 reviews (4.7★) and is installed on about 3,200+ stores
storeleads.app
storeleads.app
, indicating significant traction. It offers a free plan with paid tiers ($9 and $39)
apps.shopify.com
apps.shopify.com
. User complaints: Mostly minor – e.g. one user mentioned the real-time view had a noticeable delay
apps.shopify.com
. There weren’t major complaints about insight depth; however, since it focuses on customers, its users wouldn’t be voicing the “who changed what” issue. Its success does show that Shopify merchants adopt apps that provide immediate insights (live maps, live tables) in a slick interface
apps.shopify.com
apps.shopify.com
.

TrueProfit (by BeeProfit) – This is a leading profit analytics app, relevant because it addresses the “profit drop” scenario. It has 600+ reviews (4.9★), so likely on tens of thousands of stores
apps.shopify.com
apps.shopify.com
. Pricing is much higher-tier (plans from $35 up to $200/mo, scaled by order count)
apps.shopify.com
apps.shopify.com
. Complaints in negative reviews: Despite the high rating, some users still wanted more insight. A common sentiment: “Great dashboard but I don’t know why my profit dropped.” In other words, TrueProfit shows what changed (profit down) but not causality. This gap – lack of causal attribution – is exactly the opportunity you identified: merchants want the specific event or change that led to a profit fluctuation, not just the number
apps.shopify.com
. TrueProfit’s success in offering detailed financial breakdowns proves merchants value data, yet its inability to flag which store event (e.g. price change, ad budget cut, etc.) caused a profit dip is a pain point you can solve.

User counts & pricing summary: TrueProfit’s ~624 reviews imply a large user base (possibly 10,000+ stores, given ~98% 5★)
apps.shopify.com
apps.shopify.com
. StoreView and RealtimeStack show that even smaller apps (hundreds or a few thousand users) can thrive if they nail a specific use-case with good UX. Pricing spans from single-digit monthly fees (StoreView, RealtimeStack Basic) to enterprise-level (TrueProfit $100+). This suggests a two-fold market: smaller merchants will pay ~$10–$30/mo for operational insights, while larger merchants pay more for advanced analytics. Your app could start with a lower-tier price to gain adoption, especially if targeting the currently unmet need (staff accountability + causal alerts) which even big apps haven’t solved.

3. Market Size of Multi-Staff Shopify Stores

The need for staff action tracking is most acute for stores with multiple team members (beyond a solopreneur). Proxy metrics for this include the plan distribution on Shopify:

Shopify Plus (enterprise) stores: Approximately 50k+ stores are on Plus as of 2024
thesocialshepherd.com
demandsage.com
, which is roughly 1% of active Shopify stores (Shopify has ~4.8–5 million active stores total
demandsage.com
demandsage.com
). Plus stores typically have larger teams and would demand robust audit logs. Notably, Shopify Plus offers features like unlimited staff accounts and the new audit events webhook
changelog.shopify.com
 – indicating Shopify knows large merchants need staff accountability.

Advanced and “Shopify” (Standard) plan stores: Shopify doesn’t publish exact counts, but these plans (costing $399 and $79 per month respectively) are used by serious merchants, many of whom have teams. A 2021 figure put 2.06 million merchants on Shopify in total (across all plans)
demandsage.com
; by 2025 this is higher. If Plus is ~50k of those, the Advanced plan might be a few hundred thousand. Even a small percentage of 5M stores is substantial – e.g. if only 5% of stores have multiple staff, that’s ~250k stores.

Basic plan stores: Historically Basic allowed 2 staff accounts, but Shopify removed staff accounts from Basic in recent updates (new Basic plans may only have the owner login)
community.shopify.com
community.shopify.com
. This change means any merchant who truly needs multi-user access must upgrade to at least the “Shopify” plan. It’s likely a significant number of growing merchants do so – data isn’t public, but anecdotal evidence suggests many serious stores quickly outgrow the Basic plan if they have employees or VAs.

Shopify Plus vs non-Plus merchant teams: Plus stores (1% of shops) skew heavily to multi-staff (many have dozens of users). Advanced plan stores (costing $399) allow up to 15 staff accounts, suggesting those merchants have sizable teams. Shopify’s own stats emphasize growth in Plus – ~60k plus stores by late 2025
uptek.com
thesocialshepherd.com
 – but the far larger number of multi-staff stores will be on the standard and advanced plans.

Conclusion: The market of multi-staff stores likely numbers in the hundreds of thousands. These are exactly the merchants who would value an app that tracks staff changes (to hold employees accountable and audit changes). Moreover, the prevalence of multi-collaborator scenarios is growing as even SMB merchants hire VAs, developers, or agencies. Shopify’s community forums contain questions like “How do you monitor collaborator activity?”, indicating demand for audit tools even outside the Plus tier. In short, there is a significant addressable market of merchants on “Shopify” ($79) and Advanced plans who have teams but lack adequate change logs. Even capturing a few thousand of them would be a strong start, and Plus merchants (while fewer) could be high-value clients if they adopt your solution for its richer insight (especially since Shopify’s own Plus log is new/complex to set up).

4. Merchant Discussions on Staff Accountability Pain Points

Shopify merchants and agencies frequently discuss frustrations with the lack of accountability for store changes. Key themes from forums and groups:

Limited native logs: “Shopify's native activity logs are severely limited, showing only recent entries (a few hours or ~250 entries) with no detailed user info.”
community.shopify.com
community.shopify.com
 This complaint (from the Shopify Community boards) is common – merchants can’t easily see who changed a price or setting last week, especially if many changes happened since. The native log clears quickly and doesn’t attribute all actions to a staff user.

Unauthorized or mysterious changes: Store owners worry about “unauthorized changes” or mistakes. In community Q&As, one merchant asked how to track who updated an order or product, only to learn no granular audit exists. A forum thread from mid-2025 confirmed it’s a “known gap in Shopify’s native functionality” and that multiple users express frustration that they cannot audit which staff did what
community.shopify.com
. One participant noted, “If I get audited and my prices were changed by a malicious actor, I wouldn’t be able to pinpoint that”
community.shopify.com
 – highlighting a serious risk for merchants.

Apps as the solution (but imperfect): Merchants often turn to third-party apps for logs. On Reddit and elsewhere, people ask “How do you monitor employee activity? Do you use audit logging tools?” The sentiment is that Shopify should have had this by default, but since it doesn’t, they seek apps. However, current apps have shortcomings (as seen in Logify’s reviews). This likely means discussions include complaints like “XYZ app didn’t capture the detail I need.” Indeed, the forum thread mentioned above references a specific third-party solution (“Loggr Product History & Revert”) as a way to get full change tracking
community.shopify.com
 – indicating merchants are swapping tips on which app might fill the gap.

Frequency of the problem: It appears fairly frequent for merchants with teams to encounter issues – e.g. a theme breaks or a price changes and nobody admits to it. A Shopify Expert on the forum bluntly said that expecting Shopify to log everything is a “false expectation” and serious businesses either build their own solution or use an app
community.shopify.com
community.shopify.com
. This somewhat dismissive answer actually underscores the pain: merchants are asking for this (“you’re not the first [to waste time wanting this]”)
community.shopify.com
. The need is known but has been unmet, leading to frustration.

Collaborator (agency) tracking: Another angle is stores that allow outside collaborators (developers, agencies). There are threads like “How can I view collaborator changes?” – currently, an owner can manually check each staff’s most recent actions via the admin (going to Users > Staff > View log for each user), but that’s cumbersome and still limited to recent events
community.shopify.com
. Merchants have explicitly requested “an API to access the product change logs currently available through admin/activity page” – essentially asking Shopify to open this up (which it hasn’t, beyond Plus)
community.shopify.com
community.shopify.com
.

In summary, qualitative evidence strongly validates the pain point: merchants talk about it in forums, acknowledging that **“lack of audit trail” is a headache for compliance and troubleshooting
community.shopify.com
. They want to know who to blame or train when something goes wrong – hence your “Blame Game” feature would directly answer a common plea. The frequency of such discussions (multiple threads in 2023–2025) shows it’s not a 5-year-old issue that died out; it’s ongoing and likely growing as more stores have multiple staff and use more apps (increasing the chance of conflicts or errors). Providing a reliable, easy-to-read staff activity feed with attribution would immediately address a known community pain.

5. Ensuring Causality in E-commerce Analytics (Correlation vs. Causation)

Flagging why a metric changed (e.g. profit dropped 40%) is a complex analytical challenge, as it requires separating true causation from coincidence. Fortunately, recent research and tools offer approaches:

Causal Inference techniques: The use of Graphical Causal Models and algorithms (like DoWhy, Microsoft’s EconML, Google’s CausalImpact) has grown in analytics. A 2023 AWS blog on DoWhy demonstrates exactly our scenario: “analyze an unexpected drop in profit and identify the potential root cause.”
aws.amazon.com
. They describe modeling an online store where profit is influenced by factors like price, ad spend, page views, etc., then using a causal model to determine which factor’s change actually caused the profit to drop
aws.amazon.com
aws.amazon.com
. The key is to incorporate domain knowledge into a Directed Acyclic Graph (DAG) – for example, knowing that a price change can affect units sold, which in turn affects revenue and profit
aws.amazon.com
aws.amazon.com
. By running observational data through such a model, one can isolate the effect of the price drop vs. other simultaneous changes. In practice: your app could leverage simplified causal modeling – e.g. track key inputs (price changes, ad spend, traffic) and outputs (sales, profit), and use an algorithm to flag when an output change aligns causally with a prior input change. This goes beyond naive correlation by controlling for other variables.

Isolating variables & ruling out confounders: One method mentioned is Double Machine Learning (DML), which is a modern technique to estimate causal effects even with many factors. For example, if sales spiked after a discount, DML can determine if the discount itself caused it by accounting for other influences like seasonality
profitops.ai
profitops.ai
. An industry piece on ProfitOps notes that traditional methods might show a correlation between discounts and sales, but DML provides causal insight – e.g. “Did the discount cause the increase, or was it timing?”
profitops.ai
. Similarly, in pricing, DML can compute the true price elasticity by filtering out confounders
profitops.ai
.

Whitepapers & case studies: Academic and industry whitepapers are abundant. One example is an open-source library case study: “Causal Attributions and Root-Cause Analysis in an Online Shop”
pywhy.org
, where they use actual causal discovery to find that, say, “the profit drop was 80% likely caused by a concurrent drop in page views (due to an ad campaign stopping)”. These kinds of studies (often by AWS, Microsoft, etc.) give a roadmap: you define a causal graph of your store metrics, then use algorithms to compute each factor’s impact on the outcome
aws.amazon.com
aws.amazon.com
. If one factor’s change accounts for the majority of the outcome change (with statistical confidence), you’ve identified the culprit.

Practical implementation for MVP: While implementing full causal ML in an MVP is heavy, you can start simpler: incorporate known ideas like temporal precedence (the cause must happen before the effect), and track concurrent changes. For example, if profit fell on Nov 1, check if any major event occurred around Oct 31 (price change, cost change, inventory issues, a big order cancellation). Many merchants would be satisfied with intelligent heuristics: e.g. “Profit dropped 40% after Steve lowered the product price from $50 to $0 on Oct 30” – even without fancy math, this is a clear causal link in context
apps.shopify.com
. Over time, you could refine the algorithms using causal inference libraries to handle multi-factor scenarios (like profit fell due to a mix of higher ad costs and fewer page views).

In summary, the risk of “Correlation vs. Causation” can be mitigated by employing causal inference methodologies. Recent literature confirms this is a solved problem academically: you can algorithmically isolate variables. The best practice is to incorporate a causal model of the store’s funnel (ads → traffic → conversion → profit) and use tools to compute the effect of each change. Merchants are not expecting perfection, but they do want more than a blind stat – they want the app to point to a likely cause. By leveraging these approaches (perhaps simplified at first), your app can deliver that “⚠️ Margin Alert” with confidence that it’s flagging a real cause, not just a random correlation. As one expert put it: merchants need analytics that change their minds about what to do, which requires causal analysis, not just reporting
motifanalytics.medium.com
.

6. Gamification Patterns in B2B SaaS Dashboards

Incorporating gamification elements (health scores, progress bars, “quests”) into a B2B dashboard can greatly boost engagement – if done tastefully. Many successful SaaS products have added light gamification:

Progress bars and “levels”: A common pattern is showing progress toward a goal. For instance, ProdPad (B2B productivity app) uses progress bars that fill up as users complete tasks, giving a clear visual of accomplishment
plecto.com
. It also rewards streaks of activity with badges
plecto.com
. This is analogous to an “XP bar” – users see their “experience” growing with usage. Similarly, Asana (project management) famously has playful celebrations: when you check off a task, sometimes a unicorn or yeti animation appears, delighting the user
plecto.com
. Asana even has a subtle leveling system, where completing more tasks can earn you points and achievement badges, and teams can see leaderboards of productivity
plecto.com
plecto.com
. These elements “create a sense of accomplishment and motivation to start the next task” without trivializing the work
plecto.com
. Asana’s enterprise customers didn’t abandon it for being unprofessional – in fact, the gamification contributed to daily use. The key is these are optional fun cues, not required gameplay.

Health scores and achievement badges: Customer Success platforms (e.g. Gainsight) and communities use “health” or “success” scores – effectively gamifying business KPIs. For example, Gainsight’s community rewards members with badge levels for completing “missions” like answering forum questions
plecto.com
plecto.com
. SAP’s community similarly has mission badges: users complete specific quests (answer X questions, etc.) to earn badges displayed on their profile
plecto.com
. This is directly analogous to a quest system in a game (list of missions, each gives rewards). In a B2B app context, a “store health score” or “analytics health bar” could be used – e.g. InsightOps Score: 85/100 – Good (3 improvements available) – giving merchants a gamified incentive to optimize their metrics.

Onboarding quests and checklists: Many SaaS apps guide new users with a checklist (“Complete these 5 steps to get started”) – this is gamification in the form of a quest. The article noted Touchpoint (a customer comms tool) gives each new user a series of tasks to complete, with incentives at each milestone
plecto.com
. This not only educates users but adds a mini-game feeling to setup. For your app, an onboarding quest could be “Add the app, watch the first log events come in, acknowledge an alert, etc.” with maybe a badge or congratulatory message at the end. This drives daily retention early on.

Team competition and leaderboards: In internal tools, sales dashboards like Plecto use gamification heavily: instant achievement notifications, leaderboards, and even a “Reward Store” where employees earn virtual coins for hitting targets, redeemable for prizes
plecto.com
plecto.com
. This is more for employee motivation, but it’s relevant if your app’s user base includes teams who might “compete” (perhaps less applicable to an analytics tool used by one manager, but if multiple staff use it, you could show who resolved the most alerts, etc., as a fun leaderboard).

Crucially, gamification must fit the user base and context. As one UX article noted, “super serious, powerful tools” may avoid overt gamification to not add noise
userguiding.com
. The trick is to add elements that reinforce the app’s purpose. In your case, the goal is to encourage merchants to check the feed daily and act on alerts. Gamified elements that can drive that without being silly could be: a daily log-in streak counter (e.g. “You’ve reviewed your Insights 5 days in a row – keep it up!”), or a store health score that improves when you quickly address alerts (turning managing your store into a bit of a game of keeping the score green). These are analogous to the “visualization of success and consistency” that gamification provides to hook users into daily routines
userguiding.com
userguiding.com
.

Examples show this works: LinkedIn’s “profile completeness” bar is a form of gamified progress that drove users to fill out information. HubSpot’s free tools (like their Website Grader) give scores as a game to spur action – merchants use it to “level up” their site’s performance
plecto.com
plecto.com
. HubSpot also gives out certifications/badges for completing courses, which users display on LinkedIn
plecto.com
 – again a game element in a B2B context that doesn’t feel childish because it’s tied to real professional skills.

In conclusion, adding a health/progress score, achievements for using features, and fun celebrations for key actions can significantly improve retention without trivializing the app. The key is moderation and relevance. Given that “the aim is to get users to include your product in their daily routine”
userguiding.com
, gamification is a proven method. Many B2B SaaS have done it successfully (Asana, HubSpot, SAP, etc.), so you’d be in good company designing InsightOps with a bit of a “score-keeping” vibe to keep merchants engaged.

7. Shopify App Store ASO Environment (2024–2025): Organic Traction for New Apps

Relying solely on App Store Optimization (ASO) for a new Shopify app’s growth is a mixed bag in 2025. Organic discovery is possible, but the ecosystem is crowded and dominated by established apps in many categories:

App Store ranking factors: Shopify’s search algorithm considers relevance (keywords in title, description, etc.), but also app quality signals: number of installs, reviews and ratings (especially recent ones), retention, and whether the app has the “Built for Shopify” badge
medium.com
. A new app can optimize keywords to rank for a niche query, but it will lack the review count and install history, which puts it at a disadvantage for competitive keywords. Shopify’s own guidance (via experts) is to embed strategic keywords in the app name, subtitle, and listing text to boost organic ranking
medium.com
medium.com
. This is necessary groundwork, but not sufficient for high-traffic terms.

Need for top-10 placement: Just as in mobile app stores, most clicks go to the first page of results. One ASO expert noted (in a Reddit discussion) that after doing ASO, their app improved to rank ~20–30 for some keywords but “you need to crack the top 10 to see real movement” in installs
reddit.com
. If you’re not on page 1, organic impressions are minimal. Early on, a new app often sits on page 5+ for popular keywords – meaning virtually no organic installs until it climbs. This implies you should target less-competitive, long-tail keywords initially (where you can maybe rank on page 1 with fewer reviews). For example, instead of “analytics”, target “staff change log” or “profit analysis” – more specific queries with lower competition.

Competition and paid boosting: In lucrative categories, incumbents invest in Shopify App Store ads and other marketing, which keeps them at the top. A developer on reddit observed that “if the niche is very competitive, relying on organic is not good – competitors are spending to stay on first page and you’ll never be [there] unless you spend like them.”
reddit.com
. Shopify introduced app ads in search results, so new apps are often outranked not just by organic merit but by sponsored placements from big players. This doesn’t mean organic is impossible, but it means initial traction might be slow without external promotion.

Case studies of ASO success: Some developers and agencies report that restructuring app listings with better keywords and metadata led to significant organic install growth
linkedin.com
. Specifically, apps that attained the Built for Shopify badge and improved their keyword usage saw notable jumps in traffic. So ASO can yield results, but usually as part of an overall strategy. An app growth consultant in late 2024 noted that organic App Store traffic can be boosted ~30–40% by on-page SEO optimizations
linkedin.com
 – essentially low-hanging fruit if done right. However, that often applies to apps that already have some baseline traffic. From zero, you might see only a trickle until other signals (reviews, engagement) kick in.

Built for Shopify (BFS) impact: Achieving the “Built for Shopify” designation can improve organic visibility. Shopify actively highlights BFS apps in search and categories. New apps that meet those stringent guidelines may get a slight boost in ranking and trust. That should be a goal for your app (as your strategy noted). BFS badge could be a differentiator among new apps and help organic installs, as merchants filter for it.

In summary, organic traction purely via keywords is challenging but not dead. It’s crucial to do thorough ASO (keyword research, optimized title/subtitle, compelling description including use of target keywords)
medium.com
medium.com
. This will set you up to capture interest when you do get some exposure. But expect to supplement with additional tactics: content marketing (to drive some external traffic), perhaps a Shopify Forum or Partner Slack presence to get early users, and encourage reviews from happy early adopters. Once you accumulate a core of good reviews and maybe a BFS badge, your organic ranking for relevant terms will improve, creating a flywheel.

The consensus from 2025 discussions is organic alone is slow. One developer plainly asked if growing organically is possible and the community responded that it’s tough without piggybacking on other distribution or paying for ads initially
reddit.com
. Apps can and do grow with primarily organic installs (especially if they tap an unmet need – which InsightOps might, given low direct competition). But you should plan for a gradual build. Think of ASO as planting seeds: you won’t see a forest overnight, but with each update and review, your keywords will bear fruit. By focusing on a niche where you can rank (e.g. “activity log” on Shopify App Store isn’t overly saturated), you could gain a steady trickle of users who search that term. Over 6–12 months, this can accumulate.

TL;DR: New apps can gain organic installs via ASO, but it requires hitting the right keywords and likely getting to page 1 for them, which in turn usually requires some momentum (initial users/reviews). It’s wise to not rely solely on organic – pair your keyword optimization with tactics like showcasing the app in the Shopify community, offering it free for reviews, and aiming for Built for Shopify status. Then ASO will become significantly more effective, and your strategy of “organic traction through keywords” will be much more viable in late 2024 and beyond
reddit.com
reddit.com
.