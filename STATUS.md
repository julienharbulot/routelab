# RouteLab status

**State:** PORT-009 complete; PORT-010 active

Implemented: isolated server/load processes, one-active/32-queued same-thread admission, typed overload/deadline behavior, structured logs, and a retained fixed four-worker pool.

Evidence: 1,000 requests per mode at concurrency 1/4/16; worker c16 p95 improved 58.1%, throughput ratio was 2.477, c1 p50 overhead was 0.22 ms, and all exact outputs/fingerprints matched.

Known limitation: service evidence is one local machine and synthetic request grid; four workers increase process RSS and do not imply production capacity.

Next: align the offline NEAR Intents fixture with current official protocol shapes and complete release proof in PORT-010.

Out of scope: live data, signing, custody, settlement, PRIME, ML, gas-aware routing, and concentrated liquidity.
