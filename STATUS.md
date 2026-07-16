# RouteLab status

**State:** REL-002 service-and-metrics evidence candidate; review pending

Implemented: one-invocation service comparison, strict worker quote validation, deadline/overload lanes, categorical effort chart, structured counters, and proposal-level convergence.

Evidence source: `a12db43ea0495d18cdcbfb66d7fd8e8dd6a224f4`; digest `sha256:a7ecadf66fa5b4fca088827d616071a984d28807b105c7f8aafb2c0d07b8adb7` over 90 named paths.

Result: workers passed the frozen gate at c16, reducing p95 from 51.07 to 20.16 ms and raising throughput from 432.4 to 1,143.1/s while peak RSS rose from 250.3 to 409.3 MiB.

Next: run the complete REL-002 gate and read-only review before beginning REL-003.

Out of scope: live data, signing, custody, settlement, PRIME, ML, gas-aware routing, and concentrated liquidity.
