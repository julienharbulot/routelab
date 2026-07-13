# RouteLab technical roadmap

## Product promise and non-goals

RouteLab will grow from an exact offline execution kernel into a deterministic, measurable exact-input liquidity router. The first pool model is a two-asset constant-product pool. Exact financial results use `bigint`, plans bind to immutable snapshot identity, and every accepted candidate passes sequential exact replay.

The project does not submit transactions, hold funds, promise production execution, or claim unrestricted global optimality. A bounded baseline comes before search acceleration. Before credible evaluation, the direct, single-path, and split stages must run through one request-scoped verified snapshot context, one shared discovery result, and non-recharged request controls. Historical data, numerical allocation, acceleration, services, protocol adapters, and learned ordering remain separate later milestones with explicit gates.

## Architectural growth path

```text
validated snapshot
  -> exact pool quote and immutable transition
  -> exact multi-hop replay with receipts
  -> deterministic bounded single-path baseline
  -> versioned replay-case verification
  -> interruption, checkpoint, resume, and deadline mechanics
  -> immediate validated incumbent and measured quality progression
  -> exact split allocation with fallback
  -> composed request-scoped split runtime and canonical split evidence
  -> historical data and credible evaluation
  -> path-level numerical allocation experiment
  -> pre-acceleration profiling and experiment selection
  -> service-runtime and performance consolidation
  -> thin service/protocol boundaries
  -> representative benchmark and reusable package
  -> optional advisory learned ordering
```

Each layer depends only on accepted lower layers. Approximation may order or bound proposals, but exact replay remains the authorization boundary.

## Milestone 0 — Semantic contract and offline evidence

Freeze amount encoding, fee meaning, final-floor rounding, reserve transitions, snapshot identity, route validity, deterministic ties, and the exact/approximate boundary. Maintain tiny hand-auditable fixtures independent of future production helpers.

Gate: accepted invariants are internally coherent; fixtures reproduce exact expected values; repository lint, typecheck, tests, demo, and trace checks pass. No financial implementation is claimed.

## Milestone 1 — Exact execution kernel

Introduce minimal domain and snapshot validation, then exact constant-product quote/transition, exact route replay, and independent property/differential evidence. Keep public types narrow and errors typed. Preserve input immutability and validate transitions atomically.

Gate: golden and very-large-integer cases pass; both pool directions and fee boundaries are covered; replay observes prior pool transitions; receipts are deterministic; an independent oracle agrees on bounded cases.

## Milestone 2 — Deliberately bounded router

Build deterministic adjacency and simple-path enumeration, then select the best single exact-replayed path under explicit hop and work limits. Compare tiny graphs against a slow exhaustive oracle, including disconnected requests, cycles, pool reuse, and tie-breaking.

Gate: every returned plan replays exactly against the requested snapshot; exhaustive bounded comparisons agree; invalid candidates never replace a valid incumbent. Claims are bounded to the configured search space.

## Milestone 3 — Replay-case verification backbone

Define a canonical replay schema and checksum, determinism hash, replay-case verification CLI, and versioned offline cases. Separate semantic fields from observational timing. Preserve raw inputs and outputs behind summaries.

Gate: round trips are canonical; identical inputs produce identical semantic hashes and counters; replay verification requires no credentials or live service; environment metadata and limitations accompany observations without creating a benchmark claim.

## Milestone 4a — Interruption, checkpoint, resume, and deadline mechanics

Add deterministic pre-expansion interruption, reusable and branchable process-local checkpoints with cumulative work caps, and optional cooperative deadlines over an injected monotonic clock. Return only fresh exact-replayed incumbents, and treat wall-clock deadlines as service behavior rather than reproducible termination.

Gate: forced interruption and deadline tests cover every eligible boundary; paused outcomes contain only fully exact-replayed incumbents or typed no-plan results; cumulative deterministic work caps reproduce termination and resume from isolated reusable checkpoints; timing does not enter deterministic state or hashes.

## Milestone 4b — Immediate incumbent and quality progression

