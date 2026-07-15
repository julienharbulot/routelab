# RouteLab local HTTP load report v1

On this machine, the same-thread loopback service completed the fixed request mix at concurrency 1, 4, and 16. Higher concurrency queues synchronous CPU work on the event loop; no worker pool was added for v0.1.

| Concurrency | Requests | Completed | Failed | Timed out | p50 ms | p95 ms | p99 ms | req/s | Deadline completion | Event-loop max ms | Peak RSS MiB |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | 120 | 120 | 0 | 0 | 13.64 | 26.07 | 28.81 | 67.4 | 100.0% | 33.46 | 137.1 |
| 4 | 120 | 120 | 0 | 0 | 51.54 | 79.93 | 88.53 | 72.1 | 100.0% | 65.34 | 175.2 |
| 16 | 120 | 120 | 0 | 0 | 187.43 | 358.44 | 783.22 | 81.6 | 100.0% | 122.36 | 175.4 |

## Method

Each row uses 10 warmups and 120 measured requests over localhost. All rows rotate the same 6 retained historical requests with greedy-split/fast, a 5000 ms quote deadline, and a 10000 ms client timeout. p99 is reported only where at least 100 end-to-end observations completed. Event-loop delay comes from Node's nanosecond histogram; RSS is sampled in the shared server/load process.

This is local portfolio evidence, not production capacity or representative demand. The service has no live upstream, signing, custody, execution, or settlement.

Environment: v24.18.0; linux/x64; 13th Gen Intel(R) Core(TM) i9-13900H; revision 20867d8; observed 2026-07-15T11:24:48.824Z.
