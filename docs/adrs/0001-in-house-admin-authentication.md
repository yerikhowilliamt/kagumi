# ADR-0001: In-house admin authentication with Node `crypto`

## Status
Accepted — 2026-11-15

## Context
The admin dashboard needs a login. There is exactly one admin (the shop owner). There's no sign-up, no social login, no roles and no "forgot password" flow ([PRD](../prd.md) FR15–21, Non-Goals). The developer wants to avoid third-party dependencies where the need is small. The app runs on Next.js Server Actions and Route Handlers on Vercel, with Neon Postgres as the only data store ([System Design](../system-design.md) §4.4).

Next.js middleware is not a reliable security boundary on its own: CVE-2025-29927 allowed middleware to be bypassed with a crafted header.

## Decision
Build authentication in-house with Node's built-in `crypto` module and the existing database:

- Passwords hashed with `crypto.scrypt` (N=16384, r=8, p=1, 64-byte key, 16-byte random salt), stored with their parameters so they can be raised later.
- Sessions are 32-byte random tokens in an `HttpOnly; Secure; SameSite=Lax` cookie. Only `sha256(token)` is stored in `sessions`, with a 7-day expiry.
- Lockout after 5 failed logins for 15 minutes. One generic error message. `timingSafeEqual` for comparisons, and a dummy hash for unknown emails.
- `requireAdmin()` is called inside every admin page layout, Server Action, Route Handler and upload-signing action. Middleware/proxy only redirects for convenience.
- The account is created and reset by `scripts/create-admin.ts` from environment variables.

## Alternatives Considered
- **Better Auth / Auth.js (credentials provider):** proven and maintained, but built for many users, providers and flows we don't need. It adds a dependency, its own tables or adapter, and configuration to learn, all for one account. Rejected as more surface than the problem.
- **Hosted auth (Clerk, Supabase Auth, Neon Auth):** no security code to maintain, but adds an external service, a vendor account and possible cost for a single user. It also splits user data away from our database. Rejected.
- **HTTP Basic Auth on `/admin`:** trivial to build, but no logout, no lockout, poor mobile UX, and credentials sent on every request. Rejected.

## Consequences
**Positive**
- No auth dependency to update or audit. About 150 lines of code we fully understand.
- Sessions live in our own Postgres, so revocation (logout, "log out everywhere") is a row delete.
- A DB leak doesn't expose usable sessions (hashed tokens) or passwords (scrypt).

**Negative / risks**
- The security details are our responsibility. A mistake (a missing `requireAdmin()`, a weak cookie flag) is a real vulnerability. Mitigated by the verification plan (System Design §10): a test that calls every admin action without a session, plus a manual security review before launch.
- Adding staff accounts, roles or 2FA later means building them ourselves, or migrating to a library at that point.
- Password reset requires developer access (running the script). This is acceptable for one owner who has the developer's help.
