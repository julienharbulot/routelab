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
- Canonical immutable directional adjacency and deterministic simple-path enumeration under explicit hop and edge-expansion limits; candidates remain non-authorizing proposals.
- Exact bounded single-path routing: every complete proposal is fresh-replayed, invalid candidates preserve the incumbent, and exact output/fewer-hop/raw-route-key ordering selects the plan.
- Canonical `routelab.snapshot.v1` financial-content serialization with pool-order independence and `sha256:` checksum computation/verification.
- Canonical `routelab.router-run.v1` in-memory bounded-router execution records with checksum verification, exact semantic result/counter projection, observation exclusion, and a prefixed determinism hash.
- Strict in-memory canonical-run parsing that reconstructs snapshot/request inputs and accepts supplied result bytes and hashes only after fresh exact bounded-router replay reproduces them.
- Canonical `routelab.router-case.v1` in-memory create/parse verification and three fixed offline success/no-route/no-plan case files with documented byte counts, file hashes, and run hashes.
- Deterministic offline case discovery and a versioned benchmark-report CLI that preserves raw semantic evidence while separating single-run timing and environment observations; it makes no performance claim.
- Deterministic router-layer interruption at pre-expansion checkpoints; callback-visible incumbents are deeply frozen fresh exact replays, and interruption without one returns a typed no-plan outcome.
- Machine-checked public/private trace boundary and manifest-only engineering-log promotion.

## Current release gate

Milestones 0–3 and the first Milestone 4 interruption slice are integrated locally. Deterministic interruption preserves legacy results and exposes only entry-captured, exact-replayed incumbents; interrupted outcomes are not persisted or hashed. No resumable checkpoint, wall-clock deadline, statistical performance harness, split allocation, service, adapter, or learned ordering exists.

## Public evidence

- [Exact financial and deterministic invariants](docs/invariants.md)
- [Milestone 0 fixture derivations](fixtures/m0/README.md)
- [Fixture evidence classification](fixtures/m0/MANIFEST.md)
- [Engineering log](docs/engineering-log/README.md)
- [Technical roadmap](IMPLEMENTATION_PLAN.md)

## Next technical milestone

Milestone 4 continues with resumable checkpoint state before any optional wall-clock deadline mode.

## Known limitations

- The demo reports repository capability only; it does not execute a snapshot, quote, transition, replay, or route.
- A work-limited success is best only among already-complete explored candidates; it makes no completeness or unrestricted optimality claim.
- The router is single-path only and does not split liquidity, submit transactions, hold funds, or model a deployed protocol.
- Fixture JSON is hand-auditable evidence, not a public snapshot or replay schema.
- Domain parsing and general routing still accept caller-supplied opaque checksum identity; canonical computation/verification is explicit and never silently rewrites it. Canonical run creation is the narrower verified execution boundary.
- Research references describe possible later directions and do not imply implementation or equivalence.
- Benchmark timings are one observation per fixed offline case with no warmup, repetition, comparison, threshold, statistical interpretation, output persistence, migration, or JSON resource-limit policy.
- Interruption predicates are operational controls only: replay is atomic, checkpoints are not serializable/resumable, and interrupted outcomes do not enter `routelab.router-run.v1` hashes.
