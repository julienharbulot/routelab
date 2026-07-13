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
  -> measured acceleration experiments
  -> thin service/protocol boundaries
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

The independently integrated structural candidate-set slice did not itself satisfy or bypass Milestone 4b. Further split-routing claims require the now-integrated immediate-incumbent and measured-progression prerequisites and must still satisfy this milestone's allocation/replay gate.

Gate: exact-sum reconstruction, fallback, large integer, and exhaustive tiny comparisons pass. Approximate failures cannot corrupt the incumbent. No global-optimality claim exceeds the implemented candidate and allocation space.

## Pre-Milestone 6 integration gate — Composed split runtime

Status: complete under cumulative review. The integrated gate provides the verified prepared context, composed anytime split runtime, additive canonical split evidence, fixed fallback/improvement cases, and executable demo required before Milestone 6. The separate Milestone 6 cumulative review has concluded complete for the historical source decision, canonical one-snapshot import, separately versioned synthetic input corpus, frozen comparison config, and retained composed-runtime evaluation; its completion record still requires integration and successful exact-commit CI before Milestone 7a becomes eligible.

Milestone 5 remains complete for its accepted component scope: exact split replay and bounded no-split, equal-split, and greedy baselines. Before those components become the subject of historical evaluation or a service boundary, RouteLab must compose them with the Milestone 4 runtime guarantees rather than benchmarking a chain of independently invoked APIs. This gate is additive and does not rewrite the archived Milestone 5 completion result.

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

Status: cumulative review concluded complete; this completion record still requires integration and successful exact-commit CI before Milestone 7a becomes eligible. The review mapped every outcome and gate clause to the current source contract, canonical snapshot/corpus/config identities, direct composed-runtime path, retained exact results and raw environment observations, independent evidence, exact prerequisite integration commits and CI, and reconciled public limitations.

Choose a source through a documented decision, import one canonical snapshot, then grow versioned datasets with provenance, ordering, schema validation, and checksums. Separate dataset changes from algorithm comparisons. The primary benchmark path must consume the composed runtime from the pre-M6 integration gate; legacy component orchestration may be retained only as an explicitly labeled comparison.

Gate: primary replay remains offline; data provenance and licensing are clear; every imported snapshot is canonically checksum-verified before preparation; benchmark inputs are identical across base/head comparisons; raw results and environment metadata are retained; and the measured path uses one shared request context and non-recharged controls.

## Milestone 7a — Path-level numerical allocation

Add the missing numerical-allocation stage explicitly rather than allowing the greedy baseline to become the final allocator by omission. Over the bounded pool-disjoint candidate set, implement an approximate path-level shadow-price allocator using normalized `number` values only for proposal generation. Reconstruct a deterministic nonnegative `bigint` allocation whose sum is the exact input, compare residual units using exact replay or exact marginal deltas, and require a distinct full-input exact authorization replay before incumbent replacement.

Retain no-split, equal-split, greedy, and tiny exhaustive modes as fallbacks and references. Record convergence, residual, iteration, and failure diagnostics. Keep the numerical mode as a primary routing option only if identical-input evidence justifies it; a negative result is retained honestly and cannot weaken the exact baseline.

Gate: the allocator agrees with the independent tiny exhaustive reference within its documented proposal/reconstruction limits; every failure preserves the incumbent; exact allocations sum to the request at arbitrary precision; approximate values never authorize results; and representative M6 cases compare exact output, work, and convergence against equal and greedy without a global-optimality claim.

## Milestone 7b — Evidence-led acceleration

Profile the composed bounded baseline on representative snapshots. Add sound pruning first. Consider a PRIME-inspired core/shortcut experiment only when measured expansions or latency justify it, and keep it only if identical-input comparisons earn its complexity.

Gate: sound and heuristic pruning are reported separately; quality and work tradeoffs are explicit under the same request-scoped controls; exact replay still validates results; negative experiments and deletion decisions are preserved without overstated equivalence claims.

## Milestone 8 — Thin boundaries

Add an HTTP quote boundary and fixture-based protocol mapping only after the core is stable. Keep routing logic out of adapters. Run concurrency/load experiments before choosing worker-thread or deployment architecture.

Gate: mapping tests are thin and deterministic; external requests cannot weaken snapshot or exactness contracts; operational deadlines do not alter replay semantics.

## Milestone 9 — Optional learned ordering

Proceed only after data-sufficiency review. Use a chronological split and a small advisory ranker to order proposals. Keep model-disabled routing correct and complete for supported deterministic mode. Evaluate stale, reversed, random, and corrupted predictions with downstream routing metrics.

Gate: hard constraints and exact replay cannot be bypassed; model-disabled baselines remain visible; empirical results are not described as formal robustness or generalization guarantees.

## Release and research integrity

Every release gate records exact commands, integrated commits, limitations, and the distinction between local and CI evidence. Performance comparisons use identical versioned inputs and preserve raw results. Citations are references, not implementation claims: RouteLab uses “inspired by” unless equivalence is demonstrated. A smaller verified release is preferred to a broad partially validated one.

Key risks are silent numeric coercion, stale mutable state, nondeterministic ordering, circular test oracles, benchmark drift, premature optimization, and overclaiming research correspondence. Mitigations are accepted semantics, exact replay, immutable snapshots, canonical ordering, independent bounded oracles, versioned inputs, and explicit keep/delete experiment gates.
