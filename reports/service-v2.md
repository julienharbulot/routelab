# RouteLab isolated service performance v2

The load generator and quote server run in separate processes over localhost. Same-thread mode retains 1 active synchronous quote; worker mode uses 4 fixed workers. Both modes retain at most 32 queued quotes, with typed 503 overload responses.

Evidence source: a12db43ea0495d18cdcbfb66d7fd8e8dd6a224f4; routelab.evidence-source-paths.v1 (90 named paths); sha256:a7ecadf66fa5b4fca088827d616071a984d28807b105c7f8aafb2c0d07b8adb7.

| Mode | Concurrency | Requests | Completed/typed error/timeout/schema failure | Client success p50/p95/p99 ms | Error response p50/p95/p99 ms | req/s | Exact output/fingerprint/semantic match | Deadline completion | Queue wait p50/p95/p99 ms | Quote service p50/p95/p99 ms | Event-loop p95/max ms | Accepted/rejected/overload | Max active/queued | Terminations | Route counts | RSS initial/peak/final MiB | Heap initial/peak/final MiB |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| same-thread | 1 | 1000 | 1000/0/0/0 | 3.52/6.27/7.60 | n/a | 254.3 | 1000/1000/1000 | 100.00% | 0.01/0.01/0.04 | 1.78/4.36/5.27 | 13.30/15.56 | 1000/0/0 | 1/0 | complete:1000 | 1:720, 2:280 | 117.5/180.6/180.6 | 14.7/55.2/25.1 |
| same-thread | 4 | 1000 | 1000/0/0/0 | 8.93/16.62/22.21 | n/a | 401.5 | 1000/1000/1000 | 100.00% | 4.32/9.41/12.16 | 1.93/4.55/5.60 | 13.37/15.86 | 1000/0/0 | 1/2 | complete:1000 | 1:720, 2:280 | 181.4/238.1/238.1 | 29.5/87.0/71.8 |
| same-thread | 16 | 1000 | 1000/0/0/0 | 37.35/51.07/53.63 | n/a | 432.4 | 1000/1000/1000 | 100.00% | 31.95/45.04/47.87 | 1.85/4.20/4.68 | 13.25/15.14 | 1000/0/0 | 1/14 | complete:1000 | 1:720, 2:280 | 239.1/250.3/250.3 | 32.6/96.0/45.2 |
| worker | 1 | 1000 | 1000/0/0/0 | 3.57/6.21/7.46 | n/a | 252.4 | 1000/1000/1000 | 100.00% | 0.01/0.02/0.04 | 1.93/4.38/5.50 | 10.80/11.07 | 1000/0/0 | 1/0 | complete:1000 | 1:720, 2:280 | 215.1/282.6/282.6 | 13.8/21.5/20.4 |
| worker | 4 | 1000 | 1000/0/0/0 | 4.56/8.34/11.48 | n/a | 780.1 | 1000/1000/1000 | 100.00% | 0.01/0.09/0.20 | 2.72/6.41/9.47 | 10.76/11.09 | 1000/0/0 | 4/0 | complete:1000 | 1:720, 2:280 | 282.9/376.0/376.0 | 21.7/33.1/26.6 |
| worker | 16 | 1000 | 1000/0/0/0 | 13.59/20.16/25.42 | n/a | 1143.1 | 1000/1000/1000 | 100.00% | 8.30/12.63/14.17 | 2.93/6.45/7.07 | 10.67/18.78 | 1000/0/0 | 4/12 | complete:1000 | 1:720, 2:280 | 377.1/409.3/409.3 | 27.8/36.3/35.3 |

## Worker decision

Decision: **retained**. The frozen semantic, tail, throughput, c1 overhead, admission, and memory gates passed.

Frozen gate measurements: semantic/schema=true; tail=p95 605204 ppm; event-loop max=-240241 ppm; c16 throughput ratio=2643394 ppm; c1 p50 overhead=54 µs; no lost requests=true; memory reported=true.

The frozen retention thresholds are: no semantic/schema regression; at least 25% c16 p95 or p99 improvement, or at least 50% event-loop max improvement; c16 throughput at least 90% of baseline; c1 p50 overhead no more than 2 ms; no lost requests; and reported memory cost.

## Deadline sweep

| Deadline | Requests | Complete/deadline incumbent/before plan/overload/timeout/failure | Exact valid | Complete p50/p95/p99 ms | Deadline incumbent p50/p95/p99 ms | Error p50/p95/p99 ms |
|---:|---:|---:|---:|---:|---:|---:|
| 25 ms | 200 | 40/146/14/0/0/0 | 186 | 23.61/27.58/n/a | 27.27/30.37/n/a | 26.98/28.12/n/a |
| 50 ms | 200 | 158/42/0/0/0/0 | 200 | 42.64/50.99/n/a | 52.02/53.36/n/a | n/a |
| 100 ms | 200 | 200/0/0/0/0/0 | 200 | 46.73/71.31/n/a | n/a | n/a |

Deadline outcomes are classified separately from the normal successful-latency distribution. Every complete or deadline-incumbent quote counted above passed exact replay and fingerprint validation in the load-generator process.

## Bounded overload burst

The deterministic 52-request burst exceeded 4 active plus 32 queued work slots: 36 were accepted and exactly validated, 16 received typed 503 overloaded responses, and all 16 overload responses carried Retry-After. Maximum observed queue depth was 32.

## Method and limitations

The load-generator process owns concurrency scheduling, client timeouts, end-to-end latency, response validation, and client aggregation. The server child alone owns admission, queue-wait and quote-service distributions, structured completion logs, quote execution, event-loop delay, and server memory metrics.

Each normal retained row rotates all 396 requests in deterministic corpus order, uses 50 warmups and 1000 measured requests, greedy-split/fast, a 5000 ms end-to-end quote deadline, and a 10000 ms client timeout. Same-thread is shut down before worker mode starts; no prior report is read as a baseline. Successful and error-response latency are separate; p99 is omitted below 1,000 observations. Server event-loop and memory metrics come only from the server process.

The requests are synthetic exact-input requests derived from one historical pool-reserve snapshot, not historical order flow or representative demand. This local result is not a production-capacity or statistical-significance claim. No live upstream, transaction submission, signing, custody, execution, or settlement is involved.

Environment: v24.18.0; linux/x64; 13th Gen Intel(R) Core(TM) i9-13900H; source revision a12db43ea0495d18cdcbfb66d7fd8e8dd6a224f4; observed 2026-07-16T03:40:12.099Z.

![Service latency](service-latency.svg)
