# PORT-001 — Clean restart and remove obvious deadweight

## Outcome

The repository at `cdc5a83` becomes a clean product-development base with no routing semantic changes.

## Required work

1. Integrate the replacement planning files.
2. Remove the following process paths:

   ```text
   .agent/
   .codex/agents/
   scripts/trace/
   config/public-surface.json
   tests/trace-policy.test.ts
   docs/CODEX_OPERATING_MODEL.md
   docs/CODE_REVIEW.md
   docs/engineering-log/
   tasks/TASK_TEMPLATE.md
   tasks/examples/
   ```

3. Remove the following generated-evaluation paths:

   ```text
   datasets/evaluations/
   src/benchmark/historical-composed-split/
   cli/run-historical-composed-split-evaluation.ts
   cli/verify-historical-composed-split-evaluation.ts
   tests/historical-composed-split-evaluation-cli.test.ts
   tests/historical-composed-split-evaluation.test.ts
   tests/oracle/historical-composed-split-evaluation-oracle.test.ts
   fixtures/m6/composed-historical/
   ```

4. Remove matching package scripts and private-control/trace references.
5. Keep the historical snapshot and request corpus verification.
6. Replace long root status/roadmap prose.
7. Add `reports/raw/` and `reports/tmp/` ignores.
8. Record before/after tracked bytes and line counts.

## Do not change

- exact pool math;
- replay semantics;
- path discovery;
- candidate-set discovery;
- prepared context;
- anytime split runtime;
- numerical runtime;
- path-shadow-price algorithm.

## Acceptance

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm verify:historical-data
pnpm verify:synthetic-requests
pnpm demo
git diff --check
```

Also verify:

```bash
git grep -n "historical-composed-split-evaluation" -- . ':!pnpm-lock.yaml'
git grep -n "trace:check" -- package.json .github
git ls-files 'datasets/evaluations/**'
```

All three searches must return no active path/reference.

## Size gate

The tracked working tree should shrink by at least 7 MB. If it does not, identify which generated evaluation files remain.

## Commit

```text
PORT-001: Remove experiment and workflow deadweight
```
