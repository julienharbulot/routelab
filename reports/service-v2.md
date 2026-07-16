# RouteLab isolated service performance v2

The load generator and quote server run in separate processes over localhost. This retained run contains same-thread mode only. Worker retention is not evaluated until both modes run sequentially in one invocation. Both modes retain at most 32 queued quotes, with typed 503 overload responses.

Evidence source: 1ba8d1e11f29fbab11d2667dfb5654df3d877702; routelab.evidence-source-paths.v1 (85 named paths); sha256:b89118f07fe728acc5ea53debea423865d10d47aa09b123585e88e75d4021f29.

| Mode | Concurrency | Requests | Completed/typed error/timeout/schema failure | Client success p50/p95/p99 ms | Error response p50/p95/p99 ms | req/s | Exact output/fingerprint/semantic match | Deadline completion | Quote service p50/p95/p99 ms | Event-loop p95/max ms | Accepted/rejected/overload | Max active/queued | Terminations | Route counts | RSS initial/peak/final MiB | Heap initial/peak/final MiB |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| same-thread | 1 | 1000 | 1000/0/0/0 | 3.53/6.07/6.80 | n/a | 261.3 | 1000/1000/1000 | 100.00% | 1.81/4.25/4.85 | 12.96/16.37 | 1000/0/0 | 1/0 | complete:1000 | 1:720, 2:280 | 119.4/179.4/179.4 | 16.3/52.3/22.2 |
| same-thread | 4 | 1000 | 1000/0/0/0 | 8.87/16.43/18.60 | n/a | 414.3 | 1000/1000/1000 | 100.00% | 1.85/4.45/5.07 | 13.65/15.16 | 1000/0/0 | 1/2 | complete:1000 | 1:720, 2:280 | 179.8/239.4/239.4 | 26.5/85.7/72.3 |
| same-thread | 16 | 1000 | 1000/0/0/0 | 36.19/48.94/51.38 | n/a | 450.7 | 1000/1000/1000 | 100.00% | 1.78/4.05/4.54 | 13.12/14.36 | 1000/0/0 | 1/14 | complete:1000 | 1:720, 2:280 | 239.4/251.3/251.3 | 29.0/95.7/44.9 |

## Worker decision

Decision: **not-evaluated**. Worker comparison is withheld until both modes run in one invocation.

## Method and limitations

The load-generator process owns concurrency scheduling, client timeouts, end-to-end latency, response validation, and client aggregation. The server child alone owns admission, structured completion logs, quote execution, event-loop delay, and server memory metrics.

Each retained row rotates all 396 requests in deterministic corpus order, uses 50 warmups and 1000 measured requests, greedy-split/fast, a 5000 ms end-to-end quote deadline, and a 10000 ms client timeout. Successful and error-response latency are separate; p99 is omitted below 1,000 observations. Server event-loop and memory metrics come only from the server process.

The requests are synthetic exact-input requests derived from one historical pool-reserve snapshot, not historical order flow or representative demand. This local result is not a production-capacity or statistical-significance claim. No live upstream, transaction submission, signing, custody, execution, or settlement is involved.

Environment: v24.18.0; linux/x64; 13th Gen Intel(R) Core(TM) i9-13900H; source revision 1ba8d1e11f29fbab11d2667dfb5654df3d877702; observed 2026-07-16T02:05:46.882Z.

![Service latency](service-latency.svg)
