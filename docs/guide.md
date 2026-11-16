# Developer Guide: Kagumi Dough

**Status:** Current as of M0 Foundation (2026-11-16)

Every command in this guide was run during M0 or is a script in `package.json`. When the guide and `package.json` differ, `package.json` is right and the guide is corrected. A new command is added here only after it has been run.

## 1. Project Overview

Kagumi Dough is the website of a homemade bakery in Surakarta (Solo): a storefront with a cart that sends one prefilled WhatsApp order, and an admin dashboard for products and media, orders and statistics.

After M0 the repository holds the foundation only: design tokens and the theme toggle, the full database schema with one migration, a development seed, and a placeholder home page that shows the number of active products. M1 replaces that page with the static storefront.

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

`npm run build`, `npm run dev`, `npm test` and `npm run test:e2e` all need `.env`. Without `DATABASE_URL` the build fails with `DATABASE_URL is not set`, because the home page imports `src/lib/db.ts`.

### Check which database you are pointing at

Run this before any command that writes to a database (tests, seed, migrations). It prints only the host and database name of `DIRECT_URL`, never the URL:

```sh
node -e "process.loadEnvFile(); const u = new URL(process.env.DIRECT_URL); console.log(u.hostname, u.pathname.slice(1))"
```

The output must be `ep-noisy-fog-a1x76fct.ap-southeast-1.aws.neon.tech neondb`. If it is anything else, stop: your `.env` points at the wrong branch.

### Run locally

```sh
npm run dev
```

Open http://localhost:3000. The page shows `Produk aktif: N`, read from the development branch.

## 3. Commands

Every script in `package.json`:

| Command | Runs | What it does |
| --- | --- | --- |
| `npm run dev` | `next dev` | Development server on port 3000 |
| `npm run build` | `next build` | Production build. Applies no migration and writes to no database. It may read: the static storefront of M1 reads products at build time, locally from the development branch in `.env` |
| `npm run start` | `next start` | Serves the output of `npm run build` |
| `npm run lint` | `eslint .` | Lint. `src/generated/` and `.vercel/` are ignored |
| `npm run typecheck` | `next typegen && tsc --noEmit` | Generates Next.js route types, then type-checks |
| `npm test` | `vitest run` | All Vitest tests, **including `tests/db`**, which connect to the development branch and write inside transactions that are always rolled back |
| `npm run test:unit` | `vitest run --exclude 'tests/db/**'` | Vitest tests that need no database |
| `npm run test:e2e` | `playwright test` | Playwright tests in `e2e/` at 360 px and desktop width. Starts `npm run dev` itself unless `PLAYWRIGHT_BASE_URL` is set. Until M1 the home page queries the database on each request, so this run reads the development branch and fails when Neon is down |
| `npm run vercel-build` | `prisma migrate deploy && next build` | **Run by Vercel only**, instead of `build`. Applies pending migrations to the branch of that Vercel environment, then builds. Never run it locally |
| `postinstall` | `prisma generate` | Runs automatically after `npm ci`; regenerates the Prisma client |

The checks every change must pass:

```sh
npm run lint
npm run typecheck
npm test
```

Other commands run during M0:

| Command | Purpose |
| --- | --- |
| `npx vitest run tests/db` | Only the database tests |
| `PLAYWRIGHT_BASE_URL=https://kagumi-dough.vercel.app npx playwright test e2e/theme.spec.ts` | The theme tests against production, with no local server. Read-only |

## 4. Database

### The two Neon branches

| Branch | Used by | Who writes to it |
| --- | --- | --- |
| production | The Vercel production deployment | Only the production build (`vercel-build`) and the running app. Never a developer machine: no tests, seeds, scripts or Prisma CLI commands |
| development | Local development, tests, the seed, Vercel preview deployments | Developers, tests and the preview build |

**The development branch is the disposable database:** host `ep-noisy-fog-a1x76fct.ap-southeast-1.aws.neon.tech` (the pooled host adds `-pooler` to the first label), database `neondb`. Tests, seeds and scripts run only against it. Connection strings and passwords are never written into the repository.

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

This runs `node prisma/seed.ts` (configured in `prisma.config.ts`). It inserts the 7 sample products into an empty `products` table and does nothing when products exist (`products already has 7 rows; nothing inserted`). It refuses to run unless the host of `DATABASE_URL`, without `-pooler`, equals `DEV_DATABASE_HOST`. Never seed production.

### Schema test

`tests/db/schema.test.ts` compares the database catalog (tables, enums, columns, CHECK constraints, indexes, foreign keys) with the ERD, and checks constraint behavior in transactions that always roll back. It runs as part of `npm test`, uses the same `DEV_DATABASE_HOST` guard as the seed, and connects through `src/lib/db.ts`.

## 5. Environments and Deploy

| Environment | Git branch | Database | Migrations |
| --- | --- | --- | --- |
| Production (`https://kagumi-dough.vercel.app`) | `main` | Neon production branch | `vercel-build` runs `prisma migrate deploy` before `next build`. A failed migration fails the build, and the previous deployment keeps serving |
| Preview | every other branch, in practice `develop` | Neon development branch | Same build step, against the development branch |
| Local | — | Neon development branch, from `.env` | By hand (§4) |

**Vercel variables.** `DATABASE_URL` and `DIRECT_URL` are entered by hand per Vercel environment: production values in Production only, development values in Preview only, nothing in Development. The Neon Vercel integration is not installed, because it would create a database branch per preview deployment while previews must use the one development branch. Changing Vercel or Neon settings is done by the project owner.

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
  app/               App Router: layout.tsx (fonts, theme script), page.tsx (placeholder), icons
    fonts/           Self-hosted Switzer font files
  components/        Shared components with their CSS Modules (ThemeToggle)
  lib/db.ts          The Prisma client on the pooled URL through @prisma/adapter-neon
  styles/tokens.css  Every design token, light and dark, and the global base rules
  generated/prisma/  Generated Prisma client (git-ignored, written by prisma generate)
prisma/
  schema.prisma      Data model (matches docs/erd.md)
  migrations/        SQL migrations, including raw-SQL CHECK constraints and the partial index
  seed.ts            Development seed with the development-host guard
tests/               Vitest tests; tests/db/ needs the development branch
e2e/                 Playwright tests
public/images/       Brand images
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
| `npm run test:e2e` fails on the home page while other tests pass | The development branch is unreachable (the page queries it until M1) | Check Neon, then rerun |
| A migration diff drops a CHECK constraint or `product_media_one_main_per_product` | `schema.prisma` does not model the raw-SQL objects | Remove the drop from the SQL before applying (§4) |
| `prisma migrate dev` asks for a shadow database | It is the wrong command here | Use `migrate diff` and `migrate deploy` (§4) |
| npm warns that install scripts of `prisma` / `@prisma/engines` were skipped | npm 11 `allowScripts` | Harmless; nothing needs them |
| Vercel build log warns about the Node version | The Vercel project setting differs from `engines` | Harmless: `engines` (`24.x`) wins |
| Build fails while offline | `next/font/google` downloads Figtree at build time | Build with network access |
