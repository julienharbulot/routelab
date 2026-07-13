# Composed historical comparison config

`comparison-config.v3.json` freezes only the deterministic routing and comparison semantics, including the six typed work-cap profiles used to evaluate the exact-input split runtime over the verified synthetic request corpus. It contains no timing, environment, revision, observation identity, or limitation prose. `observation-config.v2.json` separately freezes the call-only clock, warmup/sample/order protocol, required environment fields, timed-result equality rule, and timing limitations. Their byte lengths and SHA-256 values are distinct evaluation bindings; changes require new identifiers and hashes.

Timing is an operational observation only. No observation-config identity or field enters semantic results or cell hashes. Raw observations carry no threshold or statistical claim and do not compare base and head revisions. The structural-complete profile is complete only for the frozen corpus and bounded runtime configuration; it is not evidence of unrestricted global optimality.

Generate artifacts into an explicit empty target with `pnpm evaluate:historical -- <output-directory> f98dddbd748c08594c7f0de0e9b457fe69417dd5`. Verify the canonical tracked evaluation with `pnpm verify:historical-evaluation`.
