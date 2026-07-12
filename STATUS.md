# RouteLab TS public status

Last updated: 2026-07-12

## Target release

`v0.1`: deterministic offline exact-input routing over immutable snapshots of two-asset constant-product pools.

## Implemented public capabilities

- Strict single-package TypeScript walking skeleton with lint, typecheck, tests, and deterministic offline demo.
- Accepted exact amount, fee, rounding, reserve-transition, snapshot, validation, incumbent, and deterministic semantics.
- Six hand-auditable JSON fixtures for direct, multi-hop, split-comparison, fee, disconnected, and rounding scenarios.
- Minimal runtime-frozen constant-product pool and liquidity-snapshot domain values with dependency-free, typed validation from canonical decimal strings into `bigint`.
- Machine-checked public/private trace boundary and manifest-only engineering-log promotion.

## Current release gate

Milestone 0 semantic contract and fixture evidence are complete. The first Milestone 1 slice validates immutable pool and snapshot-domain values. No quote, reserve transition, replay, graph-search, allocation, service, adapter, or learned-ordering implementation exists.

## Public evidence

- [Exact financial and deterministic invariants](docs/invariants.md)
- [Milestone 0 fixture derivations](fixtures/m0/README.md)
- [Fixture evidence classification](fixtures/m0/MANIFEST.md)
- [Engineering log](docs/engineering-log/README.md)
- [Technical roadmap](IMPLEMENTATION_PLAN.md)

## Next technical milestone

Milestone 1 continues with exact constant-product quote and immutable reserve transition behavior. Replay and routing remain later slices.

## Known limitations

- The demo reports repository capability only; it does not parse snapshots, quote, transition, or route assets.
- Fixture JSON is hand-auditable evidence, not a public snapshot or replay schema.
- Snapshot checksums are accepted only as supplied opaque identity; canonical serialization and checksum computation remain deferred.
- Research references describe possible later directions and do not imply implementation or equivalence.
- The new domain slice requires matching CI evidence after its integration commit is pushed.
