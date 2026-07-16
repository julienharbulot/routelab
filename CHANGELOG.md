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
- On the retained local service run, four workers reduced concurrency-16 p95 from 46.08 ms to
  19.30 ms and raised throughput from 480.1 to 1,189.2 requests/s. All 3,000 worker responses
  matched expected exact outputs and plan fingerprints.

### NEAR fixture boundary

- Public exact-input quote parameters and solver WebSocket quote events are modeled separately.
- Solver drafts preserve `quote_id` but are explicitly internal and unsigned, with no
  `signed_data`, nonce, quote hash, signature, public key, relay connectivity, or settlement.

### Limitations

- The dataset is one curated historical snapshot and the request corpus is synthetic, not order
  flow or representative demand. The practical benchmark reference is not a global optimum.
- Service measurements are local observations, not production-capacity or statistical claims.
- No live data, credentials, signing, custody, balance management, transaction submission,
  execution, or settlement is included.
