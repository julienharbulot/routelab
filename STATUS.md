# RouteLab TS public status

Last updated: 2026-07-14

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
- Public opaque `PreparedRoutingContext` construction that defensively captures an already domain-validated snapshot, verifies its canonical checksum before derived state exists, and owns hidden reusable pool, asset, and deterministic-adjacency lookups.
- An additive `parseAndPrepareRoutingContext(input: unknown)` boundary that returns strict schema/domain failures before checksum verification, then delegates successful parsed snapshots to prepared-context construction; malformed pools expose no prepared capability.
- An accepted historical-source and dataset contract for Ethereum mainnet block 19,000,000, the canonical Uniswap V2 factory, a fixed 12-token selection policy, conservative raw-provider redistribution limits, and a deterministic future import boundary.
- A curated canonical import for that contract: one immutable 54-pool/12-asset snapshot, frozen policy, two normalized source views, exact reconciliation, canonical financial content, deterministic manifest, byte sizes, and SHA-256 hashes. Raw provider responses, logs, caches, credentials, and acquisition work remain excluded.
- A strict offline historical-dataset verifier and `pnpm verify:historical-data` CLI that enforce closed schemas, safe fixed artifact paths, byte/hash integrity, exact source agreement, reconciliation truth, raw UTF-16 pool ordering, canonical snapshot content/checksum, and parse-before-prepare acceptance before returning a reusable prepared context.
- A separately versioned exhaustive synthetic exact-input corpus and `pnpm verify:synthetic-requests` CLI: 396 result-blind requests cover all 132 ordered distinct allowlist pairs at three exact maximum-input-reserve fractions, with strict manifests, raw UTF-16 order, graph-only topology labels, SHA-256 identity, independent `bigint` derivation, and no router execution or runtime controls.
- Additive composed anytime split routing with mandatory exact direct establishment, one request-local shared path frontier, cardinality-two-or-more derived disjoint sets, six typed cumulative work caps, 13 counters, cooperative stops at every discretionary kind, and a monotonic exact incumbent.
- Additive canonical `routelab.split-router-run.v1` and `routelab.split-router-case.v1` records that contain cap-driven deterministic semantics only and accept supplied results/hashes only after strict reconstruction and fresh composed-runtime replay.
- Two fixed canonical split cases and deterministic `pnpm replay:split-cases` evidence for exact input `100`, best single/fallback `50`, allocations `50/50`, split output `66`, and unchanged single-path v1 hashes.
- An executable deterministic demo that runs full and zero-cap requests against one verified context and reports exact improvement `16`, both ledgers, and explicit fixture-only limitations.
- A separately checksummed six-profile comparison config and retained offline composed-runtime evaluation over all 396 synthetic requests: 2,376 exact semantic cells, 11,880 separate raw call-only observations, full receipts/counters/cell hashes, 396 terminal completions, and zero adjacent objective regressions or lost plans.
- An offline generator plus strict persisted verifier and `pnpm verify:historical-evaluation` gate that verify the corpus once, reuse its prepared context, directly invoke the composed runtime, reproduce semantic bytes, validate observation bindings, and keep environment/timing outside deterministic semantics.
- An internal deterministic path-shadow-price proposal core with pre-work configuration capture, exact primitive route models, one-update persistent numerical states, exact IEEE weight decoding, and `bigint` base-plus-residual reconstruction. Independent named and 576-cell evidence covers coefficients, normalization, solver outcomes, failure boundaries, and arbitrary precision; the core is nonauthorizing and is not a supported numerical router.
- An additive direct source-module numerical split runtime that resolves canonical pool-disjoint route sets from one prepared request context, retains the exact no-split/equal/greedy baseline, meters four numerical work kinds, assigns every reconstructed residual unit through exact option replay, and requires a distinct fresh full-input exact replay before an incumbent can improve. Frozen diagnostics report convergence, iterations, residuals, failures, and exact work; approximate values remain proposal-only.
- A separately checksummed, timing-free numerical evaluation over the identical Milestone 6 cohort: all 2,376 cells are retained, 414 result-blind eligible cells are freshly executed and verified, complete exact objectives/results/counters/diagnostics are preserved, and the four accepted decision clauses record numerical mode as primary with zero exact-objective regressions.
- Machine-checked public/private trace boundary and manifest-only engineering-log promotion.

