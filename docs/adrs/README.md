# Architecture Decision Records — kagumi

The architecture decisions that shape kagumi: the choices that are expensive to reverse, or that the system's correctness depends on. Smaller decisions and configured values stay in the [System Design](../system-design.md) and do not get an ADR.

## Index

Add every new ADR as the last row.

| ADR | Decision | Status |
| --- | --- | --- |
| [0001](0001-in-house-admin-authentication.md) | In-house admin authentication with Node `crypto` | Accepted — 2026-11-15 |
| [0002](0002-prisma-on-neon-serverless.md) | Prisma ORM on Neon serverless Postgres | Accepted — 2026-11-15 |
| [0003](0003-in-house-analytics-events.md) | In-house analytics with an events table | Accepted — 2026-11-15 |

## Conventions

- One file per decision: `NNNN-kebab-case-title.md`, numbered from `0001`, never reused.
- Status: `Proposed`, `Accepted`, `Superseded by ADR-NNNN` or `Deprecated`, with a date.
- An accepted ADR is not edited. A change is a new ADR; the only edit to the old one is its status line.
- Written with the `adr-writer` skill.

## Template

```markdown
# ADR-NNNN: <Short decision title>

## Status
Proposed | Accepted | Superseded by ADR-NNNN — YYYY-MM-DD

## Context
<The forces and constraints that led here>

## Decision
<What was decided>

## Alternatives Considered
<Genuine contenders only, each with the reason it lost>

## Consequences
<Positive, then negative and risks>
```
