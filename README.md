# RouteLab TS

RouteLab is an exact-input TypeScript liquidity router for immutable snapshots of two-asset constant-product pools. It discovers bounded multi-hop and pool-disjoint split routes, optionally proposes allocations with a path-shadow-price numerical method, and authorizes every returned quote through fresh exact `bigint` replay.

## Quickstart

The repository pins Node.js 24.18.0 and pnpm 11.12.0.

```bash
corepack enable
corepack install --global pnpm@11.12.0
pnpm install --frozen-lockfile
pnpm demo
```

The demo prints a hand-readable split improvement (`100 -> 66` versus best-single `50`) and one quote from the retained historical snapshot.

## Library API

The package root exports only:

```ts
prepareSnapshot
quote
serializeQuote
formatQuote
```

```ts
import { readFile } from 'node:fs/promises';
import { formatQuote, prepareSnapshot, quote } from 'routelab-ts';

const raw = JSON.parse(await readFile('snapshot.json', 'utf8')) as unknown;
const prepared = prepareSnapshot(raw);
if (!prepared.ok) throw new Error(prepared.error.code);

const result = quote(prepared.value, {
  snapshotId: prepared.value.snapshotId,
  assetIn: 'A',
  assetOut: 'B',
  amountIn: 100n,
});
if (!result.ok) throw new Error(result.error.code);

console.log(formatQuote(result.value));
```

Strategies are `best-single`, `greedy-split`, and `numerical-split`. Effort profiles are `fast`, `balanced`, and `thorough`. The default is balanced greedy split; raw iteration and replay caps are deliberately internal.

`serializeQuote()` converts every exact value to a canonical decimal string. The semantic fingerprint includes the deterministic plan, strategy, profile, termination, and work counters, but excludes elapsed time.

## Quote CLI

This documented offline command quotes one WETH input into USDC on the retained snapshot:

```bash
pnpm quote -- \
  --snapshot datasets/ethereum-mainnet/uniswap-v2/block-19000000/core12-v1/snapshot.json \
  --asset-in 0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2 \
  --asset-out 0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48 \
  --amount-in 1000000000000000000 \
  --strategy greedy-split \
  --effort balanced
```

Add `--json` for decimal-string JSON. Run `pnpm quote -- --help` for all options. The readable output shows allocations, route hops, exact output, best-single improvement, fallback/termination, elapsed time, exact validation, and the semantic fingerprint.

## Exact authorization

Approximate numbers are proposal-only. A published plan is rebuilt and replayed against the prepared snapshot with exact `bigint` arithmetic. Snapshot ID and checksum must match; allocations sum exactly to the input; later hops observe earlier reserve transitions; an invalid proposal cannot replace the incumbent.

A deadline or work limit can stop discovery, but it can expose only a fully replayed incumbent. With no incumbent, the facade returns a typed error rather than a fabricated quote.

## Build and verification

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm verify:historical-data
pnpm verify:synthetic-requests
pnpm pack --dry-run
```

The package archive allowlist contains only `dist/`, this README, the MIT license, and package metadata.

## Scope and limitations

- Pools use the documented two-asset constant-product model; concentrated liquidity and gas-aware optimization are out of scope.
- Route discovery, split cardinality, allocation work, and numerical work are bounded. RouteLab does not claim unrestricted global optimality.
- The retained dataset is one 54-pool allowlist snapshot at Ethereum block 19,000,000. Its synthetic request corpus is not historical or representative demand.
- The project currently runs offline and does not submit transactions, sign messages, hold funds, connect to a relay, or settle trades.
- Timing is observational and excluded from semantic fingerprints; no production-latency claim is made.

See [architecture](docs/architecture.md), [benchmark design](docs/benchmark.md), [accepted invariants](docs/invariants.md), and [current status](STATUS.md).

## License

MIT.