## Current release gate

Milestones 0–5 are integrated and cumulatively reviewed complete for their accepted gates. Milestone 6 is integrated and cumulatively reviewed complete for the additive composed-runtime prerequisite, domain parsing before preparation, accepted historical source contract, canonical snapshot, separately versioned result-blind synthetic corpus, checksummed composed-runtime profile ladder, and fully retained/replayable offline evaluation; its exact completion commit passed CI. The independent Milestone 7a cumulative review concluded complete with no severity finding. It mapped the exact replay kernel, accepted numerical contract, proposal/reconstruction core, direct source-module runtime, failure-preserving exact authorization, identical-input retained evaluation, independent evidence, exact implementation commits and CI, compatibility surfaces, and bounded public claims to every outcome and gate clause. The evaluation keeps all 2,376 cells, freshly verifies all 414 eligible numerical results, records 318 improved, 96 equal, and zero regressed exact objectives, and satisfies all four mechanically derived clauses for artifact mode `primary`. This creates no default mode, performance conclusion, or global-optimality claim. The current gate is the exact Milestone 7a completion-commit integration; Milestone 7b remains blocked until it passes. No acquisition client, historical algorithm comparison, performance conclusion, split checkpoint/resume, default router clock, service, protocol adapter, default numerical mode, or learned ordering exists.

## Public evidence

- [Exact financial and deterministic invariants](docs/invariants.md)
- [Milestone 0 fixture derivations](fixtures/m0/README.md)
- [Fixture evidence classification](fixtures/m0/MANIFEST.md)
- [Canonical split replay fixtures](fixtures/pre-m6/split-router-cases/README.md)
- [Raw snapshot validation boundary decision](docs/adr/accepted/0002-validate-raw-snapshots-before-preparation.md)
- [Historical source and dataset contract](docs/adr/accepted/0003-historical-source-and-dataset-contract.md)
- [Path-level numerical allocation contract](docs/adr/accepted/0004-path-level-numerical-allocation.md)
- [Canonical historical dataset](datasets/ethereum-mainnet/uniswap-v2/block-19000000/core12-v1/README.md)
- [Synthetic exhaustive request corpus](datasets/requests/ethereum-mainnet-uniswap-v2/block-19000000/core12-v1/synthetic-exhaustive-v1/README.md)
- [Composed historical comparison config](fixtures/m6/composed-historical/README.md)
- [Composed historical evaluation](datasets/evaluations/ethereum-mainnet-uniswap-v2/block-19000000/core12-v1/synthetic-exhaustive-v1/composed-two-hop-pair-v3/README.md)
- [Numerical historical comparison inputs](fixtures/m7/numerical-historical/README.md)
- [Numerical path-shadow-price evaluation](datasets/evaluations/ethereum-mainnet-uniswap-v2/block-19000000/core12-v1/synthetic-exhaustive-v1/numerical-path-shadow-price-v1/README.md)
- [Engineering log](docs/engineering-log/README.md)
- [Technical roadmap](IMPLEMENTATION_PLAN.md)

## Next technical milestone

The cumulative Milestone 7a review is complete. After its exact public completion commit passes the release gate, the next technical task is a frozen identical-input Milestone 7b baseline profile that identifies measured bottlenecks before any sound-pruning or shortcut implementation is selected.

## Known limitations

