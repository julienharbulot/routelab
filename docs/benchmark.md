# RouteLab TS portfolio benchmark specification

## Purpose

The benchmark answers three separate questions:

1. **Quality:** How much exact output does each strategy return on fixed inputs?
2. **Cost:** How much deterministic work is required?
3. **Operation:** What latency and throughput does the local service show?

Do not merge these into one opaque experiment.

## Inputs

### Default portfolio set

Create a small, reviewed case set with approximately 20–30 requests. It should include:

- direct route is best;
- two-hop beats direct;
- split beats single;
- high-fee path loses;
- shallow direct liquidity;
- large input where price impact matters;
- tiny integer/rounding case;
- no-route case;
- several requests from the retained historical snapshot.

Every case names its purpose.

### Extended set

The existing retained synthetic request corpus may be used by:

```bash
pnpm benchmark:extended
```

It is not the default CI benchmark and is not described as representative demand.

## Strategies

Benchmark:

```text
best-single
greedy-split
numerical-split
long-budget numerical reference
```

The long-budget result is a practical reference over the same discovered candidate restrictions. It is not a global optimum.

## Work profiles

Use frozen named profiles:

```text
fast
balanced
thorough
reference
```

For deterministic quality comparison, the exact work caps are authoritative.

Wall-clock deadlines may be measured separately, but they must not change the input or semantic configuration being compared.

## Lane A — deterministic quality

For each case, strategy, and profile record:

- exact input/output;
- route count;
- hop count;
- improvement over best single;
- regret in basis points against the long-budget reference;
- termination reason;
- deterministic work counters;
- numerical proposal count;
- numerical iteration count;
- convergence status;
- exact authorization rejection count;
- semantic fingerprint.

Use integer or rational calculations for regret where practical. Do not route exact amounts through `number`.

Required aggregate views:

- median and worst regret;
- frequency of split improvement;
- frequency numerical beats/ties/loses greedy;
- exact rejection rate;
- work by profile.

## Lane B — in-process latency

Use `process.hrtime.bigint()`.

For every reported strategy/profile combination:

- perform at least 10 warmups;
- perform at least 100 measured invocations;
- rotate through the case set to avoid reporting one trivial request;
- record p50, p95, p99, minimum, maximum, and throughput;
- record Node version, OS, CPU description, and commit.

Do not call 10 or 20 samples a p99.

Raw per-invocation observations go to an ignored path such as:

```text
reports/raw/portfolio-v1-observations.json
```

The committed summary remains below 1 MB.

## Lane C — HTTP load

Start the actual local server and send requests over localhost.

Test concurrency:

```text
1
4
16
```

For each level record:

- total requests;
- completed/failed/timed out;
- p50/p95/p99 end-to-end latency;
- requests per second;
- deadline-completion rate;
- event-loop delay;
- peak RSS or memory delta.

Use the same request mix and server configuration for all concurrency levels.

## Quality-versus-time chart

The chart uses:

- x-axis: measured median elapsed time for a fixed deterministic profile;
- y-axis: exact output quality or median regret;
- one line/series per strategy.

The semantic output comes from deterministic profile runs. Timing is an observation of those same profiles, not a control that changes them.

## Output files

Commit:

```text
reports/portfolio-v1.md
reports/portfolio-v1.json
reports/quality-vs-budget.svg
reports/load-v1.md
```

Ignore:

```text
reports/raw/**
reports/tmp/**
```

The Markdown report starts with:

1. one paragraph conclusion;
2. one quality table;
3. one latency table;
4. one load table;
5. the chart;
6. limitations;
7. methodology.

## Verification

`pnpm benchmark:verify` must check:

- every case uses the expected snapshot;
- exact amounts are canonical decimal strings;
- allocations sum to exact input;
- success quotes replay exactly;
- semantic fingerprints are stable;
- aggregate counts reconcile with per-case rows;
- percentile sample counts are sufficient;
- committed summary configuration matches the runner configuration;
- no raw observation file is committed.

## Interpretation rules

Allowed:

- “On this retained case set…”
- “Under the documented machine and profile…”
- “The numerical strategy improved/tied/lost in N cases…”
- “At concurrency 16, measured p99 was…”

Not allowed:

- “Globally optimal.”
- “Production ready.”
- “Representative of market order flow.”
- “Low latency at scale” without context.
- “Statistically significant” without a suitable design.
- “PRIME-accelerated” or “learning-augmented.”

## Current evidence

The committed [portfolio summary](../reports/portfolio-v1.md) and
[same-thread HTTP load report](../reports/load-v1.md) are local v0.1 evidence generated by the
commands in this document. Raw observations remain ignored.
