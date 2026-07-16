# RouteLab status

**State:** REL-002 service-and-metrics evidence candidate; review pending

Implemented: one-invocation service comparison, strict worker quote validation, deadline/overload lanes, categorical effort chart, structured counters, and proposal-level convergence.

Evidence source: `8babed2e2a7d1101980757777e06043eea5bc4e9`; digest `sha256:cd363964aa8f3f5c3ea27b181720704f3adc9268d2ab207987c54053bc79980c` over 90 named paths.

Result: workers passed the frozen gate at c16, reducing p95 from 52.44 to 26.89 ms and raising throughput from 425.1 to 923.3/s while peak RSS rose from 250.8 to 409.0 MiB.

Next: run the complete REL-002 gate and read-only review before beginning REL-003.

Out of scope: live data, signing, custody, settlement, PRIME, ML, gas-aware routing, and concentrated liquidity.
