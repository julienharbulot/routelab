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
  `e7f8c1032aa29f3a9ebf1cbf4859907fe076b138` and source-tree digest
  `sha256:e195c5d8df3121d19f52990452a71c54f4af00b7733d015249f864ba8036c783`.
- All 6,000 normal service responses matched exact output and fingerprint. At concurrency 16,
  workers changed p95 from 50.51 to 20.58 ms and throughput from 439.6 to 1,098.1 requests/s while
  peak server RSS rose from 250.2 to 405.1 MiB, passing the frozen retention gate. Queue-wait and
  quote-service distributions are reported separately.
- Deadline lanes at 25/50/100 ms returned 193/200/200 exactly validated quotes and 7/0/0
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
- Benchmark requests are generated from the verified retained snapshot; the obsolete checked-in
  request artifact and source-specific verifier stacks are no longer maintained.
- Published package contents are limited to the runtime closure of the root and NEAR fixture exports.

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
