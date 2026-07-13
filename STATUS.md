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
- Machine-checked public/private trace boundary and manifest-only engineering-log promotion.

## Current release gate

Milestones 0–5 remain integrated and cumulatively reviewed complete for their accepted component gates. The additive pre-Milestone 6 integration gate is also complete under cumulative review: Milestone 4 anytime controls and Milestone 5 split policies now compose under one verified prepared context, shared discovery, non-recharged request controls, canonical split evidence, and an executable split demo. The first Milestone 6 prerequisites now enforce domain parsing before preparation and provide an accepted historical source contract, canonical one-snapshot import, and separately versioned synthetic exhaustive request corpus. A separately checksummed composed-runtime comparison profile and historical evaluation are next. No acquisition client, historical algorithm result, or performance conclusion exists. No split checkpoint/resume, default router clock, service, protocol adapter, numerical allocator, or learned ordering exists.

## Public evidence

- [Exact financial and deterministic invariants](docs/invariants.md)
- [Milestone 0 fixture derivations](fixtures/m0/README.md)
- [Fixture evidence classification](fixtures/m0/MANIFEST.md)
- [Canonical split replay fixtures](fixtures/pre-m6/split-router-cases/README.md)
- [Raw snapshot validation boundary decision](docs/adr/accepted/0002-validate-raw-snapshots-before-preparation.md)
- [Historical source and dataset contract](docs/adr/accepted/0003-historical-source-and-dataset-contract.md)
- [Canonical historical dataset](datasets/ethereum-mainnet/uniswap-v2/block-19000000/core12-v1/README.md)
- [Synthetic exhaustive request corpus](datasets/requests/ethereum-mainnet-uniswap-v2/block-19000000/core12-v1/synthetic-exhaustive-v1/README.md)
- [Engineering log](docs/engineering-log/README.md)
- [Technical roadmap](IMPLEMENTATION_PLAN.md)

## Next technical milestone

Milestone 6 historical data and credible evaluation remains next. Its untrusted-input boundary, historical-source decision, canonical one-snapshot import, and separately versioned result-blind request corpus are integrated. The next task must freeze a separate comparison configuration, execute the primary measurement through the composed runtime on the verified shared context, retain raw results and environment metadata, and enforce identical corpus/config identity across comparisons. No historical algorithm comparison, benchmark, or performance claim exists yet.

## Known limitations

- The executable demo and split replay command cover one fixed offline two-pool fixture; they support no performance, scaling, production, or unrestricted-optimality conclusion.
- Legacy Milestone 2–5 router entry points remain standalone compatibility/component surfaces. The additive high-level runtime is the composed split path; it does not add split resume or change legacy behavior.
- Canonical router-run/case v1 and `pnpm replay:cases` remain single-path-only and unchanged. Split evidence uses the additive `routelab.split-router-run.v1` / `routelab.split-router-case.v1` family and `pnpm replay:split-cases`.
- A work-limited success is best only among already-complete explored candidates; it makes no completeness or unrestricted optimality claim.
- Split routing is limited to pool-disjoint routes and configured no-split/equal/chunk-greedy policies. Greedy parts and evaluation work are explicitly bounded; integer flooring and zero-output eligibility can make unit chunks miss the tiny exhaustive optimum. No global allocation or route optimality is claimed, and RouteLab does not submit transactions, hold funds, or model a deployed protocol.
- Milestone 0 fixture JSON is hand-auditable evidence, not a public snapshot or replay schema; the pre-M6 split fixtures are canonical split case records.
- Raw snapshot-shaped input must use `parseAndPrepareRoutingContext` to enforce schema/domain parsing before checksum verification and preparation. The lower-level `prepareRoutingContext` remains a typed compatibility surface that checksum-verifies an already domain-validated snapshot; a TypeScript cast alone is not runtime validation. Legacy general routing still accepts caller-supplied opaque checksum identity, while canonical single/split run creation remains a verified execution boundary.
- The first historical import covers one frozen 12-token, 54-pool stored-reserve subset at one Ethereum block. It does not establish complete liquidity, historical order flow, token-transfer feasibility, transaction behavior, future state, live execution, or unrestricted optimality. Its 396-request synthetic corpus is exhaustive only over ordered pairs in that frozen allowlist, uses three fractions of each input asset's maximum incident reserve, can reflect hub/outlier bias, contains no disconnected or deeper topology, and is not equal-value or representative demand. No acquisition client or historical evaluation result is tracked; raw provider material remains private under the accepted conservative redistribution boundary.
- Research references describe possible later directions and do not imply implementation or equivalence.
- Replay-case timings remain one observation per fixed M3 case with no warmup, repetition, comparison, threshold, statistical interpretation, output persistence, migration, or JSON resource-limit policy. The separate M4 anytime harness does not change their meaning.
- Immediate establishment covers canonical exact-replayable one-hop candidates only. With no eligible direct baseline, a zero search cap or already-reached deadline retains typed no-plan behavior.
- Non-interruptible bounded routing and canonical router-run/case v1 preserve their existing zero-expansion semantics and hashes; establishment accounting belongs to the interruptible, resumable, and deadline runtime APIs.
- Anytime latency samples cover one fixed offline input and two one-shot runtime variants. They are observational, retain raw values and environment metadata, and support no scaling, threshold, speedup, or general performance claim.
- Interruption predicates are operational controls only: replay is atomic, in-memory tokens are not serializable/persistable or valid across processes, and paused outcomes do not enter `routelab.router-run.v1` hashes.
- Deadline adapters require an injected monotonic clock and make no hard-latency guarantee. Legacy single-path adapters check between expansions; the composed split runtime checks before all six discretionary work kinds. Clock observations never enter canonical semantic records.
- Pool-disjoint set ordering is structural enumeration, not a financial preference. Candidate sets become financially eligible only after an explicit exact allocation reconstructs the input and exact split replay succeeds; the implemented baseline policies are not a global allocation search.
- Greedy partial replay receipts are scoring evidence only, including a final score that may cover the full amount. Only a distinct post-selection full-input replay can replace the exact fallback. Defensive final-replay failure accounting is retained, although disagreement with an identical successful final score is unreachable under the current captured pure model.
