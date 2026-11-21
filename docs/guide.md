# Developer Guide: Kagumi Dough

**Status:** Current as of M1 Storefront + checkout (closed 2026-11-19)

Every command in this guide was run during M0 or M1 or is a script in `package.json`. When the guide and `package.json` differ, `package.json` is right and the guide is corrected. A new command is added here only after it has been run.

## 1. Project Overview

Kagumi Dough is the website of a homemade bakery in Surakarta (Solo): a storefront with a cart that sends one prefilled WhatsApp order, and an admin dashboard for products and media, orders and statistics.

M0 built the foundation: design tokens and the theme toggle, the full database schema with one migration, and a development seed. M1 builds the storefront on it. So far that is the shared order rules in `src/lib`, a statically rendered home page with the navigation, hero, product-name marquee, how-to-order steps, CTA band and footer, the menu with filter chips and product cards, the product detail dialog, the cart (sheet, toast, mobile cart bar and nav cart button, kept in `localStorage`), and checkout: the `createOrder` Server Action writes the order in one transaction with a per-visitor rate limit, and the cart sheet's form opens the prefilled WhatsApp message in the same tab, also when saving fails. M2 adds the admin.

**Stack**

| Technology | Used for |
| --- | --- |
| Next.js 16 (App Router), React 19, TypeScript | The whole app, storefront and admin, in one project |
| Prisma 7 with `@prisma/adapter-neon` | Database access. The generated client lives in `src/generated/prisma` |
| Neon Postgres | Two branches: production and development (§4) |
| Vercel | Hosting. Functions run in `sin1` (Singapore), set in `vercel.json` |
| CSS Modules + `src/styles/tokens.css` | Styling with design tokens only (§6) |
| Vitest 5 | Unit tests and database tests (`tests/`) |
| Playwright | End-to-end tests (`e2e/`) |
| ESLint 9 (`eslint-config-next`) | Lint |

**Where to go for more.** This guide covers how to work in the repository day to day. The documents below own their topics; read the section you need, not the whole file.

| Document | Covers |
| --- | --- |
| [prd.md](prd.md) | Scope, goals, non-goals, functional requirements (FR…) |
| [system-design.md](system-design.md) | Architecture, data flows, environments (§4.10), configured values (§9), verification plan (§10) |
| [erd.md](erd.md) | Every table, field, index, CHECK constraint and FK behavior |
| [design.md](design.md) | Design tokens (light and dark), type scale, component patterns |
| [adrs/](adrs/README.md) | Decisions that are expensive to reverse: in-house auth, Prisma on Neon, in-house analytics |

Rules for AI agents working in this repository (approvals, safety, scope) live in the project's local agent rules file, which is not committed. This guide does not repeat them.

## 2. Getting Started

### Prerequisites

- Node.js 24 (`"engines": { "node": "24.x" }` in `package.json`) and the npm that ships with it.
- Network access to Google Fonts during `npm run dev` and `npm run build`: `next/font/google` downloads Figtree at build time, not at page load.
- Playwright's Chromium browser, for `npm run test:e2e`. Playwright prints the install command when the browser is missing.

### Install

```sh
npm ci
```

`npm ci` runs the `postinstall` script, `prisma generate`, which writes the Prisma client to `src/generated/prisma`. That folder is git-ignored and always regenerated. npm 11 warns that the install scripts of `prisma` and `@prisma/engines` were skipped (`allowScripts`); that is expected, and every command below works without them.

### Environment variables

Copy `.env.example` to `.env` (git-ignored). The project owner supplies the values. A local `.env` only ever holds the **development** branch values; never put production values in a local file.

| Variable | Value |
| --- | --- |
| `DATABASE_URL` | Pooled connection string of the development branch (host contains `-pooler`). Used by the app at runtime and by the seed and tests |
| `DIRECT_URL` | Direct (unpooled) connection string of the development branch. Used by the Prisma CLI |
| `DEV_DATABASE_HOST` | The direct host of the development branch (§4). The seed and `tests/db` refuse to run when `DATABASE_URL` points at any other host |
| `TRACKING_SECRET` | Secret of the daily salt of the visitor hash (`src/lib/tracking.ts`), used by `createOrder` for the checkout rate limit. The project owner generates it (for example `openssl rand -hex 32`) and enters it; nobody else reads it. Without it every checkout returns the `server` result. The Vitest tests pass their own fake secret and don't need it |
| `ADMIN_EMAIL` | Email of your development admin account. Read only by `node scripts/create-admin.ts` (§4) |
| `ADMIN_PASSWORD` | Password of that account, 12 to 1024 characters. Read only by `node scripts/create-admin.ts`; never printed. How the production account is created is decided in M5 (System Design §8 lists both variables; until then set them only in your local `.env`) |