Define and implement a deterministic incumbent-establishment phase before the first user-controlled interruption or deadline stop. The task must freeze baseline eligibility and ordering, exact-replay authorization, and explicit accounting for establishment work before production changes. At minimum, an eligible exact-replayable one-hop route must not be lost merely because the search budget is zero or the first deadline sample is already expired.

Gate: zero-work and already-expired forced cases return the established exact-replayed baseline when one is eligible; cases without an eligible baseline retain typed no-plan behavior; incumbent quality is monotonic under increasing deterministic work; establishment work is visible in deterministic accounting; quality-versus-work evidence and statistically meaningful latency observations are reported separately with versioned inputs, warmup, sample counts, comparisons, environment metadata, and persisted raw results.

## Milestone 5 — Split allocation

Start with deterministic pool-disjoint candidates and no-split/equal-split/greedy baselines. Add a tiny exhaustive allocation oracle before approximate models or numerical allocation. Reconstruct exact integer allocations whose nonnegative sum is the requested input, then exact-replay every plan. Preserve a safe baseline fallback.

Gate: exact-sum reconstruction, fallback, large integer, and exhaustive tiny comparisons pass. Approximate failures cannot corrupt the incumbent. No global-optimality claim exceeds the implemented candidate and allocation space.

## Pre-Milestone 6 integration gate — Composed split runtime

Status: complete under cumulative review. The verified prepared context, composed anytime runtime, canonical split evidence, and exact demo remain the evidence-compatible reference-v1 path. A later service boundary cannot reinterpret its pre-deadline establishment as a hard whole-request deadline.

The composed path must:

- accept a canonically checksum-verified prepared snapshot context;
- capture the snapshot and build deterministic adjacency once per prepared context;
- discover paths once per request branch and reuse them for the single-path incumbent and pool-disjoint set generation;
- avoid enumerating singleton candidate sets for split-only allocation work;
- maintain one request-scoped control object and one non-recharged ledger for establishment, path discovery, best-single exact candidate replays, candidate-set work, equal proposals, greedy option replays, and final authorization;
- establish an eligible direct exact-replayed incumbent before the first user-controlled stop;
- preserve the full deterministic split objective while equal and greedy stages can only improve the incumbent;
- check cooperative interruption and the absolute deadline throughout discovery and allocation, returning only a fully exact-replayed incumbent or a typed no-plan result; and
- produce canonical split run/case evidence plus an executable offline demo where splitting improves output and a restricted budget preserves the fallback.

Legacy Milestone 2–5 APIs and canonical single-path v1 records may remain as compatibility and component-test surfaces. They are not the main path for Milestone 6 measurements. Serializable or cross-process split checkpoints remain deferred unless the composed-runtime design proves they are necessary for this gate.

Gate: independent tiny-graph and forced-stop evidence proves shared discovery, no budget recharge, exact fallback preservation, monotonic incumbent quality, checksum rejection, deterministic counters, and exact replay at every authorization boundary. At least one canonical split case reproduces the hand-audited `50 -> 66` improvement and one forced-stop case returns the exact `50` fallback. The demo executes one of those cases. No latency or throughput claim is created by this gate.

## Milestone 6 — Historical data and credible evaluation

Status: complete under cumulative review for the accepted source contract, one canonical snapshot, separate result-blind corpus, frozen comparison config, composed-runtime evaluation, independent evidence, exact commits/CI, and public limitations.

Choose a source through a documented decision, import one canonical snapshot, then grow versioned datasets with provenance, ordering, schema validation, and checksums. Separate dataset changes from algorithm comparisons. The primary benchmark path must consume the composed runtime from the pre-M6 integration gate; legacy component orchestration may be retained only as an explicitly labeled comparison.

Gate: primary replay remains offline; data provenance and licensing are clear; every imported snapshot is canonically checksum-verified before preparation; benchmark inputs are identical across base/head comparisons; raw results and environment metadata are retained; and the measured path uses one shared request context and non-recharged controls.

## Milestone 7a — Path-level numerical allocation

Status: complete under cumulative review. [ADR 0004](docs/adr/accepted/0004-path-level-numerical-allocation.md), independent evidence, exact commits/CI, compatibility, and public limitations cover its accepted gate. The evaluation retains all 2,376 cells, freshly executes 414 result-blind eligible cells, and records 318 improved, 96 equal, and zero regressed objectives. Its immutable `primary` field creates no default or performance claim; publicly this is a quality-qualified experimental allocator on complete eligible cells until time-to-quality evidence exists.

