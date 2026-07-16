# RouteLab portfolio notes

## CV bullets

- Built a TypeScript exact-input liquidity router that searches bounded multi-hop and pool-disjoint
  split routes while authorizing every result through fresh exact `bigint` replay.
- Benchmarked greedy and path-shadow-price allocation across 396 deterministic
  historical-snapshot-derived requests; balanced numerical split beat/tied/lost greedy on
  240/156/0 requests, with structured work and convergence evidence kept separate.
- Designed a bounded local quote service and retained four fixed workers after a same-run c16
  comparison changed p95 from 51.12 to 23.04 ms and throughput from 434.2 to 1,044.3 requests/s,
  while documenting the peak-RSS increase from 249.7 to 402.8 MiB.

## Five-minute interview walkthrough

1. Fragmented liquidity and nonlinear price impact make a direct route insufficient.
2. Bounded path discovery and pool-disjoint route sets define a small, inspectable search space.
3. Approximate numerical allocation proposes; exact integer reconstruction and replay authorize.
4. A validated incumbent survives work or deadline exhaustion.
5. The 396-request benchmark reports a bounded comparison envelope rather than an optimum.
6. Separate-process load evidence explains both the worker tail-latency benefit and memory cost.
7. The implementation was simplified when experiment process outweighed user-facing value.
8. The NEAR seam is an offline parser and unsigned draft, not a live solver network.

## Claims to avoid

- production-ready or globally optimal routing;
- representative order flow or statistically significant performance;
- live NEAR connectivity, a decentralized solver network, signing, or settlement;
- cross-chain execution, gas-aware optimization, PRIME, or machine learning.

If asked why settlement is absent: the project demonstrates routing, exact authorization, and
service tradeoffs without introducing keys, funded balances, or claims that an offline snapshot
models transaction inclusion. Live protocol work belongs behind the strict boundary and requires
separate operational evidence.