To check that both admin variables are set without printing them:

```sh
node -e "process.loadEnvFile(); console.log(['ADMIN_EMAIL','ADMIN_PASSWORD'].map(k => k + (process.env[k] ? ' set' : ' missing')).join(', '))"
```

`npm run build`, `npm run dev`, `npm test` and `npm run test:e2e` all need `.env`. Without `DATABASE_URL` the build fails with `DATABASE_URL is not set`, because the home page imports `src/lib/db.ts`.

### Check which database you are pointing at

Run this before any command that writes to a database (tests, seed, migrations). It prints only the host and database name of `DIRECT_URL`, never the URL:

```sh
node -e "process.loadEnvFile(); const u = new URL(process.env.DIRECT_URL); console.log(u.hostname, u.pathname.slice(1))"
```

The output must be `ep-dark-bird-a1woad4p.ap-southeast-1.aws.neon.tech neondb`. If it is anything else, stop: your `.env` points at the wrong branch.

### Run locally

```sh
npm run dev
```

Open http://localhost:3000. The storefront shows the products of the development branch. The dev server renders the page on every request, but the product list is cached (`unstable_cache`, tag `products`, revalidate 3600 s) under `.next/dev/cache`, so a second request does not query the database.

## 3. Commands

Every script in `package.json`:

