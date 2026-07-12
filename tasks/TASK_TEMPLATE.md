# TASK-ID — Outcome-oriented title

## Task state

- **Release / milestone:**
- **Current release gate:**
- **Status:** proposed | ready | active | review | integrated | blocked
- **Lead:** initial parent thread
- **Active ExecPlan:** none | path
- **Related tasks / ADRs:**

## Outcome

Describe the concrete, observable behavior or evidence that will exist when this task is integrated.

## Why this is next

State the use case, dependency, failed gate, measured bottleneck, or release need that makes this task necessary now. Do not justify it only with possible future extensibility.

## Prerequisite evidence

List the facts that make the task ready:

- merged prerequisite task or commit;
- passing release gate;
- accepted invariant or ADR;
- measured profile or benchmark;
- available fixture or dataset.

## Current behavior

Name the current files, symbols, tests, commands, and known limitations relevant to the task.

## Frozen contracts

List the shared decisions that writing agents must treat as fixed for this task:

- public types and function signatures;
- financial and rounding semantics;
- snapshot/replay behavior;
- error and fallback behavior;
- deterministic ordering and tie-breaks;
- benchmark or dataset meaning.

## Agent assignments

Mark unused roles as `not used`.

### Lead

- Decisions retained by the lead:
- Shared files owned by the lead:
- Integration order:
- Final repository gate:

### Builder

- **Use:** yes | no
- **Deliverable:**
- **Allowed write paths:**
- **Forbidden write paths / concepts:**
- **Branch or worktree:**
- **Verification commands:**

### Oracle/test engineer

- **Use:** yes | no
- **Independent evidence to create:**
- **Source of expected behavior:**
- **Allowed write paths:**
- **Production helpers that must not be reused:**
- **Branch or worktree:**
- **Verification commands:**

### Reviewer/scout

- **Use:** yes | no
- **Mode:** scout | review
- **Read/review scope:**
- **Risk questions to answer:**
- **Commands safe to run:**

## Explicit non-goals

List adjacent work that must not enter this task, including later milestones, cleanup, package extraction, dependency changes, API expansion, dataset changes, or performance work not required by the outcome.

## Hard invariants

List the relevant financial, deterministic, safety, compatibility, data, and research-integrity rules. Link to accepted source documents rather than restating ambiguous summaries.

## Acceptance criteria

- [ ] Observable behavior or evidence criterion
- [ ] Correctness and error/fallback criterion
- [ ] Determinism criterion, when applicable
- [ ] Independent test or oracle criterion, when applicable
- [ ] Documentation/decision-log criterion, when applicable
- [ ] No unrelated files or semantics changed

## Verification

### Narrow commands

```bash
# Commands writers run during development
```

### Lead integration gate

```bash
# Commands the lead runs after integration
```

### Evidence to retain

List raw benchmark output, seed, fixture, determinism hash, profiler result, or report path that must be committed or referenced.

## Stop conditions

List task-specific conditions that require returning to the lead rather than guessing, such as a contract conflict, unexpected dependency, ambiguous formula, oracle disagreement, or write-set overlap.

## Required agent reports

Every used role reports:

- role and task ID;
- outcome or findings;
- files changed or inspected;
- commands and exact results;
- assumptions;
- unresolved risks;
- semantic or benchmark changes;
- recommended lead action.

## Integration record

Complete only after work returns.

- Builder result:
- Oracle result:
- Reviewer result:
- Lead resolution:
- Final commands and results:
- Integrated commit:
- Release-gate effect:
- Follow-up task, if any:
