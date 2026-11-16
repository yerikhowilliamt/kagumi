# ADR-0003: In-house analytics with an events table

## Status
Accepted — 2026-11-15

## Context
The owner wants to know which products people look at, add to the cart and order, and how many visitors turn into WhatsApp checkouts ([PRD](../prd.md) FR31–35). These are business events, not just page views. Hosting is Vercel Hobby, where Web Analytics covers page views but custom events need a paid plan. The project avoids third-party analytics services and tracking cookies, and must stay on free tiers.

## Decision
Record analytics in our own database:

- The storefront sends `page_view`, `product_view` and `add_to_cart` with `navigator.sendBeacon` to `POST /api/t`. `checkout` is recorded server-side inside the checkout transaction.
- The endpoint drops known bots, validates event type and product ID, rate-limits each visitor (60 events per 10 minutes) and inserts into `events` ([ERD](../erd.md)).
- Visitors are identified by `sha256(ip + userAgent + dailySalt)`, where `dailySalt = HMAC(TRACKING_SECRET, date in WIB)`. No cookie, no stored IP, and hashes can't be linked across days.
- The dashboard aggregates on request (indexed `GROUP BY` per day). There are no pre-aggregated tables.
- A daily Vercel Cron deletes events older than 90 days.

## Alternatives Considered
- **Vercel Web Analytics:** zero code, but on Hobby it has page views only, with no add-to-cart or checkout events and no per-product funnel. Rejected because it can't answer the owner's main questions.
- **Privacy-friendly hosted analytics (Plausible, Umami Cloud, PostHog):** proper dashboards and custom events, but a separate service, account and dashboard outside the admin, and usually paid beyond a trial or small free tier. Rejected for cost and to keep everything in one admin.
- **Self-hosted Umami:** free software, but needs its own server and database to run and maintain. Rejected as operational overhead.

## Consequences
**Positive**
- Exactly the metrics the owner needs, shown inside the admin next to orders.
- First-party endpoint on our own domain, so it's blocked by ad blockers less often than third-party scripts.
- No cookies or stored IPs, so there's no consent banner for analytics.

**Negative / risks**
- Every visit writes to Neon, which keeps the database awake and uses free-tier compute. Fine at the expected volume (~100k rows per 90 days). If limits approach: batch events client-side or sample page views.
- We maintain bot filtering, rate limiting and the aggregation queries. The numbers are approximate (bots that fake user agents, visitors hashing differently across networks or days).
- The visitor count is "unique per day". Weekly or monthly uniques are approximations (sums of daily uniques), by design of the daily salt.
- The public endpoint can be spammed. Rate limits reduce the impact but don't prevent it.