| Command | Runs | What it does |
| --- | --- | --- |
| `npm run dev` | `next dev` | Development server on port 3000 |
| `npm run build` | `next build` | Production build. Applies no migration and writes to no database. It may read: the static storefront of M1 reads products at build time, locally from the development branch in `.env` |
| `npm run start` | `next start` | Serves the output of `npm run build` |
| `npm run lint` | `eslint .` | Lint. `src/generated/` and `.vercel/` are ignored |
| `npm run typecheck` | `next typegen && tsc --noEmit` | Generates Next.js route types, then type-checks |
| `npm test` | `vitest run` | All Vitest tests, **including `tests/db`**, which connect to the development branch and write inside transactions that are always rolled back. Files run one at a time (`fileParallelism: false`). `tests/db/checkout.test.ts` inserts most orders in rolled-back transactions, and each run moves `orders_id_seq` by about 12 (a rollback does not undo `nextval()`). It also commits rows and deletes them at the end: one `rate_limits` row of its concurrency test (random `test:barrier:` key), and from its `checkout()` tests one order with its item, status change and `CHECKOUT` event plus three `rate_limits` rows, under names and keys unique to the run. Those tests need the seeded Kastengel and Nastar (§4) and change no product. `tests/db/auth.test.ts` runs its logins, sessions and admin resets in rolled-back transactions; its concurrency tests commit one admin under a random `test-…@kagumi.test` email, update its lockout columns, and delete it at the end (its sessions go with it). It also runs `node scripts/create-admin.ts` twice with fake input that fails before anything commits: once on a broken rule, once with `DATABASE_URL` naming a database that does not exist on the development host. `tests/db/orders.test.ts` runs in rolled-back transactions with explicit ids, so `orders_id_seq` does not move (its last test checks it); its status-change tests (fault injection, the two row-lock barriers, `setOrderStatus`) commit six orders under the customer "Test M2.5", a fake number and ids above 2 100 000 000 (never from the sequence), each with its history, and delete them at the end. `tests/db/orders-page.test.ts` calls the order list page with its database set to a rolled-back transaction (explicit ids, nothing persists). |
| `npm run test:unit` | `vitest run --exclude 'tests/db/**'` | Vitest tests that need no database |
| `npm run test:e2e` | `playwright test` | Playwright tests in `e2e/` at 360 px and desktop width. Starts `npm run dev` itself unless `PLAYWRIGHT_BASE_URL` is set. The home page reads its products from the development branch (cached by the dev server, §2), and `e2e/storefront.spec.ts` and `e2e/menu.spec.ts` expect the nine products of the seed (§4) in `sortOrder`, and `e2e/detail.spec.ts` its names, prices and descriptions, and `e2e/cart.spec.ts` Hampers Natal as a pre-order at Rp35.000 with the deadline 2026-12-10 and Soft Cookies as ready stock without a price. **`e2e/checkout.spec.ts` writes orders to the development branch:** per run one order per project from its happy path and five from its rate-limit test (desktop only), each with its item, status change, `CHECKOUT` event and `rate_limits` row, under the customer name "E2E Playwright" and a fake number. Nothing is deleted. It needs `TRACKING_SECRET` in `.env` (without it every checkout returns `server`) and the seeded Kastengel, Bolu Gulung and Nastar. Every test is its own visitor (a user agent unique to the test and run), and `wa.me` is intercepted, so no message reaches the shop. **`e2e/admin-orders.spec.ts` writes orders too:** per run one order per project (Kastengel × 2 and Bolu Gulung × 1, delivery) with the same data and guards, then finds it in `/admin/pesanan` with the `e2e-orders@kagumi.test` account. Nothing is deleted. **`e2e/admin-order-detail.spec.ts` writes orders too:** per run two orders per project (the same lines, delivery, with a note) with the same data and guards, one per test that places an order; with the `e2e-detail@kagumi.test` account it changes the first one's status four times and the second one's five times (one history row each, two of them from a second and a third tab). Its other tests write nothing but their logins. Nothing is deleted. **Before the tests, the global setup (`e2e/global-setup.ts`) writes to the development branch:** it creates or resets the five e2e admin accounts of `e2e/admin.ts` (`e2e-…@kagumi.test`) with a new random password per run, which reaches the tests only through `process.env` and is never written to a file or printed; the reset deletes their sessions and clears the lockout. `e2e/login.spec.ts` then creates sessions for them and locks `e2e-lockout@kagumi.test` for 15 minutes (desktop project only). **Never run `npm run test:e2e` against a deployed URL:** with `PLAYWRIGHT_BASE_URL` set the global setup returns before loading `.env`, only `e2e/theme.spec.ts` may run, and `e2e/checkout.spec.ts` and `e2e/login.spec.ts` throw at load |
| `npm run vercel-build` | `prisma migrate deploy && next build` | **Run by Vercel only**, instead of `build`. Applies pending migrations to the branch of that Vercel environment, then builds. Never run it locally |
| `postinstall` | `prisma generate` | Runs automatically after `npm ci`; regenerates the Prisma client |

The checks every change must pass:

```sh
npm run lint
npm run typecheck
npm test
```

Other commands:

| Command | Purpose |
| --- | --- |
| `npx vitest run tests/db` | Only the database tests |
| `node scripts/create-admin.ts` | Creates or resets the development admin account from `ADMIN_EMAIL` and `ADMIN_PASSWORD` (§4) |
| `PLAYWRIGHT_BASE_URL=https://kagumi-dough.vercel.app npx playwright test e2e/theme.spec.ts` | The theme tests against production, with no local server. Writes nothing while the storefront has no `/api/t` beacons. Once beacons exist, each run records `page_view` events in production |

## 4. Database

### The two Neon branches

| Branch | Used by | Who writes to it |
| --- | --- | --- |
| production | The Vercel production deployment | Only the production build (`vercel-build`) and the running app. Never a developer machine: no tests, seeds, scripts or Prisma CLI commands |
| development | Local development, tests, the seed, Vercel preview deployments | Developers, tests and the preview build |

**The development branch is the disposable database:** host `ep-dark-bird-a1woad4p.ap-southeast-1.aws.neon.tech` (the pooled host adds `-pooler` to the first label), database `neondb`. Tests, seeds and scripts run only against it. Connection strings and passwords are never written into the repository.

### Schema and migrations

The schema is `prisma/schema.prisma` and matches [erd.md](erd.md). Migrations live in `prisma/migrations/`. Some database objects exist only as raw SQL appended to a migration, because Prisma's schema language can't express them: the five CHECK constraints and the partial unique index `product_media_one_main_per_product` (see `prisma/migrations/20261116083312_init/migration.sql`).

