# RouteLab local HTTP load report v1

On this machine, the same-thread loopback service completed the fixed request mix at concurrency 1, 4, and 16. Higher concurrency queues synchronous CPU work on the event loop; no worker pool was added for v0.1.

| Concurrency | Requests | Completed | Failed | Timed out | p50 ms | p95 ms | p99 ms | req/s | Deadline completion | Event-loop max ms | Peak RSS MiB |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | 120 | 120 | 0 | 0 | 12.63 | 21.41 | 25.92 | 73.9 | 100.0% | 28.08 | 140.1 |
| 4 | 120 | 120 | 0 | 0 | 43.65 | 73.22 | 89.78 | 82.6 | 100.0% | 67.89 | 176.4 |
| 16 | 120 | 120 | 0 | 0 | 183.02 | 398.68 | 817.45 | 78.0 | 100.0% | 122.81 | 182.0 |

## Method

Each row uses 10 warmups and 120 measured requests over localhost. All rows rotate the same 6 retained historical requests with greedy-split/fast, a 5000 ms quote deadline, and a 10000 ms client timeout. p99 is reported only where at least 100 end-to-end observations completed. Event-loop delay comes from Node's nanosecond histogram; RSS is sampled in the shared server/load process.

This is local portfolio evidence, not production capacity or representative demand. The service has no live upstream, signing, custody, execution, or settlement.

Environment: v24.18.0; linux/x64; 13th Gen Intel(R) Core(TM) i9-13900H; revision 80d6eee; observed 2026-07-15T11:37:52.026Z.
