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
- Machine-checked public/private trace boundary and manifest-only engineering-log promotion.

## Current release gate

Milestones 0–2 are integrated, and the first two Milestone 3 slices now define canonical snapshot financial-content bytes/checksums and an in-memory checksum-verified bounded-router run/determinism hash. The general router still treats supplied checksums as pinned opaque identity; the canonical-run boundary performs verification. No canonical run parser or persisted case format, benchmark CLI, split allocation, service, adapter, or learned ordering exists.

## Public evidence

- [Exact financial and deterministic invariants](docs/invariants.md)
- [Milestone 0 fixture derivations](fixtures/m0/README.md)
- [Fixture evidence classification](fixtures/m0/MANIFEST.md)
- [Engineering log](docs/engineering-log/README.md)
- [Technical roadmap](IMPLEMENTATION_PLAN.md)

## Next technical milestone

Milestone 3 continues with parsing and round-trip validation for versioned offline canonical run cases before benchmark tooling is added.

## Known limitations

- The demo reports repository capability only; it does not execute a snapshot, quote, transition, replay, or route.
- A work-limited success is best only among already-complete explored candidates; it makes no completeness or unrestricted optimality claim.
- The router is single-path only and does not split liquidity, submit transactions, hold funds, or model a deployed protocol.
- Fixture JSON is hand-auditable evidence, not a public snapshot or replay schema.
- Domain parsing and general routing still accept caller-supplied opaque checksum identity; canonical computation/verification is explicit and never silently rewrites it. Canonical run creation is the narrower verified execution boundary.
- Research references describe possible later directions and do not imply implementation or equivalence.
- Canonical router-run records are in-memory writer output only; no parser, persisted case compatibility, benchmark execution, or timing record exists yet.