Add the missing numerical-allocation stage explicitly rather than allowing the greedy baseline to become the final allocator by omission. Over the bounded pool-disjoint candidate set, implement an approximate path-level shadow-price allocator using normalized `number` values only for proposal generation. Reconstruct a deterministic nonnegative `bigint` allocation whose sum is the exact input, compare residual units using exact replay or exact marginal deltas, and require a distinct full-input exact authorization replay before incumbent replacement.

Retain no-split, equal-split, greedy, and tiny exhaustive modes as fallbacks and references. Record convergence, residual, iteration, and failure diagnostics. Keep the numerical mode as a primary routing option only if identical-input evidence justifies it; a negative result is retained honestly and cannot weaken the exact baseline.

Gate: the allocator agrees with the independent tiny exhaustive reference within its documented proposal/reconstruction limits; every failure preserves the incumbent; exact allocations sum to the request at arbitrary precision; approximate values never authorize results; and representative M6 cases compare exact output, work, and convergence against equal and greedy without a global-optimality claim.

## Milestone 7b — Pre-acceleration profiling and experiment selection

Status: complete under cumulative review as a negative experiment-selection
result, not an acceleration capability. The first frozen profile preserves its
empty formal population. The supported-regime follow-up retains exact parity for
1,269 eligible cells and 12 nonempty profiles; candidate-set discovery leads none,
so its precommitted rule selects no pruning, shortcut, or acceleration. “Sound
pruning first” governs future graph experiments; it does not require unsupported
code after this result.

Profile the composed bounded baseline on frozen supported-regime inputs. If later sparse, deeper, multi-venue evidence selects graph work, add sound pruning before heuristic pruning and consider a core/shortcut experiment only when measured expansions or latency justify it. Keep any implementation only if identical-input comparisons earn its complexity; the current dense diameter-two evidence does not answer whether graph acceleration is useful on those later regimes.

Gate: sound and heuristic pruning are reported separately; quality and work tradeoffs are explicit under the same request-scoped controls; exact replay still validates results; negative experiments and deletion decisions are preserved without overstated equivalence claims.

## Milestone 7c — Service-runtime and performance consolidation

Status: required direction-correction gate before Milestone 8. Archived 7a/7b completion remains factual for its accepted contracts; this additive gate records later-discovered service prerequisites without rewriting retained evidence.

Freeze the current deterministic runtime and artifacts as `reference-v1`. Add `service-v2` over one shared routing-session engine. Reference policy preserves existing behavior and evidence. Service policy samples the clock at entry, charges all router work to one service-runtime deadline, and server-bounds input decimal length, snapshot/pool/reserve size, hops, routes, direct candidates, structural work, and numerical work between checks. This is not an outer HTTP deadline or SLA. Already-expired, deadline-before-plan, complete no-route, and dependency-error outcomes are typed distinctly.

The shared session owns its captured context/request, frontiers, exact incumbent, non-recharged ledger, controls, diagnostics, and exact authorization. Service scheduling must reach a numerical proposal after the first useful set without first completing every equal and greedy reference proposal. Later work may explore more sets or refine greedily while preserving the exact incumbent.

Freeze an identical-input experiment before observations. Compare the 64-by-64 reference with lower fixed iterations, pinned-runtime square root, and a deterministic fixed-iteration alternative where feasible. Compare strict non-convergence rejection with safe finite-proposal replay, and current reconstruction with activation-aware or bounded-neighborhood exact repair. Retain exact output/regret, failures, time to improvement, elapsed observations, deadline success, counters, environment, and negative results. A frozen rule alone selects a service-fast proposer; exact replay alone authorizes it.

Durably exclude acquisition work from the public repository, keep it in a valid private repository with its own credential/cache/raw-work rules, and export only reviewed tracked Git content. Freeze the later HTTP trust boundary now: bounded identifiers and decimal-string amounts; optional supported snapshot ID and deadline request; server-selected checksum/policy; no client-selected iterations/caps; typed unknown constraints; bounded opt-in debug; timing excluded from deterministic hashes.

