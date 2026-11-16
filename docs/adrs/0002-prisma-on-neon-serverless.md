# ADR-0002: Prisma ORM on Neon serverless Postgres

## Status
Accepted — 2026-11-15

## Context
The app needs a relational store for products, media, orders, sessions and analytics events ([ERD](../erd.md)). It runs as serverless functions on Vercel Hobby, must stay on free tiers, and is built by one developer in about two weeks ([PRD](../prd.md)). Serverless functions open many short-lived connections, so the database and driver must handle that without a long-running connection pool.

The developer chose Prisma for its typed client, readable schema and mature migration tooling.

## Decision
- **Database:** Neon Postgres (Free plan). Use the **pooled** connection string at runtime and the **direct** (unpooled) one for migrations.
- **ORM:** Prisma with the Rust-free query compiler and the Neon serverless driver adapter (`@prisma/adapter-neon`). Schema in `prisma/schema.prisma`, changes through `prisma migrate`.
- Things Prisma can't express are written as raw SQL inside the migrations: CHECK constraints and the partial unique index on `product_media(product_id) WHERE is_main` ([ERD](../erd.md) §5).
- Raw queries (e.g. analytics aggregates) only through Prisma's tagged-template `$queryRaw`, never string concatenation.

## Alternatives Considered
- **Drizzle ORM:** lighter, with a smaller bundle and faster cold starts. Its SQL-like API suits analytics queries. Lost to the developer's preference for Prisma's schema and migration workflow and familiarity. The performance gap only affects admin requests, because the storefront is static.
- **Raw SQL with `@neondatabase/serverless`:** zero ORM overhead, but no generated types and hand-written migrations. Too slow to build safely in the timeline.
- **Supabase Postgres:** comparable free tier, but bundles auth, storage and realtime we don't use (auth is in-house per ADR-0001, media is on Cloudinary). Neon's scale-to-zero and Vercel integration fit better.

## Consequences
**Positive**
- Type-safe queries and a single schema file that documents the data model.
- Repeatable migrations (`prisma migrate deploy` in the deploy pipeline).
- Neon scales to zero, so it costs nothing while idle.

**Negative / risks**
- Cold starts: Neon resumes in about 0.5 s after idle, and Prisma adds client initialization. The first admin request after a quiet period may take 1–2 s. Acceptable for one admin. The storefront is unaffected (static).
- Bigger function bundles than Drizzle or raw SQL.
- The driver-adapter setup must be checked early in the project. Fallback: the standard Postgres driver on the pooled connection string.
- The Neon Free plan limits storage (0.5 GB) and monthly compute. Analytics writes keep the database awake during traffic (see ADR-0003). Upgrading is a plan change, not a code change.
