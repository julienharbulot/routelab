# RouteLab TS: exact liquidity routing under bounded computation

## Problem

Liquidity is fragmented across pools. A direct swap can lose to a multi-hop path, and a split over
pool-disjoint routes can reduce price impact. The harder requirement is safety under bounded work:
the system must never publish an approximate or partially checked financial result.

The v0.1 model is deliberately small: immutable snapshots of two-asset constant-product pools and
exact-input requests. It is large enough to demonstrate nonlinear price impact, route interaction,
and operational limits without pretending to execute live trades.

## Exact replay is authoritative

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

## Bounded routes and splits

Route discovery enumerates simple paths under explicit hop and expansion limits. Candidate split
sets contain pool-disjoint routes, preventing two legs from silently depending on the same reserve
state. When a route has several hops, each later hop sees the reserve transition produced by the
earlier hop.

The router establishes an exact incumbent before advanced work. Candidate allocations are
nonnegative and reconstruct to the exact input total. A candidate can replace the incumbent only
after a fresh replay against the requested snapshot ID and checksum.

The public system includes:

- bounded multi-hop and pool-disjoint split discovery;
- best-single, greedy-split, and path-shadow-price allocation;
- deterministic decimal-string serialization and plan fingerprints;
- one library facade, readable CLI, local HTTP service, and fixture-only NEAR adapter;
- bounded HTTP admission with fixed workers, deadline propagation, and typed overloads.

## Greedy and numerical allocation

Greedy allocation searches an integer grid and retains the best exactly replayed plan it observes.
The numerical strategy uses path shadow prices to propose a continuous allocation, reconstructs it
to exact integers, and subjects that proposal to the same authorization replay. Approximate numbers
can suggest a better split; they never determine a published output.

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
`e7f8c1032aa29f3a9ebf1cbf4859907fe076b138`. Same-thread mode shut down before four-worker mode
started, and no prior report supplied a baseline. All 6,000 normal responses matched exact output
and fingerprint.

At concurrency 16, workers changed p95 latency from 50.51 to 20.58 ms and throughput from 439.6 to
1,098.1 requests/s. Queue-wait p95 fell from 45.12 to 13.31 ms even though quote-service p95 rose
from 4.22 to 6.70 ms. The cost was explicit: peak server RSS rose from 250.2 to 405.1 MiB, and
maximum event-loop delay was worse in that lane. Workers were retained because the predeclared
semantic, tail-latency, throughput, c1-overhead, admission, and memory-reporting gate passed.

At concurrency 16, the 25/50/100 ms lanes returned 193/200/200 exactly validated quotes, including
deadline incumbents, plus 7/0/0 deadline-before-plan errors and no schema/internal failures. A
52-request burst filled all 4 active and 32 queued slots; 36 accepted requests remained exact and
16 received typed 503 overload responses with `Retry-After`.

## Course correction

An earlier implementation accumulated more experiment-governance machinery than the portfolio
product justified. The project restarted from the valuable numerical runtime, kept exact routing
and differential tests, and rebuilt only the package, benchmark, service, and fixture boundary.
That choice made the financial guarantees and engineering tradeoffs easier to inspect.

This was a product decision, not an attempt to hide history: delete process that did not protect a
user, preserve the exact financial core, and retain only evidence needed to explain quality and
service tradeoffs.

## Unsigned NEAR boundary

The NEAR adapter is offline and unsigned. The public exact-input parser follows the documented
Message Bus fields and normalizes an omitted `min_deadline_ms` to 60,000 ms. The solver-event path
requires and preserves `quote_id`, but its output remains a RouteLab-specific draft.

An official response requires signed protocol data. RouteLab does not fabricate a quote hash,
nonce, signature, public key, or claim that the draft can be submitted. It does not authenticate,
connect to a relay, inspect balances, sign, execute, or settle.

## Limitations

The evidence uses one constant-product snapshot, synthetic request sizes, bounded two-hop/two-route
headline cases, and one local machine. It excludes gas, live state, transaction feasibility,
concentrated liquidity, and unrestricted optimality. The latency numbers are local measurements,
not production-capacity claims.

The larger-budget profile is only another bounded comparison mode. The 396 requests cover one
snapshot-derived Cartesian corpus rather than historical orders. Worker results use four fixed
workers on one machine and should be remeasured for any deployment target.
