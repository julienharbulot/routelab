# RouteLab isolated service performance v2

The load generator and quote server run in separate processes over localhost. Same-thread mode retains 1 active synchronous quote; worker mode uses 4 fixed workers. Both modes retain at most 32 queued quotes, with typed 503 overload responses.

Evidence source: 79642a2c88f07800344252e0990d0f433ab22c63; routelab.evidence-source-paths.v1 (90 named paths); sha256:36e5cfb6625c9f9c4be1288c8f23595f4179b7d71db57a1dec188b5d32e00499.

| Mode | Concurrency | Requests | Completed/typed error/timeout/schema failure | Client success p50/p95/p99 ms | Error response p50/p95/p99 ms | req/s | Exact output/fingerprint/semantic match | Deadline completion | Queue wait p50/p95/p99 ms | Quote service p50/p95/p99 ms | Event-loop p95/max ms | Accepted/rejected/overload | Max active/queued | Terminations | Route counts | RSS initial/peak/final MiB | Heap initial/peak/final MiB |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| same-thread | 1 | 1000 | 1000/0/0/0 | 3.39/5.88/6.58 | n/a | 268.6 | 1000/1000/1000 | 100.00% | 0.01/0.01/0.04 | 1.72/4.09/4.63 | 13.13/15.94 | 1000/0/0 | 1/0 | complete:1000 | 1:720, 2:280 | 117.8/180.2/180.2 | 16.3/53.1/23.0 |
| same-thread | 4 | 1000 | 1000/0/0/0 | 8.54/15.28/17.27 | n/a | 432.6 | 1000/1000/1000 | 100.00% | 4.02/8.87/10.01 | 1.80/4.17/4.71 | 13.01/16.02 | 1000/0/0 | 1/2 | complete:1000 | 1:720, 2:280 | 180.8/234.5/234.5 | 27.3/84.6/69.3 |
| same-thread | 16 | 1000 | 1000/0/0/0 | 36.70/51.12/53.16 | n/a | 434.2 | 1000/1000/1000 | 100.00% | 31.69/45.22/47.06 | 1.83/4.14/4.86 | 13.12/15.56 | 1000/0/0 | 1/14 | complete:1000 | 1:720, 2:280 | 235.0/249.7/249.7 | 30.1/94.2/43.4 |
| worker | 1 | 1000 | 1000/0/0/0 | 3.41/5.95/6.56 | n/a | 265.6 | 1000/1000/1000 | 100.00% | 0.01/0.01/0.04 | 1.83/4.23/4.72 | 10.80/11.16 | 1000/0/0 | 1/0 | complete:1000 | 1:720, 2:280 | 216.2/283.7/283.7 | 13.8/21.5/19.2 |
| worker | 4 | 1000 | 1000/0/0/0 | 4.50/8.37/11.04 | n/a | 790.6 | 1000/1000/1000 | 100.00% | 0.01/0.14/0.24 | 2.73/6.21/9.18 | 10.79/11.13 | 1000/0/0 | 4/0 | complete:1000 | 1:720, 2:280 | 283.7/373.0/373.0 | 20.5/33.3/25.5 |
| worker | 16 | 1000 | 1000/0/0/0 | 14.92/23.04/29.84 | n/a | 1044.3 | 1000/1000/1000 | 100.00% | 9.23/14.67/17.63 | 3.15/7.04/8.78 | 10.70/16.49 | 1000/0/0 | 4/12 | complete:1000 | 1:720, 2:280 | 373.7/402.8/402.8 | 26.7/36.4/34.2 |

## Worker decision

Decision: **retained**. The frozen semantic, tail, throughput, c1 overhead, admission, and memory gates passed.

Frozen gate measurements: semantic/schema=true; tail=p95 549276 ppm; event-loop max=-59974 ppm; c16 throughput ratio=2405399 ppm; c1 p50 overhead=22 µs; no lost requests=true; memory reported=true.

The frozen retention thresholds are: no semantic/schema regression; at least 25% c16 p95 or p99 improvement, or at least 50% event-loop max improvement; c16 throughput at least 90% of baseline; c1 p50 overhead no more than 2 ms; no lost requests; and reported memory cost.

## Deadline sweep

| Deadline | Requests | Complete/deadline incumbent/before plan/overload/timeout/failure | Exact valid | Complete p50/p95/p99 ms | Deadline incumbent p50/p95/p99 ms | Error p50/p95/p99 ms |
|---:|---:|---:|---:|---:|---:|---:|
| 25 ms | 200 | 38/143/19/0/0/0 | 181 | 24.32/27.45/n/a | 27.10/28.62/n/a | 27.66/30.98/n/a |
| 50 ms | 200 | 152/48/0/0/0/0 | 200 | 41.14/51.08/n/a | 52.03/53.04/n/a | n/a |
| 100 ms | 200 | 200/0/0/0/0/0 | 200 | 45.74/68.63/n/a | n/a | n/a |

Deadline outcomes are classified separately from the normal successful-latency distribution. Every complete or deadline-incumbent quote counted above passed exact replay and fingerprint validation in the load-generator process.

## Bounded overload burst

The deterministic 52-request burst exceeded 4 active plus 32 queued work slots: 36 were accepted and exactly validated, 16 received typed 503 overloaded responses, and all 16 overload responses carried Retry-After. Maximum observed queue depth was 32.

## Method and limitations

The load-generator process owns concurrency scheduling, client timeouts, end-to-end latency, response validation, and client aggregation. The server child alone owns admission, queue-wait and quote-service distributions, structured completion logs, quote execution, event-loop delay, and server memory metrics.

Each normal retained row rotates all 396 requests in deterministic corpus order, uses 50 warmups and 1000 measured requests, greedy-split/fast, a 5000 ms end-to-end quote deadline, and a 10000 ms client timeout. Same-thread is shut down before worker mode starts; no prior report is read as a baseline. Successful and error-response latency are separate; p99 is omitted below 1,000 observations. Server event-loop and memory metrics come only from the server process.

The requests are synthetic exact-input requests derived from one historical pool-reserve snapshot, not historical order flow or representative demand. This local result is not a production-capacity or statistical-significance claim. No live upstream, transaction submission, signing, custody, execution, or settlement is involved.

Environment: v24.18.0; linux/x64; 13th Gen Intel(R) Core(TM) i9-13900H; source revision 79642a2c88f07800344252e0990d0f433ab22c63; observed 2026-07-16T03:53:00.266Z.

![Service latency](service-latency.svg)