Gate:

- service-v2 samples the clock at entry and includes bounded direct establishment in its deadline, with many-direct-pool, already-expired, and no-direct-route fixtures;
- tight-budget forced cases prove numerical work is not structurally starved behind the complete greedy reference pipeline;
- reference-v1 and service-v2 policies execute through one orchestration core, while all retained v1 exact results, counters, diagnostics, bytes, and hashes remain compatible;
- every service action has frozen operational resource bounds and a cooperative stop boundary, and only fully exact-authorized incumbents escape;
- a retained identical-input numerical-fast experiment reports exact output and timing separately and records a mechanical keep/reject decision;
- activation and finite non-convergence handling are deliberately improved or explicitly accepted with measured failure evidence;
- tracked ignore, the separate private acquisition repository, and export checks cannot include acquisition, credentials, raw work, or private-control trees accidentally; and
- an independent cumulative completion review maps every clause above to integrated code and evidence and states `MILESTONE COMPLETE` before Milestone 8 becomes eligible.

## Milestone 8 — Thin boundaries

After 7c, add thin HTTP quote/snapshot metadata and fixture-only NEAR Intents mapping, with no relay or settlement claim. Parse through the frozen trust boundary; keep routing out of adapters and timing outside replay. Before selecting workers or deployment, retain concurrency 1/4/16 evidence for queue/service/end-to-end time, p50/p95/p99, deadline success, throughput, memory, event-loop delay, cancellation, and warm/cold behavior. A worker design, if earned, builds prepared contexts inside workers, bounds admission/queues, and returns cloneable results; same-thread `Promise.race` is not cancellation evidence.

Gate: mapping tests are thin and deterministic; external requests cannot weaken snapshot, exactness, resource, or server-policy contracts; operational deadlines do not alter replay semantics; overload and cancellation are typed; and the worker/deployment decision is supported by retained identical-input load evidence rather than assumption.

## Milestone 9 — Representative benchmark and reusable package

Before portfolio or production-readiness claims, add at least 10 chronological multi-venue snapshots, 20–100 assets, 100–500 pools, sparse/disconnected/repeated-pair/three-/four-hop cases, defensible request regimes, stress fixtures, and manifest verification while retaining the v1 golden. On identical inputs at 1/5/10/25/50/100 ms plus a long reference, compare direct, single, equal, greedy, numerical reference/fast, long-budget, and tiny-exhaustive modes. Report per-request exact-output regret, time to first/best, approximate-versus-exact differences, and scalable raw evidence.

Add a chosen license/data notices, semantic version, explicit package exports, supported build output, benchmark/report commands, quality/time and latency/deadline/throughput results, an exact trace, and reviewed-commit `git archive` output.

Gate: the benchmark protocol is frozen before observations; inputs are identical across modes; provenance and limitations are explicit; raw evidence reproduces the report; package exports expose only reviewed stable surfaces; public archives contain no private/acquisition/local state; and no representativeness, performance, or open-source claim exceeds the integrated evidence and license.

## Milestone 10 — Optional learned ordering

Proceed only after data-sufficiency review. Use a chronological split and a small advisory ranker to order proposals. Keep model-disabled routing correct and complete for supported deterministic mode. Evaluate stale, reversed, random, and corrupted predictions with downstream routing metrics.

Gate: hard constraints and exact replay cannot be bypassed; model-disabled baselines remain visible; empirical results are not described as formal robustness or generalization guarantees.

## Release and research integrity

Every release gate records exact commands, integrated commits, limitations, and the distinction between local and CI evidence. Performance comparisons use identical versioned inputs and preserve raw results. Citations are references, not implementation claims: RouteLab uses “inspired by” unless equivalence is demonstrated. A smaller verified release is preferred to a broad partially validated one.

Key risks are silent numeric coercion, stale mutable state, nondeterministic ordering, circular test oracles, benchmark drift, premature optimization, and overclaiming research correspondence. Mitigations are accepted semantics, exact replay, immutable snapshots, canonical ordering, independent bounded oracles, versioned inputs, and explicit keep/delete experiment gates.
