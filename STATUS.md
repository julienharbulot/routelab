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
- Oracle-first bounded greedy allocation over canonical pool-disjoint route sets: exact quotient/remainder chunks, exact partial scoring, explicit evaluation caps/frontiers, a distinct full-input authorization replay, fallback-preserving failures, and full-objective incumbent updates.
- A standalone tiny exhaustive allocation oracle and black-box production comparison covering exact compositions, quality bounds, a named unit-chunk optimum, a coarse suboptimal case, a zero-output activation barrier, arbitrary-precision reconstruction, and the allocation-vector tie.
- Machine-checked public/private trace boundary and manifest-only engineering-log promotion.

## Current release gate

Milestones 0–5 remain integrated and cumulatively reviewed complete for their accepted component gates. A newly added pre-Milestone 6 integration gate is now active: the Milestone 4 anytime controls and Milestone 5 split components must be composed under one canonically verified prepared context, shared discovery, non-recharged request controls, canonical split evidence, and an executable split demo. Milestone 6 historical data and credible evaluation is blocked until that gate closes. No serialized split checkpoint, cross-process resume, default router clock, general statistical performance conclusion, historical dataset, service, protocol adapter, numerical allocator, or learned ordering exists.

## Public evidence

- [Exact financial and deterministic invariants](docs/invariants.md)
- [Milestone 0 fixture derivations](fixtures/m0/README.md)
- [Fixture evidence classification](fixtures/m0/MANIFEST.md)
- [Engineering log](docs/engineering-log/README.md)
- [Technical roadmap](IMPLEMENTATION_PLAN.md)

## Next technical milestone

The pre-Milestone 6 composed-runtime gate is next. It must add a canonically verified prepared snapshot context, shared path and candidate-set discovery, non-recharged request controls spanning split allocation, exact incumbent preservation under interruption/deadline, canonical split run/case evidence, and an executable offline split demo. Historical source selection may be researched privately, but no M6 benchmark or data-integration claim is eligible until this gate closes.

## Known limitations

- The demo reports repository capability only; it does not execute a snapshot, quote, transition, replay, or route.
- The Milestone 4 anytime runtime and Milestone 5 split routers are exact but not yet composed. The split entry points independently rebuild/discover structural work, use stage-local caps that can be charged again by a caller chain, and expose no single request-wide deadline, cancellation control, or incumbent progression.
- Canonical router-run/case v1 and `pnpm replay:cases` remain single-path-only; no split plan currently has a canonical determinism record.
- A work-limited success is best only among already-complete explored candidates; it makes no completeness or unrestricted optimality claim.
- Split routing is limited to pool-disjoint routes and configured no-split/equal/chunk-greedy policies. Greedy parts and evaluation work are explicitly bounded; integer flooring and zero-output eligibility can make unit chunks miss the tiny exhaustive optimum. No global allocation or route optimality is claimed, and RouteLab does not submit transactions, hold funds, or model a deployed protocol.
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
- Greedy partial replay receipts are scoring evidence only, including a final score that may cover the full amount. Only a distinct post-selection full-input replay can replace the exact fallback. Defensive final-replay failure accounting is retained, although disagreement with an identical successful final score is unreachable under the current captured pure model.
