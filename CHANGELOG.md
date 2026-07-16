# Changelog

## 0.1.0 release candidate

### Implemented scope

- Exact-input routing over immutable constant-product snapshots with bounded direct, multi-hop,
  pool-disjoint split, greedy-allocation, and optional numerical-allocation strategies.
- One TypeScript facade, readable CLI/demo, compact benchmark, bounded local HTTP service,
  isolated load command, package-consumer proof, and offline NEAR Intents fixture subpath.
- Fresh exact `bigint` replay authorizes every returned plan; snapshot ID and checksum are part of
  the validated boundary and stable plan fingerprint.

### Measured evidence

- Benchmark v2 covers all 396 synthetic requests derived from the retained historical reserve
  snapshot. All 3,168 returned mode/request plans passed fresh exact replay; fast numerical split
  beat/tied/lost fast greedy split on 19/377/0 requests.
- Retained benchmark and service reports identify source commit
  `79642a2c88f07800344252e0990d0f433ab22c63` and source-tree digest
  `sha256:36e5cfb6625c9f9c4be1288c8f23595f4179b7d71db57a1dec188b5d32e00499`.
- All 6,000 normal service responses matched exact output and fingerprint. At concurrency 16,
  workers changed p95 from 51.12 to 23.04 ms and throughput from 434.2 to 1,044.3 requests/s while
  peak server RSS rose from 249.7 to 402.8 MiB, passing the frozen retention gate. Queue-wait and
  quote-service distributions are reported separately.
- Deadline lanes at 25/50/100 ms returned 181/200/200 exactly validated quotes and 19/0/0
  deadline-before-plan errors. The 52-request overload burst accepted 36 exact quotes and returned
  16 typed 503 overloads, all with `Retry-After`.

### Release audit

- CI supports manual dispatch and runs the complete short `release:verify` gate.
- Retained generation rejects dirty executable/configuration paths, while report-only and ignored
  raw-output changes remain allowed; benchmark and service verifiers recompute the named-path digest.
- Compare mode starts and fully stops both service modes in one invocation and never loads a
  previously retained baseline. Worker responses now fail closed unless required quote fields and
  the originating request/snapshot identity validate.
- Benchmark quality uses categorical effort, separate p50/p95 work counters, proposal-level
  convergence counts, and best-observed exact regret with a separate large-budget diagnostic.

### NEAR fixture boundary

- Public exact-input quote parameters and solver WebSocket quote events are modeled separately.
- Omitted public `min_deadline_ms` normalizes to the documented 60,000 ms default, while solver
  events continue to require the field.
- Solver drafts preserve `quote_id` but are explicitly internal and unsigned, with no
  `signed_data`, nonce, quote hash, signature, public key, relay connectivity, or settlement.

### Limitations

- The dataset is one curated historical snapshot and the request corpus is synthetic, not order
  flow or representative demand. The large-budget comparison is not a global optimum.
- Service measurements are local observations, not production-capacity or statistical claims.
- No live data, credentials, signing, custody, balance management, transaction submission,
  execution, or settlement is included.
