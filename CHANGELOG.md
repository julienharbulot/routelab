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
- Retained benchmark and same-thread service reports identify source commit
  `1ba8d1e11f29fbab11d2667dfb5654df3d877702` and source-tree digest
  `sha256:b89118f07fe728acc5ea53debea423865d10d47aa09b123585e88e75d4021f29`.
- The clean-source same-thread service baseline completed all 3,000 requests with exact
  output/fingerprint parity; concurrency-16 p95 was 48.94 ms at 450.7 requests/s. The prior
  cross-run worker comparison is withdrawn until both modes run in one invocation.

### Release audit

- CI supports manual dispatch and runs the complete short `release:verify` gate.
- Retained generation rejects dirty executable/configuration paths, while report-only and ignored
  raw-output changes remain allowed; benchmark and service verifiers recompute the named-path digest.
- Non-smoke worker comparison fails closed instead of loading a previously retained baseline.

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
