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
- Deterministic offline case discovery and a versioned replay-case verification CLI that preserves raw semantic evidence while separating single-run timing and environment observations; it makes no benchmark or performance claim.
- Deterministic router-layer interruption at pre-expansion checkpoints; callback-visible incumbents are deeply frozen fresh exact replays, and interruption without one returns a typed no-plan outcome.
- Opaque, reusable and branchable process-local checkpoint tokens with absolute cumulative work caps, hidden immutable snapshot/frontier binding, cumulative counters, and clone-on-resume isolation.
- Optional cooperative deadline adapters using an injected absolute monotonic bigint clock at eligible pre-expansion boundaries, with deadline-specific outcomes and no timing leakage into checkpoint or hash state.
- Deterministic immediate incumbent establishment for interruptible, resumable, and deadline routing: every canonical direct candidate is fresh exact-replayed before the first user stop, the best valid direct receipt is retained, and establishment candidate/replay/rejection work is reported separately from search expansions.
- One-time establishment state carried through reusable checkpoint branches without recharge, with independently verified monotonic exact incumbent quality over increasing one-shot and cumulative resumed search work.
- A versioned fixed-input anytime measurement CLI that reports deterministic quality-versus-work separately from warmed, repeated, alternating algorithm-only latency observations with environment metadata and raw samples; it encodes no threshold or performance conclusion.
- Deterministic bounded enumeration of canonical pool-ID-disjoint route sets with separate path/set work counters and terminations; outputs are structural proposals only.
- Atomic exact replay of explicit canonical pool-disjoint split allocations: positive bigint legs sum exactly to the request, every route replays from the captured original snapshot, and no partial receipt escapes failure.
- Deterministic bounded split routing with an exact single-path fallback plus canonical equal-split proposals, exact remainder reconstruction, fresh split replay, explicit fallback/structural/allocation counters, and a complete split-plan tie key.
- Machine-checked public/private trace boundary and manifest-only engineering-log promotion.

## Current release gate

Milestones 0–4 are integrated locally. Milestone 5 now includes structural pool-disjoint candidates, exact split replay, and exact no-split/equal-split baselines with a safe fallback. The Milestone 5 gate remains open pending bounded greedy allocation and independent exhaustive tiny-allocation comparison. No serialized checkpoint, cross-process resume, default router clock, general statistical performance conclusion, historical dataset, service, protocol adapter, or learned ordering exists.

## Public evidence

- [Exact financial and deterministic invariants](docs/invariants.md)
- [Milestone 0 fixture derivations](fixtures/m0/README.md)
- [Fixture evidence classification](fixtures/m0/MANIFEST.md)
- [Engineering log](docs/engineering-log/README.md)
- [Technical roadmap](IMPLEMENTATION_PLAN.md)

## Next technical milestone

Complete Milestone 5 split allocation by adding a bounded deterministic greedy baseline only after the independent tiny exhaustive allocation oracle is in place. Compare greedy/no-split/equal candidates against that oracle on tiny inputs, preserve the exact fallback under every proposal failure or work limit, retain large-integer exact-sum evidence, and do not claim optimality beyond the evaluated candidate/allocation space.

## Known limitations

- The demo reports repository capability only; it does not execute a snapshot, quote, transition, replay, or route.
- A work-limited success is best only among already-complete explored candidates; it makes no completeness or unrestricted optimality claim.
- Split routing is limited to pool-disjoint routes and currently evaluates only no-split and canonical equal-split allocations. It has no greedy/approximate allocator and does not submit transactions, hold funds, or model a deployed protocol.
- Fixture JSON is hand-auditable evidence, not a public snapshot or replay schema.
- Domain parsing and general routing still accept caller-supplied opaque checksum identity; canonical computation/verification is explicit and never silently rewrites it. Canonical run creation is the narrower verified execution boundary.
- Research references describe possible later directions and do not imply implementation or equivalence.
- Replay-case timings remain one observation per fixed M3 case with no warmup, repetition, comparison, threshold, statistical interpretation, output persistence, migration, or JSON resource-limit policy. The separate M4 anytime harness does not change their meaning.
- Immediate establishment covers canonical exact-replayable one-hop candidates only. With no eligible direct baseline, a zero search cap or already-reached deadline retains typed no-plan behavior.
- Non-interruptible bounded routing and canonical router-run/case v1 preserve their existing zero-expansion semantics and hashes; establishment accounting belongs to the interruptible, resumable, and deadline runtime APIs.
- Anytime latency samples cover one fixed offline input and two one-shot runtime variants. They are observational, retain raw values and environment metadata, and support no scaling, threshold, speedup, or general performance claim.
- Interruption predicates are operational controls only: replay is atomic, in-memory tokens are not serializable/persistable or valid across processes, and paused outcomes do not enter `routelab.router-run.v1` hashes.
- Deadline adapters require an injected monotonic clock, check only between expansions, make no hard-latency guarantee, and expose no clock samples or configuration in semantic results.
- Pool-disjoint set ordering is structural enumeration, not a financial preference. Candidate sets become financially eligible only after an explicit exact allocation reconstructs the input and exact split replay succeeds; the implemented baseline policies are not a global allocation search.
