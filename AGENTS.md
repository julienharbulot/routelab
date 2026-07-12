# RouteLab TS project contract

## Mission and current boundary

RouteLab is a small, correct, measurable TypeScript liquidity router. The first supported intent is exact-input routing over immutable snapshots of two-asset constant-product pools. RouteLab grows through verified vertical slices. See `STATUS.md` for currently integrated capabilities and the current release gate.

Do not claim transaction submission, custody, production financial execution, unrestricted global optimality, or equivalence with cited research. Splitting, acceleration, services, protocol adapters, and learned ordering follow only after their stated prerequisites.

## Sources of truth

Use authority in this order:

1. `docs/invariants.md` for accepted financial and deterministic semantics;
2. accepted ADRs for reviewed technical decisions;
3. the active task packet for scope, frozen contracts, and acceptance criteria;
4. an active ExecPlan for cross-cutting design and progress;
5. `IMPLEMENTATION_PLAN.md` for milestone order and release gates;
6. `STATUS.md` for stable public project state;
7. code, tests, fixtures, and integrated evidence for implemented behavior.

When authorities conflict, stop the affected work and identify the conflict. Tests are evidence, not permission to contradict accepted semantics. Historical examples and private drafts are not accepted contracts.

## Exact and approximate arithmetic

- Exact asset amounts, reserves, fees, allocations, receipts, and outputs use `bigint`.
- Exact values never pass through JavaScript `number`, JSON numbers, or implicit mixed coercion.
- Integer rounding direction and fee order are explicit and tested.
- Exact allocations are nonnegative and sum to the exact requested input.
- `number` is limited to explicitly approximate optimization, bounds, features, ranking, reporting, or validated structural counters.
- Approximate values may propose work; they never authorize an execution result.

## Snapshots, replay, determinism, and incumbents

- Snapshots are immutable and identified by both ID and checksum.
- Snapshot-specific indexes and caches are never reused across snapshots without a validity proof.
- No candidate becomes an incumbent until fresh exact replay succeeds against the requested snapshot.
- Later hops observe prior transitions; stale pool state is never reused.
- Invalid candidates preserve the incumbent. Objective values are monotonic under deterministic tie-breaking.
- Deterministic modes use canonical iteration, explicit budgets, seeds, configuration, and checkpoints—not wall-clock scheduling.
- Timing fields are excluded from determinism hashes. Primary replay and benchmark fixtures remain offline and versioned.
- Learned or heuristic ordering is advisory and cannot bypass hard constraints or exact replay.

## Release-gate discipline

Build the smallest verified vertical slice and do not skip prerequisites. Exact execution precedes search; a deterministic bounded baseline precedes acceleration; replay precedes benchmark claims; measured bottlenecks precede performance architecture; model-disabled correctness precedes learned ordering. A later milestone cannot disguise a failed current gate.

## Bounded roles

The lead owns contracts, task selection, integration, public claims, and final gates. A builder implements one bounded production change. An oracle/test engineer derives independent expected behavior without circular use of the production helper. A read-only reviewer works in named scout or review mode and returns evidence and risks.

Use at most four concurrent threads including the lead, one delegation level, and at most two writers. Concurrent writers require isolated worktrees, frozen contracts, non-overlapping write sets, and a declared integration order. High-risk financial, replay, search, allocation, interruption, hashing, or release work requires independent evidence. Agents do not merge, push, rewrite history, or approve their own work.

## Canonical commands

Use the pinned Node.js and pnpm versions without modifying the host environment:

```bash
pnpm trace:check:index
pnpm trace:check:head
pnpm lint
pnpm typecheck
pnpm test
pnpm demo
pnpm replay:cases
pnpm check
```

Use narrower tests during development and the full applicable gate before integration. Missing or incompatible tools are reported with the exact failed command; do not install machine-wide replacements.

## Task packets and ExecPlans

Nontrivial work needs one task packet based on `tasks/TASK_TEMPLATE.md`. It states the outcome, why it is next, prerequisites, frozen contracts, role assignments, allowed writes, non-goals, invariants, acceptance criteria, commands, stop conditions, report format, and decisions reserved for the lead or human.

Create and maintain an ExecPlan under the contract in `.agent/PLANS.md` when work crosses core modules, changes a public or financial contract, introduces numerical methods, changes replay/deadline/benchmark semantics, requires migration, or has material staged unknowns. Active packets and plans are operational records; concise integrated outcomes may be promoted to the public engineering log.

## Public and private trace

The public repository contains accepted contracts, decisions, reproducible evidence, curated examples, and integrated outcomes. Raw prompts, active or draft packets, operational status, reports, reviews, working ExecPlans, unpublished evidence, local tool state, and research caches stay private. `config/public-surface.json` and `pnpm trace:check` enforce the tracked boundary.

If `.routelab-private/CONTROL.md` exists, read it after this file and before selecting work. It may narrow active task scope and private recordkeeping, but it may not weaken public project invariants, safety boundaries, verification requirements, or promotion rules. Read `.routelab-private/state.json`, its generated `ACTIVE_STATUS.md`, and the active private task they name. Never edit generated status directly or commit files beneath `.routelab-private/`.

Private work moves through `draft -> ready -> active -> review -> integrated -> archived`, with blocked and abandoned exits. A public engineering-log entry is allowed only after integration, known commits, recorded checks, review resolution, limitation review, and lead approval of a strict promotion manifest. Published manifests leave `pending/`; integrated packets, reports, reviews, and ExecPlans move into the task archive. Before closing or selecting work, regenerate private status and run the private doctor; resolve drift rather than editing around it. Never publish raw transcripts, private paths, credentials, unpublished results, or worktree coordination. Credentials belong in neither repository.

## Verification by risk

| Change | Minimum evidence |
|---|---|
| Documentation or metadata | link/command checks and claim review |
| Public/domain type | typecheck, affected tests, call-site review |
| Exact financial math | golden cases, large integers, independent property or differential path |
| Exact replay | multi-hop goldens, state/mutation checks, deterministic receipts |
| Graph search | tiny exhaustive oracle, cycle/reuse cases, deterministic ties |
| Serialization/hash | round trips and repeated identical hashes |
| Deadline/anytime | forced deterministic interruption; validated incumbents only |
| Allocation | exact-sum reconstruction, fallbacks, tiny exhaustive comparison |
| Performance | identical base/head inputs, raw results, environment, quality tradeoff |
| Data or learning | provenance and offline replay; model-disabled baseline and downstream metrics |

## Stop conditions

Stop and return to the lead when accepted contracts conflict; rounding or financial semantics are unspecified; public types must change outside scope; write ownership overlaps; a trustworthy oracle disagrees with production; required evidence cannot run or be trusted; benchmark inputs change mid-comparison; credentials or unexpected live/private dependencies are required; a claim exceeds evidence; or a material security or financial-safety issue appears.

## Delegated final report

Every delegated report states role and task ID, outcome/findings, files changed or inspected, exact commands and results, assumptions, unresolved risks, semantic/API/dataset/benchmark effects, and recommended lead action. Writers add a concise diff summary. Reviewers lead with severity-ranked findings and name unverified areas. Skipped or failed required checks preclude a completion claim.
