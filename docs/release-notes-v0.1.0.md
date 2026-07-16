# RouteLab TS v0.1.0 release notes

RouteLab TS is an exact-input liquidity router for immutable constant-product snapshots. It searches
bounded multi-hop and pool-disjoint split routes and authorizes every returned plan through fresh
exact `bigint` replay.

## Highlights

- four-function TypeScript library facade, readable quote CLI, and deterministic demo;
- best-single, greedy-split, and exact-authorized path-shadow-price allocation;
- bounded local HTTP quote service with typed admission, deadline, and overload behavior;
- clean packed-consumer proof for both the package root and NEAR fixture subpath;
- offline unsigned NEAR Intents-style boundary with no live execution.

## Retained evidence

The benchmark uses 396 synthetic exact-input requests derived from one historical 54-pool reserve
snapshot. All 3,168 returned fixed-mode plans passed fresh exact replay. At fast effort, numerical
split beat/tied/lost greedy split on 19/377/0 requests; thorough numerical split recorded 640 ppm
p95 regret against the best exact output observed across the declared bounded modes.

On the retained local machine, fast greedy split recorded 1,706 µs p50 and 4,564 µs p99 over 1,000
rotating calls. In a same-run service comparison, four fixed workers changed concurrency-16 p95
from 51.12 to 23.04 ms and throughput from 434.2 to 1,044.3 requests/s. Peak server RSS rose from
249.7 to 402.8 MiB, so the worker decision is a measured latency/memory tradeoff rather than a free
improvement.

At concurrency 16, 25/50/100 ms deadline lanes returned 181/200/200 exactly validated quotes and
19/0/0 deadline-before-plan responses. A 52-request overload burst accepted 36 exact quotes and
returned 16 typed 503 responses, all with `Retry-After`.

## Reproduce

```bash
corepack enable
corepack install --global pnpm@11.12.0
pnpm install --frozen-lockfile
pnpm release:verify
pnpm benchmark:verify
pnpm test:package
pnpm load:smoke
```

## Limitations

- one curated historical reserve snapshot and synthetic requests, not representative order flow;
- constant-product pools and bounded two-hop/two-route headline comparisons;
- local performance evidence from one machine and a fixed four-worker pool;
- no live data, gas objective, credentials, signing, custody, submission, execution, or settlement;
- no unrestricted-optimality, statistical-significance, or production-capacity claim.

Project code is MIT licensed. `DATA_NOTICE.md` describes the dataset publication boundary.
