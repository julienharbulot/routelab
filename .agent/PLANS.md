# RouteLab ExecPlan contract

An ExecPlan is a living technical plan for work that crosses core modules, changes a public or financial contract, introduces numerical methods, changes replay/deadline/benchmark semantics, requires migration, or contains material unknowns. It is not a task backlog or transcript.

Active working plans remain in the private control plane. A public ExecPlan is appropriate only when the plan itself is a durable accepted design artifact; completed work is normally summarized in `docs/engineering-log/`.

## Required sections

1. Goal and observable outcome.
2. Why the work is next and prerequisite evidence.
3. Current implemented state.
4. Accepted invariants and explicit non-goals.
5. Unknowns and bounded validation spikes.
6. Proposed design and data flow.
7. Contracts to freeze before parallel work.
8. Work partition, write sets, and integration order.
9. Milestones with independently verifiable outcomes.
10. Validation strategy and exact commands.
11. Risks, rollback, and stop conditions.
12. Progress, discoveries, and decision log.
13. Outcome, retained evidence, and remaining limitations.

## Execution rules

- Keep the plan current enough for a new lead session to resume from repository evidence.
- Record decisions and unexpected results factually; do not paste raw conversations or agent reports.
- Resolve contract changes in the plan before downstream implementation.
- Treat passing tests as evidence, not proof that the design is correct.
- Preserve failed experiments privately and promote only concise reviewed outcomes.
- Close the plan only after integration and the applicable release gate; archive the raw plan privately.