How a migration is made (System Design §4.10):

1. Change `prisma/schema.prisma` to match the ERD.
2. Generate the SQL with `prisma migrate diff`. The first migration was generated with:

   ```sh
   npx prisma migrate diff --from-empty --to-schema prisma/schema.prisma --script
   ```

   A later migration diffs from the current state instead of from empty. The exact command for it is added here when the first such migration is made.
3. Read the generated SQL. `schema.prisma` does not know about the raw-SQL CHECK constraints and the partial index, so a diff can propose dropping them. Remove any such drop, and append any new raw SQL by hand.
4. Save it as `prisma/migrations/<timestamp>_<name>/migration.sql` and apply it to the development branch, after the host check (§2):

   ```sh
   npx prisma migrate deploy
   npx prisma migrate status
   ```

   `migrate status` must report `Database schema is up to date!`.
5. Commit the migration. The preview build applies it to the development branch (already applied, so nothing pending), and the production build applies it to production (§5).

**Never use `prisma migrate dev`.** It needs a shadow database, and it would drop the raw-SQL objects. `prisma migrate reset` and `prisma db push` are not part of this workflow either.

**Keep migrations compatible with the live deployment.** The production build migrates before the new code is live, so the old code runs against the new schema for a while. Add columns and tables first; remove old ones in a later deploy.

### Seed

```sh
npx prisma db seed
```

This runs `node prisma/seed.ts` (configured in `prisma.config.ts`). It inserts each listed product whose name is not in `products` yet and leaves existing rows unchanged, so a second run inserts nothing (`inserted 0 products; products has 9 rows`). The list is the 7 sample products plus two development fixtures for the checkout tests: **Nastar** (pre-order, Rp90.000, deadline 2026-11-01, so always closed) and **Kastengel** (ready stock, Rp85.000, no deadline, the open priced product). It refuses to run unless the host of `DATABASE_URL`, without `-pooler`, equals `DEV_DATABASE_HOST`. Never seed production.

After seeding, the dev server may still serve the old product list from `.next/dev/cache` (§2) for up to an hour. Empty that folder before `npm run test:e2e` so the page reads the new list.

### Admin account

```sh
node scripts/create-admin.ts
```

