# RouteLab isolated service performance v2

The load generator and quote server run in separate processes over localhost. Same-thread mode retains 1 active synchronous quote; worker mode uses 4 fixed workers. Both modes retain at most 32 queued quotes, with typed 503 overload responses.

Evidence source: e7f8c1032aa29f3a9ebf1cbf4859907fe076b138; routelab.evidence-source-paths.v1 (84 named paths); sha256:e195c5d8df3121d19f52990452a71c54f4af00b7733d015249f864ba8036c783.

| Mode | Concurrency | Requests | Completed/typed error/timeout/schema failure | Client success p50/p95/p99 ms | Error response p50/p95/p99 ms | req/s | Exact output/fingerprint/semantic match | Deadline completion | Queue wait p50/p95/p99 ms | Quote service p50/p95/p99 ms | Event-loop p95/max ms | Accepted/rejected/overload | Max active/queued | Terminations | Route counts | RSS initial/peak/final MiB | Heap initial/peak/final MiB |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| same-thread | 1 | 1000 | 1000/0/0/0 | 3.41/6.00/6.85 | n/a | 262.0 | 1000/1000/1000 | 100.00% | 0.01/0.01/0.04 | 1.74/4.17/4.82 | 12.66/14.69 | 1000/0/0 | 1/0 | complete:1000 | 1:720, 2:280 | 119.9/178.5/178.5 | 16.3/53.1/23.0 |
| same-thread | 4 | 1000 | 1000/0/0/0 | 8.60/15.44/16.71 | n/a | 430.1 | 1000/1000/1000 | 100.00% | 4.08/9.07/9.75 | 1.80/4.21/4.70 | 13.53/14.90 | 1000/0/0 | 1/2 | complete:1000 | 1:720, 2:280 | 179.3/232.3/232.3 | 27.4/82.9/67.7 |
| same-thread | 16 | 1000 | 1000/0/0/0 | 36.35/50.51/54.18 | n/a | 439.6 | 1000/1000/1000 | 100.00% | 31.14/45.12/47.60 | 1.82/4.22/4.71 | 13.68/15.39 | 1000/0/0 | 1/14 | complete:1000 | 1:720, 2:280 | 232.4/250.2/250.2 | 28.5/96.4/45.5 |
| worker | 1 | 1000 | 1000/0/0/0 | 3.65/6.22/7.22 | n/a | 248.7 | 1000/1000/1000 | 100.00% | 0.01/0.01/0.05 | 1.97/4.43/5.22 | 10.80/11.08 | 1000/0/0 | 1/0 | complete:1000 | 1:720, 2:280 | 216.9/282.5/282.5 | 13.8/21.7/18.6 |
| worker | 4 | 1000 | 1000/0/0/0 | 4.55/8.08/10.95 | n/a | 788.0 | 1000/1000/1000 | 100.00% | 0.01/0.11/0.20 | 2.71/6.14/8.87 | 10.72/11.35 | 1000/0/0 | 4/0 | complete:1000 | 1:720, 2:280 | 282.6/374.1/374.1 | 19.9/33.7/24.9 |
| worker | 16 | 1000 | 1000/0/0/0 | 13.71/20.58/42.92 | n/a | 1098.1 | 1000/1000/1000 | 100.00% | 8.32/13.31/14.87 | 2.96/6.70/7.83 | 10.60/42.01 | 1000/0/0 | 4/12 | complete:1000 | 1:720, 2:280 | 374.3/405.1/405.1 | 26.1/36.8/33.7 |

## Worker decision

Decision: **retained**. The frozen semantic, tail, throughput, c1 overhead, admission, and memory gates passed.

Frozen gate measurements: semantic/schema=true; tail=p95 592615 ppm; event-loop max=-1729098 ppm; c16 throughput ratio=2497950 ppm; c1 p50 overhead=236 µs; no lost requests=true; memory reported=true.

The frozen retention thresholds are: no semantic/schema regression; at least 25% c16 p95 or p99 improvement, or at least 50% event-loop max improvement; c16 throughput at least 90% of baseline; c1 p50 overhead no more than 2 ms; no lost requests; and reported memory cost.

## Deadline sweep

| Deadline | Requests | Complete/deadline incumbent/before plan/overload/timeout/failure | Exact valid | Complete p50/p95/p99 ms | Deadline incumbent p50/p95/p99 ms | Error p50/p95/p99 ms |
|---:|---:|---:|---:|---:|---:|---:|
| 25 ms | 200 | 43/150/7/0/0/0 | 193 | 24.26/27.31/n/a | 26.80/28.16/n/a | 28.24/28.73/n/a |
| 50 ms | 200 | 159/41/0/0/0/0 | 200 | 43.07/50.64/n/a | 51.98/53.08/n/a | n/a |
| 100 ms | 200 | 200/0/0/0/0/0 | 200 | 44.85/66.77/n/a | n/a | n/a |

Deadline outcomes are classified separately from the normal successful-latency distribution. Every complete or deadline-incumbent quote counted above passed exact replay and fingerprint validation in the load-generator process.

## Bounded overload burst

The deterministic 52-request burst exceeded 4 active plus 32 queued work slots: 36 were accepted and exactly validated, 16 received typed 503 overloaded responses, and all 16 overload responses carried Retry-After. Maximum observed queue depth was 32.

## Method and limitations

The load-generator process owns concurrency scheduling, client timeouts, end-to-end latency, response validation, and client aggregation. The server child alone owns admission, queue-wait and quote-service distributions, structured completion logs, quote execution, event-loop delay, and server memory metrics.

Each normal retained row rotates all 396 requests in deterministic corpus order, uses 50 warmups and 1000 measured requests, greedy-split/fast, a 5000 ms end-to-end quote deadline, and a 10000 ms client timeout. Same-thread is shut down before worker mode starts; no prior report is read as a baseline. Successful and error-response latency are separate; p99 is omitted below 1,000 observations. Server event-loop and memory metrics come only from the server process.

The requests are synthetic exact-input requests derived from one historical pool-reserve snapshot, not historical order flow or representative demand. This local result is not a production-capacity or statistical-significance claim. No live upstream, transaction submission, signing, custody, execution, or settlement is involved.

Environment: v24.18.0; linux/x64; 13th Gen Intel(R) Core(TM) i9-13900H; source revision e7f8c1032aa29f3a9ebf1cbf4859907fe076b138; observed 2026-07-16T05:21:56.010Z.

![Service latency](service-latency.svg)
