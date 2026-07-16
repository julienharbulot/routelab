# Contributing to RouteLab

RouteLab accepts focused changes that strengthen exact routing correctness, the public package, measured evidence, or the documented offline boundaries.

## Development setup

Use the pinned Node.js and pnpm versions:

```bash
corepack enable
corepack install --global pnpm@11.12.0
pnpm install --frozen-lockfile
pnpm check
```

Before opening a change, also run the narrow command for the affected boundary, such as `pnpm test:core`, `pnpm test:benchmark`, `pnpm test:api`, or `pnpm test:intents`.

Release-candidate changes also run `pnpm test:package`, both dataset verifiers,
`pnpm benchmark:verify`, the HTTP/load smoke commands, and `pnpm pack --dry-run` from a clean clone.

## Correctness rules

- Keep exact amounts, reserves, fees, allocations, and outputs as `bigint` in memory and canonical decimal strings on wire boundaries.
- Treat approximate numerical work as proposal-only. Every returned success must pass fresh exact replay against the requested snapshot ID and checksum.
- Preserve exact allocation conservation, sequential reserve transitions within a route, deterministic ties, and validated-incumbent fallback behavior.
- Keep wall-clock timing out of stable plan identity.
- Add focused tests proportional to the financial, serialization, API, or service risk.

## Scope

Keep changes small and product-led. New pool curves, live connectivity, signing, custody, settlement, gas-aware objectives, and unrestricted-optimality claims require a separately agreed design; they are not incidental extensions.

Do not commit raw benchmark observations, credentials, provider material without a redistribution grant, or generated files above 250 KiB without prior discussion.

## Pull requests

Describe the user-visible outcome, commands and results, exactness impact, generated-file impact, and retained limitations. Keep one coherent concern per pull request and call out any public API change explicitly.

Tags, hosted releases, and package publication require explicit owner approval after CI is visibly
green on the exact candidate commit.
