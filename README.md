# RouteLab TS

RouteLab is an exact-input TypeScript liquidity router that searches immutable constant-product snapshots and authorizes every returned plan through fresh exact `bigint` replay.

```text
immutable snapshot -> prepare -> bounded search/allocation -> exact replay
                                                           -> library / CLI / HTTP
                                                           -> unsigned NEAR fixture draft
```

## Measured result

- The headline corpus has 396 synthetic exact-input requests derived from one historical pool-reserve snapshot; it is not historical order flow or representative demand.
- All 3,168 returned mode/request plans passed fresh exact replay.
- At fast effort, numerical split beat/tied/lost greedy split on 19/377/0 requests.
- Thorough numerical split had p95 regret of 640 ppm (6.40 bps) against the best observed declared fixed mode.
- On the recorded local run, fast greedy split had 1,706 µs p50 and 4,564 µs p99 in-process latency over 1,000 rotating requests.
- In one clean-source comparison, all 6,000 normal responses matched exact output and fingerprint. At concurrency 16, four workers changed p95 latency from 51.12 to 23.04 ms and throughput from 434.2 to 1,044.3 requests/s, while peak server RSS rose from 249.7 to 402.8 MiB; this passed the frozen retention gate.
- At concurrency 16, 25/50/100 ms deadline lanes produced 181/200/200 exactly validated quotes (including deadline incumbents), with 19/0/0 deadline-before-plan responses and no internal/schema failures. A 52-request burst filled 4 active plus 32 queued slots and returned 16 typed overloads with `Retry-After`.

See the [full benchmark report](reports/portfolio-v2.md).

Limitation: the retained dataset, synthetic request corpus, and local timings are portfolio evidence, not representative demand, unrestricted optimality, or production capacity.

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

Strategies are `best-single`, `greedy-split`, and `numerical-split`. Effort profiles are `fast`, `balanced`, and `thorough`. The default is balanced greedy split; raw iteration and replay caps are deliberately internal. `deadlineMs` is a relative monotonic wall-clock stop budget, not a CPU-time budget.

`serializeQuote()` converts every exact value to a canonical decimal string. `planFingerprint` identifies only the snapshot-bound request and exact executable plan, so strategy, effort, termination, timing, and work counters cannot change it. Raw work counters and numerical outcome details are available only with `includeDiagnostics: true`.

## Quote CLI

This documented offline command quotes one WETH input into USDC on the retained snapshot:

```bash
pnpm quote -- \
  --snapshot datasets/ethereum-mainnet/uniswap-v2/block-19000000/core12-v1/snapshot.json \
  --asset-in WETH \
  --asset-out USDC \
  --amount-in 1000000000000000000 \
  --strategy greedy-split \
  --effort balanced \
  --max-hops 3 \
  --max-routes 3
```

The CLI loads symbols and decimals from a dataset manifest beside the snapshot. Run `pnpm quote -- --snapshot <path> --list-assets` to discover aliases, add `--raw` for full identifiers/base units, or add `--json` for canonical decimal-string JSON. Readable output shows exact token units, allocation and improvement percentages, abbreviated routes, termination, elapsed time, exact validation, and the plan fingerprint.

## Local quote service

```bash
pnpm serve
```

The loopback service prepares the retained snapshot once in each of four fixed workers and exposes `GET /health`,
`GET /v1/snapshots`, and `POST /v1/quote`. Its boundary limits the body to 32 KiB, requires
canonical decimal amount strings, bounds all identifiers and route controls, and never accepts
internal work caps. Admission is bounded to four active and 32 queued quotes with typed overloads;
use `pnpm serve -- --mode same-thread` for the measured one-active baseline. The fixed workers are
retained because the same-run semantic, tail-latency, throughput, c1-overhead, admission, and memory
gate passed; the memory increase and worse c16 event-loop maximum remain visible costs. Run
`pnpm serve:smoke`, `pnpm test:api`, or `pnpm load:smoke` for local checks.

## Benchmark evidence

`pnpm benchmark` regenerates deterministic quality and 1,000-sample in-process latency evidence;
`pnpm benchmark:verify` freshly replays every reported success. The quality chart uses categorical
effort, and the machine summary keeps unlike work counters separate. `pnpm load --
--mode compare --concurrency 1,4,16` measures same-thread and worker modes sequentially without
reading an older baseline; `pnpm load:deadlines` and `pnpm load:overload` rerun the special lanes.
`pnpm service:verify` checks the committed service rendering and source identity. Raw observations are ignored.

See the concise [portfolio report](reports/portfolio-v2.md), [service report](reports/service-v2.md),
and [benchmark methodology](docs/benchmark.md). The curated inputs and one local machine are not
representative demand or a production-capacity claim.

## NEAR Intents fixture boundary

The `routelab-ts/near-intents-fixture` package subpath separates two official concepts:
`parseNearQuoteParamsExactInput()` parses the exact-input subset of public JSON-RPC quote params,
while `draftNearSolverQuoteExactInput()` accepts the solver event fields including `quote_id` and
returns a RouteLab-specific internal unsigned draft. The snapshot-bound fictional asset map checks
both snapshot identity fields and every mapped internal asset. The
[adapter boundary](src/adapters/near-intents/README.md) records the 2026-07-16 documentation check
and exact exclusions. An omitted public `min_deadline_ms` normalizes to the documented 60,000 ms;
the solver event remains strict. The draft is not an official
`quote_response`: it has no `signed_data`, relay connection, authentication, balance lookup,
signing, key handling, execution, or settlement.

## Exact authorization

Approximate numbers are proposal-only. A published plan is rebuilt and replayed against the prepared snapshot with exact `bigint` arithmetic. Snapshot ID and checksum must match; allocations sum exactly to the input; later hops observe earlier reserve transitions; an invalid proposal cannot replace the incumbent.

A deadline or work limit can stop discovery, but it can expose only a fully replayed incumbent. With no incumbent, the facade returns a typed error rather than a fabricated quote.

## Build and verification

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:package
pnpm verify:inputs
pnpm benchmark:verify
pnpm service:verify
pnpm test:api
pnpm load:smoke
pnpm pack --dry-run
pnpm release:verify
```

The package consumer check packs a tarball, installs it into a clean temporary ESM project, imports the root and NEAR subpath, and executes one exact quote. Only the runtime dependency closure for those two exports is compiled into `dist/`; benchmark, evidence, service, and input-verification tooling stays in the repository.

## Scope and limitations

- Pools use the documented two-asset constant-product model; concentrated liquidity and gas-aware optimization are out of scope.
- Route discovery, split cardinality, allocation work, and numerical work are bounded. RouteLab does not claim unrestricted global optimality.
- The retained dataset is one 54-pool allowlist snapshot at Ethereum block 19,000,000. Its synthetic request corpus is not historical or representative demand.
- The project uses snapshots and localhost only; it does not submit transactions, sign messages, hold funds, connect to a relay, or settle trades.
- The HTTP boundary defaults to the retained fixed four-worker pool; its local comparison is not a production-capacity claim or an adaptive scheduler, and peak RSS increased materially.
- Timing is observational and excluded from plan fingerprints; no production-latency claim is made.
- Later work should be evidence-led: additional versioned snapshots, a separately designed live-data boundary, or new pool/gas semantics with exact differential evidence.

See [architecture](docs/architecture.md), [benchmark design](docs/benchmark.md), [case study](docs/case-study.md), [accepted invariants](docs/invariants.md), and the [changelog](CHANGELOG.md).

## License

Project code is MIT licensed. Curated historical facts and referenced provider/source material have a separate [data notice](DATA_NOTICE.md); dataset manifests grant no license.
