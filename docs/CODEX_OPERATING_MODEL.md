# Bounded human-led development model

RouteLab uses a human-led workflow with bounded implementation, independent oracle, and read-only review roles. The purpose is separation of concerns: production work does not manufacture its own expected answers, reviewers do not approve their own edits, and public claims remain the lead's responsibility.

## Stable public layers

- `AGENTS.md` holds project invariants, release discipline, delegation limits, and the public/private publication rule.
- `.codex/config.toml` bounds concurrency and delegation depth.
- `.codex/agents/*.toml` defines reusable builder, oracle, and reviewer roles.
- `tasks/TASK_TEMPLATE.md` defines a frozen, outcome-oriented assignment contract.
- `.agent/PLANS.md` defines when cross-cutting work needs a living design plan.
- `docs/CODE_REVIEW.md` defines severity and review coverage.
- `docs/engineering-log/` contains concise integrated outcomes tied to commits.

These layers are useful on a clean public clone. No private control plane is required to understand, build, test, or review the public repository.

## Bounded execution

The lead selects the smallest eligible task, freezes shared contracts, assigns non-overlapping ownership, integrates changes, and runs the final gate. A builder owns one production slice. An oracle/test engineer owns an independent evidence path. A reviewer works read-only in scout mode before uncertain designs or review mode after a candidate exists.

The configured ceiling is four threads including the lead and one delegation level. At most two writers run concurrently, and only with isolated worktrees, explicit write sets, and integration order. Fewer roles are preferred when independent work would not improve speed or confidence.

High-risk exact math, replay, graph search, allocation, interruption, hashing, and release work receives independent evidence. This does not imply that every task uses four roles. Tests support a decision; the lead still reviews scope, contracts, claims, and limitations.

## Complementary traces

The public trace answers: what contract is accepted, what decision was integrated, what reproducible evidence supports it, and what remains unimplemented. The private trace answers: what is active, who owns which worktree, what failed, what reviewers reported, and what decision is unresolved.

Operational records move through:

```text
draft -> ready -> active -> review -> integrated -> archived
                           \-> blocked
                           \-> abandoned
```

All non-integrated states, raw reports, active ExecPlans, prompts, reviews, unpublished evidence, tool state, and research caches remain private. Negative results are retained privately and become public only as concise, reviewed experiment outcomes.

## Promotion gate

A public engineering-log entry requires integrated work, known commits, accurately recorded checks, resolved or accepted high-severity findings, explicit limitations, and lead review of a strict JSON promotion manifest. The generator consumes only that manifest; it never mines transcripts or arbitrary private files and never commits automatically.

Public entries contain the problem, decision, evidence, result, limitations, and accepted-artifact links. They exclude raw output, prompts, private paths, personal notes, credentials, unpublished benchmarks, worktree ownership, and unsupported CI claims. A local passing command is local evidence; CI is claimed only for a matching commit and run.

## Optional private loading

An ignored `.routelab-private` repository may expose `CONTROL.md`, machine-readable `state.json`, and generated `ACTIVE_STATUS.md` to root sessions. Public `AGENTS.md` is always read first. Private guidance may narrow active scope and recordkeeping but cannot weaken public correctness, safety, or evidence requirements. Generated status is never hand-edited, and the private doctor must pass before task closure. The private repository is prohibited from the tracked public surface.
