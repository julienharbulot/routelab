# RouteLab TS: exact liquidity routing under bounded computation

## Problem

Liquidity is fragmented across pools. A direct swap can lose to a multi-hop path, and a split over
pool-disjoint routes can reduce price impact. The harder requirement is safety under bounded work:
the system must never publish an approximate or partially checked financial result.

## Design decision

RouteLab separates proposal from authorization:

```text
bounded search / approximate allocation
                  |
                  v
         exact integer reconstruction
                  |
                  v
          fresh bigint replay
                  |
                  v
            published quote
```

All amounts, reserves, fees, allocations, and outputs remain `bigint`. Numerical work proposes an
allocation, but only fresh replay against the requested immutable snapshot can replace the exact
incumbent. Deadline or work exhaustion therefore returns a validated plan or a typed no-plan error.

## Implemented system

- bounded multi-hop and pool-disjoint split discovery;
- best-single, greedy-split, and path-shadow-price allocation;
- deterministic decimal-string serialization and plan fingerprints;
- one library facade, readable CLI, local HTTP service, and fixture-only NEAR adapter;
- bounded HTTP admission with fixed workers, deadline propagation, and typed overloads.

## Quality evidence

The retained benchmark covers 396 synthetic exact-input requests derived from one historical
54-pool reserve snapshot. It is not historical order flow or representative demand. All 3,168
returned mode/request plans passed fresh exact replay.

Regret is measured against the best exact output observed across every declared fixed mode; the
larger bounded mode is a separate diagnostic, not an optimum. Thorough numerical split recorded
640 ppm p95 regret. At fast effort, numerical split beat/tied/lost greedy on 19/377/0 requests.
The report keeps path, candidate-set, replay, proposal, and iteration counters separate instead of
adding unlike work units.

## Service decision

The load generator and server ran in separate processes from clean source commit
`8babed2e2a7d1101980757777e06043eea5bc4e9`. Same-thread mode shut down before four-worker mode
started, and no prior report supplied a baseline. All 6,000 normal responses matched exact output
and fingerprint.

At concurrency 16, workers changed p95 latency from 52.44 to 26.89 ms and throughput from 425.1 to
923.3 requests/s. The cost was explicit: peak server RSS rose from 250.8 to 409.0 MiB, and maximum
event-loop delay was worse in that lane. Workers were retained because the predeclared semantic,
tail-latency, throughput, c1-overhead, admission, and memory-reporting gate passed.

At concurrency 16, the 25/50/100 ms lanes returned 192/200/200 exactly validated quotes, including
deadline incumbents, plus 8/0/0 deadline-before-plan errors and no schema/internal failures. A
52-request burst filled all 4 active and 32 queued slots; 36 accepted requests remained exact and
16 received typed 503 overload responses with `Retry-After`.

## Course correction

An earlier implementation accumulated more experiment-governance machinery than the portfolio
product justified. The project restarted from the valuable numerical runtime, kept exact routing
and differential tests, and rebuilt only the package, benchmark, service, and fixture boundary.
That choice made the financial guarantees and engineering tradeoffs easier to inspect.

## Protocol boundary and limitations

The NEAR adapter is offline and unsigned. It maps exact-input quote fields and solver event IDs but
does not authenticate, connect to a relay, inspect balances, sign, submit, execute, or settle.

The evidence uses one constant-product snapshot, synthetic request sizes, bounded two-hop/two-route
headline cases, and one local machine. It excludes gas, live state, transaction feasibility,
concentrated liquidity, and unrestricted optimality. The latency numbers are local measurements,
not production-capacity claims.
