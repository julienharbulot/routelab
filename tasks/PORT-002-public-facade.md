# PORT-002 — Add one public facade and consolidate the core

## Outcome

A caller can prepare a snapshot and request a quote through one documented TypeScript API.

## Required API

```ts
prepareSnapshot(input: unknown)
quote(context, request, options?)
serializeQuote(quote)
formatQuote(quote)
```

Strategies:

```text
best-single
greedy-split
numerical-split
```

Effort profiles:

```text
fast
balanced
thorough
```

Default:

```text
strategy = greedy-split
effort = balanced
```

## Implementation rules

- Wrap existing trusted modules before refactoring them.
- The public request does not expose raw internal work caps.
- The numerical strategy preserves the exact incumbent on failure or stop.
- `serializeQuote` uses decimal strings.
- Timing is excluded from the semantic fingerprint.
- The public root exports only facade types/functions.
- Move the exact receipt comparison helper out of the legacy split folder.
- After facade tests pass, delete Tier B legacy surfaces that have no remaining production consumer.
- Split the 1,733-line numerical module by responsibility without changing behavior if it remains over 800 lines.

Suggested numerical split:

```text
types.ts
validation.ts
work-control.ts
proposal.ts
runtime.ts
index.ts
```

Do not split merely to create forwarding files; each module needs a coherent responsibility.

## Required tests

- direct route;
- two-hop improvement;
- split improvement;
- numerical exact authorization;
- numerical failure retains baseline;
- disconnected pair;
- invalid amount and identifier;
- snapshot mismatch;
- no incumbent before deadline;
- valid incumbent at work/deadline stop;
- deterministic semantic fingerprint;
- decimal-string round trip;
- one tiny exhaustive allocation comparison.

## Acceptance

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm test:core
git diff --check
```

Verify:

- no production or test file above 800 lines;
- no old public router import is used outside a focused internal compatibility test;
- repeated facade calls on fixed inputs have equal semantic output;
- every success can be replayed independently.

## Commits

Preferred:

```text
PORT-002: Add the public quote facade
PORT-002: Remove superseded router surfaces
```

Use the second commit only for mechanical deletion/refactoring.
