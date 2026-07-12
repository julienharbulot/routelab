# RLT-011 — Exact constant-product quote and transition

This curated example illustrates a bounded task packet. It is not an active assignment.

## Outcome

Implement exact integer quoting and immutable reserve transition for a validated two-asset constant-product pool.

## Why this is next

Every later replay and routing result depends on correct pool execution. Graph search cannot begin until this gate passes.

## Prerequisite evidence and frozen contract

Read `docs/invariants.md`, integrated domain types from RLT-010, and `fixtures/m0/`. Fee meaning, the single-final-floor formula, zero/tiny-input policy, gross-input reserve credit, immutability, and typed failures are frozen.

## Write scope

- Builder: `src/pools/constant-product/**` and focused production tests explicitly assigned by the lead.
- Oracle: separate assigned reference/property test paths; no production edits.
- Reviewer: read-only review of the candidate, invariants, fixtures, and affected call sites.

## Non-goals

No graph types, route search, generalized pool framework, approximate arithmetic, gas costs, API, dependency, fixture rewrite without a proven fixture defect, or public contract redesign.

## Acceptance criteria

- Both directions match independent golden values.
- Quote and transition retain exact `bigint` values and never mutate inputs.
- Zero input is the defined no-op; positive input rounding to zero is ineligible for transition.
- Large integers, fee boundaries, output reserve safety, monotonic output, and nondecreasing reserve product are covered independently.
- Typed failures expose no partial state and no unrelated file changes exist.

## Verification

```bash
pnpm test:pool
pnpm typecheck
pnpm lint
pnpm check
```

## Required report

State role/task ID, files changed or inspected, exact commands/results, independent expected-value source, assumptions, reproducers or unresolved risks, semantic/API effects, diff summary, and recommended lead action. No role merges, pushes, or accepts the gate.
