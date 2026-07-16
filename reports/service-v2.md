# RouteLab isolated service performance v2

The load generator and quote server run in separate processes over localhost. Same-thread mode retains 1 active synchronous quote; worker mode uses 4 fixed workers. Both retain at most 32 queued quotes, with typed 503 overload responses.

| Mode | Concurrency | Requests | Completed/typed error/timeout/schema failure | Client success p50/p95/p99 ms | Error response p50/p95/p99 ms | req/s | Exact output/fingerprint/semantic match | Deadline completion | Quote service p50/p95/p99 ms | Event-loop p95/max ms | Accepted/rejected/overload | Max active/queued | Terminations | Route counts | RSS initial/peak/final MiB | Heap initial/peak/final MiB |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| same-thread | 1 | 1000 | 1000/0/0/0 | 3.18/5.47/5.98 | n/a | 291.7 | 1000/1000/1000 | 100.00% | 1.64/3.85/4.16 | 12.49/14.41 | 1000/0/0 | 1/0 | complete:1000 | 1:720, 2:280 | 116.7/176.7/176.7 | 14.7/52.4/22.3 |
| same-thread | 4 | 1000 | 1000/0/0/0 | 7.93/14.22/15.91 | n/a | 468.1 | 1000/1000/1000 | 100.00% | 1.71/3.87/4.23 | 12.68/16.57 | 1000/0/0 | 1/2 | complete:1000 | 1:720, 2:280 | 177.2/234.7/234.7 | 26.7/85.6/68.8 |
| same-thread | 16 | 1000 | 1000/0/0/0 | 33.54/46.08/48.62 | n/a | 480.1 | 1000/1000/1000 | 100.00% | 1.70/3.87/4.28 | 13.06/13.95 | 1000/0/0 | 1/14 | complete:1000 | 1:720, 2:280 | 235.2/249.4/249.4 | 29.6/96.4/45.6 |
| worker | 1 | 1000 | 1000/0/0/0 | 3.41/5.74/6.27 | n/a | 273.3 | 1000/1000/1000 | 100.00% | 1.80/4.07/4.52 | 10.80/11.07 | 1000/0/0 | 1/0 | complete:1000 | 1:720, 2:280 | 216.6/281.4/281.4 | 13.8/21.5/20.3 |
| worker | 4 | 1000 | 1000/0/0/0 | 4.41/8.09/10.22 | n/a | 827.6 | 1000/1000/1000 | 100.00% | 2.67/6.06/7.91 | 10.74/11.21 | 1000/0/0 | 4/0 | complete:1000 | 1:720, 2:280 | 281.6/376.4/376.4 | 21.6/33.0/26.4 |
| worker | 16 | 1000 | 1000/0/0/0 | 12.83/19.30/35.37 | n/a | 1189.2 | 1000/1000/1000 | 100.00% | 2.81/6.29/7.17 | 10.68/23.00 | 1000/0/0 | 4/12 | complete:1000 | 1:720, 2:280 | 377.5/406.3/406.3 | 27.6/36.1/35.0 |

## Worker decision

Decision: **retained**. Gate passed: c16 p95 58.1%, p99 27.3%, event-loop max -64.9%; throughput ratio 2.477; c1 p50 overhead 0.22 ms; semantic/schema regression none.

## Method and limitations

The load-generator process owns concurrency scheduling, client timeouts, end-to-end latency, response validation, and client aggregation. The server child alone owns admission, structured completion logs, quote execution, event-loop delay, and server memory metrics.

Each retained row rotates all 396 requests in deterministic corpus order, uses 50 warmups and 1000 measured requests, greedy-split/fast, a 5000 ms end-to-end quote deadline, and a 10000 ms client timeout. Successful and error-response latency are separate; p99 is omitted below 1,000 observations. Server event-loop and memory metrics come only from the server process. Worker mode uses a fixed 4-worker pool with snapshots prepared once per worker.

The requests are synthetic exact-input requests derived from one historical pool-reserve snapshot, not historical order flow or representative demand. This local result is not a production-capacity or statistical-significance claim. No live upstream, transaction submission, signing, custody, execution, or settlement is involved.

Environment: v24.18.0; linux/x64; 13th Gen Intel(R) Core(TM) i9-13900H; revision ec3c5e9; observed 2026-07-16T00:07:43.636Z.

![Service latency](service-latency.svg)