Run the host check (§2) first. The script loads `.env`, refuses to run unless `DATABASE_URL` is the development branch (the seed's guard), and then, in one transaction, inserts the admin from `ADMIN_EMAIL` and `ADMIN_PASSWORD` (§2) or, when that email exists, replaces its password hash, clears its lockout and deletes its sessions. Other admin rows are untouched. It prints exactly `admin account created` or `admin account reset`, never the email or the password. A broken rule (an email without exactly one `@` or longer than 254 characters, a password under 12 or over 1024 characters) exits with code 1 and a message naming the rule. Never run it against production; how the production account is created is decided in M5.

### Schema test

`tests/db/schema.test.ts` compares the database catalog (tables, enums, columns, CHECK constraints, indexes, foreign keys) with the ERD, and checks constraint behavior in transactions that always roll back. It runs as part of `npm test`, uses the same `DEV_DATABASE_HOST` guard as the seed, and connects through `src/lib/db.ts`.

## 5. Environments and Deploy

| Environment | Git branch | Database | Migrations |
| --- | --- | --- | --- |
| Production (`https://kagumi-dough.vercel.app`) | `main` | Neon production branch | `vercel-build` runs `prisma migrate deploy` before `next build`. A failed migration fails the build, and the previous deployment keeps serving |
| Preview | every other branch, in practice `develop` | Neon development branch | Same build step, against the development branch |
| Local | — | Neon development branch, from `.env` | By hand (§4) |

**Vercel variables.** `DATABASE_URL` and `DIRECT_URL` are entered by hand per Vercel environment: production values in Production only, development values in Preview only, nothing in Development. `TRACKING_SECRET` likewise: the development value in Preview, a different production value in Production, both marked sensitive. The Neon Vercel integration is not installed, because it would create a database branch per preview deployment while previews must use the one development branch. Changing Vercel or Neon settings is done by the project owner.

**Deploy flow.**

1. Push `develop`: Vercel builds a preview deployment on the development branch. Preview URLs are behind Vercel login.
2. At a milestone close: switch to `main`, run `git merge --ff-only develop`, push `main`, and switch back to `develop`. The push starts the production build, which applies pending migrations to the production branch.

On this machine the macOS keychain holds a different GitHub account, so pushes use the `gh` login through an inline credential helper. No git config is changed:

```sh
git -c credential.helper= -c 'credential.helper=!gh auth git-credential' push origin <branch>
```

Vercel Cron runs only on the production deployment, so scheduled jobs never touch the development branch.

## 6. Project Structure

```
src/
  app/               App Router: layout.tsx (fonts, theme script), icons
    (store)/page.tsx The storefront home page: static, products cached with the tag `products`
    (store)/actions.ts  "use server": createOrder, its only export (every export of this file is a public endpoint)
    admin/actions.ts "use server": login (public) and logout
    admin/login/     The login page and its form
    admin/(protected)/  Every admin page behind the session: the layout, /admin (redirects to /admin/pesanan) and pesanan/. The layout and each page call requireAdmin()
                     pesanan/[id]/ is the order detail; pesanan/actions.ts is "use server" with setOrderStatus, its only export
                     not-found.tsx is the admin 404 inside the shell; admin/error.tsx is the admin error page (no shell);
                     admin/title.module.css is the admin page title (design.md §3), composed by every admin page's h1
                     The layout is the design.md §7 shell (sidebar, mobile top bar and bottom nav) with the status bar
    fonts/           Self-hosted Switzer font files
  components/        Shared components with their CSS Modules. Storefront: StoreProvider (products, WIB date, cart state),
                     Menu, OpenPreOrderNotice, ProductCard, ProductThumb, PromoCard, ProductDetail, Dialog, QuantityStepper, Tag, Toast, CartButton,
                     CartBar, CartSheet (steps cart → form → result), CheckoutForm (calls createOrder), OrderResult (the
                     WhatsApp bubble: the only module with the design.md §2.7 colors), Field, SegmentedControl, Button, ThemeToggle
                     (label prop: the admin sidebar item; applies the stored theme when the head script did not run). Admin: AdminNav (sidebar and bottom-nav items, the NEW count pill), OrderStatusBadge, StatusPicker (calls setOrderStatus), LinkPending (marks a link whose page is loading)
  lib/
    db.ts            The Prisma client on the pooled URL through @prisma/adapter-neon
    order.ts         Order number, rupiah, WIB dates and times, the WhatsApp message and URL, the admin phone display and chat link, the cart limits (no imports)
    validation.ts    Checkout schema and phone normalization (zod)
    menu.ts          Storefront product types, the row mapper and the menu rules: sort, filter, open pre-order, promo product (imports only ./order)
    cart.ts          The cart in localStorage['kagumi-cart']: load rules, add, set, remove (imports only ./order and a type from ./menu)
    tracking.ts      Server only (node:crypto): request IP and user agent, the visitor hash, the rate-limit upsert
    checkout.ts      Server only: placeOrder (the checkout transaction) and checkout (maps any throw to "server"); exports the CreateOrderResult type
    password.ts      Server only: scrypt hashing and verification, the dummy verification, normalizeEmail (imports only node:crypto)
    auth.ts          Server only: login attempts with the lockout, sessions, getAdmin and requireAdmin
    orders.ts        Server only: admin order queries, each taking the client: statusBarCounts, listOrders (filter, search, 50 per page), statusCounts, getOrder, changeOrderStatus (row lock); the list URL rules
  styles/tokens.css  Every design token, light and dark, and the global base rules
  generated/prisma/  Generated Prisma client (git-ignored, written by prisma generate)
prisma/
  schema.prisma      Data model (matches docs/erd.md)
  migrations/        SQL migrations, including raw-SQL CHECK constraints and the partial index
  seed.ts            Development seed with the development-host guard
scripts/
  create-admin.ts    Creates or resets the development admin account (§4), with the seed's guard
tests/               Vitest tests; tests/db/ needs the development branch. tests/admin-actions.test.ts is the admin gate test
e2e/                 Playwright tests; global-setup.ts resets the e2e admin accounts listed in admin.ts
public/images/       Brand images
images/              Original brand images, the source of the copies in src/app/ and public/images/; hampers-natal.jpg is uploaded through the admin later
docs/                Design documents, ADRs and this guide
prisma.config.ts     Prisma CLI config: schema, migrations, seed command, DIRECT_URL
vercel.json          Function region sin1
```

The `@/` import alias points to `src/`. Files that the seed loads through Node (such as `src/lib/db.ts`) import relatively with a `.ts` extension, because Node's type stripping does not know the alias.

## 7. Conventions

**Styling**

- Components reference design tokens only (`var(--…)` from `src/styles/tokens.css`). The few literal colors allowed are listed in [design.md](design.md) §2.7. `tests/tokens.test.ts` checks that the tokens equal `design.md` §2 and rejects color literals in CSS Modules and components.
- One CSS Module per component, next to it. No global styles beyond `tokens.css`.
- Both themes are required. The theme is `data-theme` on `<html>`, stored in `localStorage['kagumi-theme']`, and applied by an inline script that is the first child of `<head>`, so there is no flash.
- `prefers-reduced-motion: reduce` is handled once, globally, in `tokens.css`.

**Data**

- Money is integer rupiah. Calendar dates and statistics use `Asia/Jakarta`.
- Enums are English in code and mapped to Indonesian labels in the UI.
- Database names are snake_case through `@@map` / `@map`; Prisma model and field names are camelCase.

**Language**

- All site copy (storefront and admin) is Bahasa Indonesia.
- Code, comments and files in `docs/` are English.

**Hard rules**

- No secret in tracked files: no connection string, host password or token in code, docs, tests or commit messages. Secrets live only in `.env*` (git-ignored) and in Vercel. `.env.example` lists names without values.
- No customer data (names, WhatsApp numbers, addresses, notes) in logs, docs or test fixtures.
- Never weaken or skip a failing test to make it pass.
- The generated Prisma client is never committed or edited.
- Documents link only to committed files.

## 8. Workflow

- **Branches.** `main` is the production branch; every push to it deploys production and migrates the production database. Daily work happens on `develop`. A milestone close merges `develop` into `main` with `git merge --ff-only develop` (§5). History on `main` is never rewritten.
- **Commits.** `type(task): summary`, where `type` is `feat`, `fix`, `test`, `docs` or `chore` and `task` is the task ID, for example `feat(M0.3): Prisma schema, init migration, Neon client, seed and schema test`.
- **Plan before code.** Work follows a milestone and task plan. Each task is planned and approved before files change, and is verified with the checks in §3 before it is committed.
- **Pull requests.** No pull-request process exists yet; work is committed directly on `develop`.

## 9. Common Pitfalls

| Symptom | Cause | Fix |
| --- | --- | --- |
| `npm run build` or `npm run dev` fails with `DATABASE_URL is not set` | No `.env`, or the variable is empty | Create `.env` from `.env.example` with the development values (§2) |
| `tests/db` or the seed stops with `… refusing to run` | `DATABASE_URL` is not the host in `DEV_DATABASE_HOST` | Run the host check (§2) and fix `.env`. Never "fix" the guard |
| `npm run typecheck` or `npm run build` fails in `.next/dev/types/validator.ts` with `Cannot find module ../../../src/app/page.js` after a route file was moved or deleted | `.next/dev/types` is left over from an earlier `npm run dev` | Start `npm run dev` or `npm run test:e2e` once; the dev server regenerates it |
| A migration diff drops a CHECK constraint or `product_media_one_main_per_product` | `schema.prisma` does not model the raw-SQL objects | Remove the drop from the SQL before applying (§4) |
| `prisma migrate dev` asks for a shadow database | It is the wrong command here | Use `migrate diff` and `migrate deploy` (§4) |
| npm warns that install scripts of `prisma` / `@prisma/engines` were skipped | npm 11 `allowScripts` | Harmless; nothing needs them |
| Vercel build log warns about the Node version | The Vercel project setting differs from `engines` | Harmless: `engines` (`24.x`) wins |
| Build fails while offline | `next/font/google` downloads Figtree at build time | Build with network access |