- The executable demo and split replay command cover one fixed offline two-pool fixture; they support no performance, scaling, production, or unrestricted-optimality conclusion.
- Legacy Milestone 2–5 router entry points remain standalone compatibility/component surfaces. The additive high-level runtime is the composed split path; it does not add split resume or change legacy behavior.
- Canonical router-run/case v1 and `pnpm replay:cases` remain single-path-only and unchanged. Split evidence uses the additive `routelab.split-router-run.v1` / `routelab.split-router-case.v1` family and `pnpm replay:split-cases`.
- A work-limited success is best only among already-complete explored candidates; it makes no completeness or unrestricted optimality claim.
- Split routing is limited to pool-disjoint routes and configured no-split/equal/chunk-greedy baselines plus an additive direct source-module numerical option. The numerical path is deterministic, exactly authorized, and records primary under the frozen identical-input decision rule, but it is not a default mode and has no canonical run/case schema. Greedy and numerical work are explicitly bounded; integer flooring, zero-output eligibility, and approximate proposal limits can miss the tiny exhaustive optimum. No global allocation or route optimality is claimed, and RouteLab does not submit transactions, hold funds, or model a deployed protocol.
- Milestone 0 fixture JSON is hand-auditable evidence, not a public snapshot or replay schema; the pre-M6 split fixtures are canonical split case records.
- Raw snapshot-shaped input must use `parseAndPrepareRoutingContext` to enforce schema/domain parsing before checksum verification and preparation. The lower-level `prepareRoutingContext` remains a typed compatibility surface that checksum-verifies an already domain-validated snapshot; a TypeScript cast alone is not runtime validation. Legacy general routing still accepts caller-supplied opaque checksum identity, while canonical single/split run creation remains a verified execution boundary.
- The first historical import covers one frozen 12-token, 54-pool stored-reserve subset at one Ethereum block. It does not establish complete liquidity, historical order flow, token-transfer feasibility, transaction behavior, future state, live execution, or unrestricted optimality. Its 396-request synthetic corpus is exhaustive only over ordered pairs in that frozen allowlist, uses three fractions of each input asset's maximum incident reserve, can reflect hub/outlier bias, contains no disconnected or deeper topology, and is not equal-value or representative demand. Its evaluation compares six componentwise cap profiles of one bounded composed policy—not independent algorithms—and the retained raw observations support no statistical or performance inference. No acquisition client is tracked; raw provider material remains private under the accepted conservative redistribution boundary.
- Research references describe possible later directions and do not imply implementation or equivalence.
- Replay-case timings remain one observation per fixed M3 case with no warmup, repetition, comparison, threshold, statistical interpretation, output persistence, migration, or JSON resource-limit policy. The separate M4 anytime harness does not change their meaning.
- Immediate establishment covers canonical exact-replayable one-hop candidates only. With no eligible direct baseline, a zero search cap or already-reached deadline retains typed no-plan behavior.
- Non-interruptible bounded routing and canonical router-run/case v1 preserve their existing zero-expansion semantics and hashes; establishment accounting belongs to the interruptible, resumable, and deadline runtime APIs.
- Anytime latency samples cover one fixed offline input and two one-shot runtime variants. They are observational, retain raw values and environment metadata, and support no scaling, threshold, speedup, or general performance claim.
- Interruption predicates are operational controls only: replay is atomic, in-memory tokens are not serializable/persistable or valid across processes, and paused outcomes do not enter `routelab.router-run.v1` hashes.
- Deadline adapters require an injected monotonic clock and make no hard-latency guarantee. Legacy single-path adapters check between expansions; the composed split runtime checks before all six discretionary work kinds. Clock observations never enter canonical semantic records.
- Pool-disjoint set ordering is structural enumeration, not a financial preference. Candidate sets become financially eligible only after an explicit exact allocation reconstructs the input and exact split replay succeeds; the implemented baseline policies are not a global allocation search.
- Greedy partial replay receipts are scoring evidence only, including a final score that may cover the full amount. Only a distinct post-selection full-input replay can replace the exact fallback. Defensive final-replay failure accounting is retained, although disagreement with an identical successful final score is unreachable under the current captured pure model.
