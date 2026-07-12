# RouteLab TS public status

Last updated: 2026-07-12

## Target release

`v0.1`: deterministic offline exact-input routing over immutable snapshots of two-asset constant-product pools.

## Implemented public capabilities

- Strict single-package TypeScript walking skeleton with lint, typecheck, tests, and deterministic offline demo.
- Accepted exact amount, fee, rounding, reserve-transition, snapshot, validation, incumbent, and deterministic semantics.
- Six hand-auditable JSON fixtures for direct, multi-hop, split-comparison, fee, disconnected, and rounding scenarios.
- Machine-checked public/private trace boundary and manifest-only engineering-log promotion.

## Current release gate

Milestone 0 semantic contract and fixture evidence are complete locally. No pool, snapshot-domain, replay, graph-search, allocation, service, adapter, or learned-ordering implementation exists. CI for the trace-boundary migration remains unverified until a matching commit is pushed and a run completes.

## Public evidence

- [Exact financial and deterministic invariants](docs/invariants.md)
- [Milestone 0 fixture derivations](fixtures/m0/README.md)
- [Fixture evidence classification](fixtures/m0/MANIFEST.md)
- [Engineering log](docs/engineering-log/README.md)
- [Technical roadmap](IMPLEMENTATION_PLAN.md)

## Next technical milestone

Milestone 1 begins with minimal domain and immutable snapshot validation. It must not implement pool math or routing in the same slice.

## Known limitations

- The demo reports repository capability only; it does not quote or route assets.
- Fixture JSON is hand-auditable evidence, not a public snapshot or replay schema.
- Research references describe possible later directions and do not imply implementation or equivalence.
- No current migration commit has matching CI evidence.
