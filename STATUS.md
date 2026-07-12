# RouteLab TS public status

Last updated: 2026-07-13

## Target release

`v0.1`: deterministic offline exact-input routing over immutable snapshots of two-asset constant-product pools.

## Implemented public capabilities

- Strict single-package TypeScript walking skeleton with lint, typecheck, tests, and deterministic offline demo.
- Accepted exact amount, fee, rounding, reserve-transition, snapshot, validation, incumbent, and deterministic semantics.
- Six hand-auditable JSON fixtures for direct, multi-hop, split-comparison, fee, disconnected, and rounding scenarios.
- Minimal runtime-frozen constant-product pool and liquidity-snapshot domain values with dependency-free, typed validation from canonical decimal strings into `bigint`.
- Exact bigint constant-product quote and immutable reserve transition in both directions, with frozen typed failures and deterministic directional receipts.
- Exact atomic replay of an explicitly supplied simple directional route, pinned by snapshot ID and checksum, with sequential hop outputs and complete frozen receipts.
- Machine-checked public/private trace boundary and manifest-only engineering-log promotion.

## Current release gate

Milestone 0 evidence and the Milestone 1 exact execution kernel are complete locally. The kernel validates immutable pool/snapshot values, executes exact constant-product transitions, and replays one caller-supplied simple route atomically. No adjacency graph, route discovery, best-plan selection, allocation, service, adapter, or learned-ordering implementation exists.

## Public evidence

- [Exact financial and deterministic invariants](docs/invariants.md)
- [Milestone 0 fixture derivations](fixtures/m0/README.md)
- [Fixture evidence classification](fixtures/m0/MANIFEST.md)
- [Engineering log](docs/engineering-log/README.md)
- [Technical roadmap](IMPLEMENTATION_PLAN.md)

## Next technical milestone

Milestone 2 begins with deterministic adjacency and bounded simple-path enumeration. Exact best-plan selection follows only after that graph slice is verified.

## Known limitations

- The demo reports repository capability only; it does not execute a snapshot, quote, transition, replay, or route.
- Replay accepts an explicit valid route candidate; it does not discover paths, return a graph-level no-route outcome, or select an incumbent.
- Fixture JSON is hand-auditable evidence, not a public snapshot or replay schema.
- Snapshot checksums are accepted only as supplied opaque identity; canonical serialization and checksum computation remain deferred.
- Research references describe possible later directions and do not imply implementation or equivalence.
- The exact replay slice requires matching CI evidence after its integration commit is pushed.
