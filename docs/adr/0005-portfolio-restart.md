# ADR 0005: Restart from the numerical runtime and optimize for a usable release

- **Status:** Accepted by project owner
- **Date:** 2026-07-15
- **Base commit:** `cdc5a83b47ca35e9173a41e95f7e32e81e4f9d85`

## Context

RouteLab reached an exactly authorized numerical split runtime, then expanded into retained evaluation, profiling, service-policy preservation, source closure, and experiment-publication machinery.

That later work increased repository and workflow size without producing the portfolio surfaces that another engineer needs: a small API, readable quote command, concise benchmark, quote service, load evidence, and intent adapter.

The project is not a regulated execution service and does not custody funds or submit transactions. Git history, versioned inputs, exact replay, focused differential tests, and compact benchmark output are sufficient for v0.1.

## Decision

Restart active development from `cdc5a83`.

Keep:

- exact pool and replay semantics;
- bounded route and split discovery;
- exact fallback behavior;
- path-shadow-price allocation;
- deterministic integer reconstruction;
- fresh exact authorization;
- retained offline snapshot and compact request inputs.

Remove or replace:

- generated retained evaluation output;
- historical experiment publication machinery;
- source-closure/provenance workflow;
- overlapping legacy public router APIs;
- duplicate replay record families;
- process-heavy agent governance;
- duplicate oracle bulk that protects obsolete APIs.

Complete v0.1 by adding one public facade, CLI, benchmark, local service, load measurement, and fixture-only NEAR Intents quote adapter.

## Consequences

Positive:

- product value becomes visible;
- the codebase becomes easier to review;
- the target role’s algorithm, TypeScript, quote, and performance concerns are represented;
- future optimization becomes evidence-led;
- negative results can still be reported without carrying a publication system.

Trade-offs:

- some historical internal APIs and evidence formats are deliberately abandoned;
- v0.1 does not select a specially optimized “service-fast” numerical policy;
- one historical snapshot limits external validity;
- the service is a local integration demonstration, not a live solver.

## Deferred decisions

Reconsider only after v0.1 measurements:

- worker threads;
- graph indexing;
- learned ordering;
- more historical snapshots;
- live solver relay integration;
- signing and settlement.
