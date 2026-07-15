# RouteLab TS working agreement

## Mission

Finish a small, useful, defensible TypeScript liquidity-routing portfolio project.

The release must make the existing exact routing and numerical-allocation work easy to call, benchmark, inspect, and explain. Product value takes priority over process completeness.

## Current base

The restart begins at:

```text
cdc5a83b47ca35e9173a41e95f7e32e81e4f9d85
RLT-073 Add numerical allocation runtime
```

`STATUS.md` names the one active task. Execute the task files under `tasks/` in numeric order.

## Non-negotiable semantics

- Exact amounts, reserves, fees, allocations, and outputs use `bigint`.
- Wire and persisted exact amounts use canonical decimal strings.
- Approximate numbers may propose allocations but never authorize a returned quote.
- Every returned plan must pass fresh exact replay against the requested immutable snapshot.
- Snapshot identity includes both ID and checksum.
- Later route hops observe earlier reserve transitions.
- Split allocations are nonnegative and sum exactly to the input.
- Invalid candidates preserve the incumbent.
- Incumbent exact output never decreases.
- Deterministic tests use explicit work budgets; timing does not enter semantic hashes.
- Deadline or work exhaustion returns only a fully validated incumbent.
- No transaction submission, signing, custody, settlement, bridge execution, or unrestricted-optimality claim is introduced.

## Product boundaries

v0.1 includes:

- one root library API;
- one readable quote CLI and demo;
- one compact benchmark;
- one local HTTP quote service;
- one load-test command;
- one fixture-only NEAR Intents quote adapter;
- one buildable package.

v0.1 excludes:

- PRIME/core-graph work;
- learned ordering;
- gas-aware optimization;
- concentrated liquidity;
- live data acquisition;
- live Message Bus or 1Click connectivity;
- signing or settlement;
- worker threads unless the service benchmark justifies them;
- a monorepo or plugin framework.

## Human-value rules

- One active task at a time.
- One implementation writer at a time.
- Use a read-only reviewer only at a task or release boundary.
- Do not create new task states, evidence registries, source closures, publication protocols, or agent-control tools.
- Do not preserve a private internal API merely because an old test names it.
- Prefer deleting obsolete code to adapting it indefinitely.
- Prefer one readable golden test to hundreds of near-duplicate generated assertions.
- No production source file above 800 lines without a written reason.
- No test file above 800 lines after `PORT-002`.
- No committed generated file above 1 MB.
- Do not add a dependency unless it removes substantial code or materially improves safety.
- Keep public documentation concise and user-oriented.

## Execution loop

For each task:

1. Read the task, relevant code, and affected tests.
2. Confirm the current repository behavior from code, not old status prose.
3. Implement the smallest coherent vertical slice.
4. Add or retain focused behavioral evidence.
5. Run narrow checks during development.
6. Run the task’s complete acceptance commands.
7. Inspect `git diff --check`, changed-file sizes, and public claims.
8. Commit one coherent result.
9. Update `STATUS.md` in fewer than 15 lines.
10. Move to the next task only when the current acceptance criteria pass.

Do not turn an implementation uncertainty into a new governance milestone. Make a bounded engineering decision, document it briefly, and proceed.

## Verification by risk

| Change | Minimum evidence |
|---|---|
| Exact pool math or replay | goldens, large integers, independent differential/property case |
| Search or candidate sets | tiny exhaustive comparison, cycles/reuse, deterministic ties |
| Allocation | exact-sum reconstruction, fallback, tiny exhaustive comparison |
| Public facade | direct, multi-hop, split, no-route, invalid input, work/deadline fallback |
| Serialization | decimal strings, round trip, deterministic semantic fingerprint |
| Benchmark | fixed inputs, warmups, sufficient samples, raw output excluded from Git |
| HTTP boundary | body limits, invalid JSON, field bounds, typed errors, smoke quote |
| Load evidence | concurrency 1/4/16, p50/p95/p99, throughput, event-loop delay, memory |
| Intent adapter | fixture request/response, asset mapping, exact-input rejection rules |

## Git discipline

- Work on a branch created from the selected restart commit.
- Do not merge later RLT commits wholesale.
- Do not rewrite or force-push the source repository.
- Keep generated raw benchmark output ignored.
- Use one clear commit per task, with an optional second commit only for a separate mechanical deletion/refactor.
- Commit titles use `PORT-00N: imperative summary`.

## Stop conditions

Stop the affected change and report the exact issue when:

- exact financial semantics are ambiguous;
- a trusted differential test disagrees with production;
- the requested public API would require weakening exact replay;
- a benchmark mixes different semantic inputs or configurations;
- a live credential or funded account would be required;
- a proposed feature would become a new project rather than complete v0.1.

A failed performance hypothesis is not a stop condition. Retain the measurement, choose the simpler design, and continue.

## Task report

At the end of each task report only:

- outcome;
- files changed and deleted;
- user-visible behavior;
- exact commands and results;
- line/byte change;
- remaining limitation;
- next task.

Do not include raw chain-of-thought, large logs, hashes of every file, or a transcript of the implementation process.
