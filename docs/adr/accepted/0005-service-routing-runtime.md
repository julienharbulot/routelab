# ADR 0005: Add a bounded service policy over one routing session

- **Status:** Accepted
- **Date:** 2026-07-14
- **Scope:** Milestone 7c reference consolidation and additive service runtime

## Context

RouteLab has two supported synchronous routing entries. The composed exact entry
is frozen by ADR 0001 and the additive numerical entry is frozen by ADR 0004.
Both produce exact-authorized incumbents and deterministic cap-driven evidence,
but they separately implement the same baseline orchestration.

Those entries are evidence runtimes, not service runtimes. In particular:

- each validates the request and control, fully materializes every eligible direct
  route, and exact-replays every direct candidate before its first callback or
  clock sample;
- the numerical entry completes path discovery, best-single work, candidate-set
  discovery, every equal proposal, every greedy option, and baseline authorization
  before numerical work can begin; and
- one numerical iteration contains every route's fixed inner bisection, while its
  final all-route sample and reconstruction are not separately metered.

Those choices remain correct under their accepted contracts. Reinterpreting them
in place would invalidate counters, diagnostics, canonical bytes, hashes, retained
profiles, and forced-stop evidence. They also cannot satisfy the later service
gate: direct work must be bounded and deadline-visible, numerical work must not be
structurally hidden behind the complete greedy reference pipeline, and no service
work label may conceal a caller-amplifiable route-by-inner-loop operation.

A synchronous cooperative deadline can bound work only at explicit router
boundaries. It cannot interrupt an in-progress JavaScript action, cancel a blocked
event loop, include transport or queueing by itself, or prove an HTTP response SLA.
Milestone 8 therefore remains responsible for parsing, admission, concurrency,
event-loop, cancellation, worker, and end-to-end evidence.

The retained numerical profiles also require a deliberate follow-up. The
project-controlled shadow-price core leads nine of twelve supported profiles, but
the current reference driver records many non-convergences and residual-option
exhaustions. That evidence permits a frozen service-only experiment; it does not
permit changing the reference driver or letting approximate state authorize a
plan.

## Decision

### Three policies and closed reference surfaces

The two existing entries are named policies over the future shared engine:

- `reference-v1` is `routeExactInputSplitAnytime`;
- `numerical-reference-v1` is
  `routeExactInputSplitNumericalAnytime` and its existing replay/proposal-driver
  test seams; and
- `service-v2` is the additive bounded service policy defined here.

`reference-v1` and `numerical-reference-v1` remain supported source-module
compatibility surfaces. Their current public declarations, observable behavior,
and evidence are closed. Extraction through a common engine must preserve all of
the following:

1. request field capture, getter access, validation, and error precedence;
2. control, cap, callback, deadline, and numerical-configuration capture order;
3. mandatory fully materialized uncapped direct enumeration and replay before the
   first reference callback or clock sample;
4. canonical route discovery, candidate-set prefixes, stage order, proposal
   deduplication/order, and strict objective replacement;
5. per-kind cap semantics, callback-before-clock boundary precedence, cumulative
   counters, checkpoints, and termination;
6. exact replay rejection counts, numerical candidate diagnostics, failure codes,
   proposal-driver behavior, and authorization-replay behavior;
7. the numerical outer update as one charged reference unit, including all
   route-by-inner-iteration work, plus its uncharged final sample and reconstruction;
8. result unions, reason strings, field paths, deep freezing, defensive capture,
   and absence of caller aliases; and
9. every canonical split-v1 value, byte, hash, fixture, verifier, and legacy
   single-path value.

More specifically, reference request capture reads the eight inherited fields in
their accepted order. Numerical-reference capture then reads `numerical`,
`outerIterations`, `innerIterations`, and `convergenceTolerance` once; inherited
validation still has the accepted error precedence. Reference control capture
reads `workCaps`, the six baseline caps in their accepted order, then the callback
and deadline fields. Numerical-reference inserts its four numerical cap fields in
the accepted position before callback and deadline capture. Existing tests are the
executable access-order evidence and cannot be weakened to make extraction pass.

No service type is added to `routelab.split-router-run.v1` or
`routelab.split-router-case.v1`. Service outcomes driven by clocks or cancellation
are operational and are never projected into those schemas.

### One policy-neutral session, not one observable work model

RLT-085 will route all three policies through one internal routing-session engine.
Each policy keeps a separate entry adapter that owns its exact property capture,
validation, and error projection. The shared session begins only after that adapter
has produced captured immutable values; it never reads a caller-owned reference
request/control object on behalf of every policy. The engine owns exactly one
captured snapshot capability and request, deterministic
frontiers, exact incumbent, cumulative ledger, control state, proposal state,
diagnostics, and exact-authorization path for a request. No wrapper may retain a
second baseline orchestration or call another public router as a nested stage.

The engine exposes lower-level state transitions. A policy determines:

- which transition is eligible next;
- which transitions form one observable and billable unit for that policy;
- when a control boundary occurs;
- which cap closes a lane or the request;
- the deterministic schedule among eligible lanes; and
- how shared state projects into the policy's result type.

This distinction is required for compatibility. Reference-v1 groups all direct
transitions before controls, and numerical-reference-v1 groups a complete outer
update as one numerical unit. Service-v2 exposes finer bounded units. Sharing the
session does not make the policies share counters, work-kind unions, boundary
precedence, results, or canonical schemas.

The session alone may install an incumbent. A policy or proposal driver may ask
for an exact replay, but it cannot directly publish a receipt or mutate the
incumbent. Replacement uses the complete accepted split objective and remains
strictly monotonic.

The numerical-reference injection seams remain exact compatibility evidence:
`routeExactInputSplitNumericalAnytimeWithAuthorizationReplay` may replace only the
numerical authorization replay, while baseline authorization and numerical
residual scoring remain prepared exact replays;
`routeExactInputSplitNumericalAnytimeWithProposalDriver` may replace only
`prepare`, `advance`, and `finalize`, while every replay remains real. Their
signatures, phase limits, trusted-dependency assumptions, failure projections, and
source-module exports do not change during extraction.

### Opaque service-prepared capability

Service-v2 uses a separately branded `PreparedServiceRoutingContext`. A
service-specific publication factory mints it from raw snapshot input, a captured
server publication/runtime policy, and captured server dependencies. The factory
first performs a bounded structural preflight over the closed raw shape: it rejects
an oversized pool array, identifier, or exact-decimal string before iterating or
constructing a `bigint`. Only then may it call the accepted snapshot parser,
checksum verifier, defensive capture, adjacency construction, and pair-index
builder. The resulting capability contains or owns the same verified prepared
state used by the shared session.

An arbitrary existing `PreparedRoutingContext` cannot be upgraded into a service
capability, because it may have been parsed, copied, hashed, or indexed without the
service publication bounds. A forged handle or a handle/control from another
context is a typed invalid context; it never falls back to caller-provided snapshot
state.

Service preparation occurs when a snapshot is published, outside a per-request
service-runtime deadline. It must nevertheless be finite and policy-validated. Its
preflight and verified capture freeze at least these dimensions:

- snapshot pool count and distinct asset count;
- snapshot, pool, and asset identifier code-unit lengths;
- reserve, fee numerator, and fee denominator bit lengths;
- adjacency bucket size and the total number of directional edges; and
- the snapshot identity and checksum already established by preparation.

After those checks, service preparation may build a deterministic raw-UTF-16 pair
index from `(assetIn, assetOut)` to frozen canonical one-hop routes. That index is
part of the immutable snapshot capability. Looking up a pair and creating a cursor
must not scan an adjacency bucket or filter/materialize all matches per request.
No request-specific route result, incumbent, frontier, allocation, or diagnostic
is cached across requests.

Publication work is not disguised request work: Milestone 8 must report cold and
warm preparation separately. Conversely, per-request pair lookup, cursor advance,
candidate replay, discovery, proposal, and authorization are service work even
though their immutable indexes were prepared earlier.

### Server-owned resource policy

The service resource policy is configuration supplied by trusted server setup,
captured once into the opaque service context, and rejected unless every value is
a finite nonnegative or positive safe integer as applicable. Future wire callers
cannot supply or override it. The integrated service policy must give explicit
finite values for every field before service-v2 is enabled.

The policy contains, at minimum, these independent bounds:

| Group | Required bounds |
|---|---|
| Publication | pools, distinct assets, directional edges, adjacency degree, identifier code units, reserve bits, fee bits |
| Intent | amount decimal digits at a wire boundary, amount bits in the core, optional snapshot-ID length |
| Route shape | maximum hops per route, routes per split, replay legs, and total hops per replay |
| Direct | direct candidates inspected and direct exact replays |
| Discovery | path expansions, completed paths retained, candidate-set expansions, and candidate sets retained |
| Exact baseline | best-single replays, equal proposal replays, greedy parts, greedy option replays, and baseline authorization replays |
| Numerical | proposals, model-route steps, outer updates, route-share steps, reconstruction steps, residual option replays, and numerical authorization replays |
| Repair | activation probes and exact neighborhood/repair replays |
| Output | diagnostics, route keys, debug records, and serialized response size |

Bounds remain heterogeneous. A path expansion, binary64 share step, and exact
replay are not assigned an exchange rate or claimed to have equal cost. The policy
may also impose a total transition cardinality as a safety ceiling, but such a
ceiling is not a cost model and is not used in exact objective comparison or
performance claims.

Every loop or collection whose size can affect one request is controlled by one
or more of those captured bounds. A policy cannot omit a dimension because another
dimension usually correlates with it. Every exact policy configuration has a
stable `policyId`; changing a ceiling, schedule, proposal driver, or debug
projection creates a new ID and requires contract/test review before observations.

### Initial `service-policy-v1` ceilings

The first implementation uses these conservative ceilings. They are resource and
fixture limits, not measured latency, throughput, safety, or production claims.

| Dimension | `service-policy-v1` ceiling |
|---|---:|
| Raw publication bytes / canonical snapshot bytes | 1,048,576 / 1,048,576 |
| Raw snapshot root members / pool members / container depth | exactly 3 / exactly 7 / 3 |
| Published snapshots in one future registry | 16 |
| Pools / distinct assets / directional edges | 512 / 128 / 1,024 |
| Outbound degree / direct routes per ordered pair | 512 / 256 |
| Identifier length | 128 UTF-16 code units and 256 UTF-8 bytes |
| Reserve or fee decimal digits / bits | 78 / 256 |
| Raw request body / members / nesting depth | 2,048 bytes / 6 / one top-level object |
| Request amount decimal digits / bits | 78 / 256 |
| Hops per route / routes per split / total replay hops | 4 / 4 / 16 |
| Initial direct tranche / total direct inspections / replays | 8 / 256 / 256 |
| Path expansions / retained complete paths / best-single replays | 8,192 / 256 / 256 |
| Candidate-frontier primitive steps / retained sets | 8,192 / 128 |
| Equal proposal replays / retained proposal records | 128 / 128 |
| Greedy parts / greedy option replays | 16 / 2,048 |
| Baseline authorization replays | 128 |
| Numerical proposals / model-route steps | 4 / 16 |
| Outer updates / inner share updates per route/sample | 64 / 64 |
| Numerical convergence tolerance | exactly `2 ** -40` in binary64 |
| Total numerical share microsteps / reconstruction route-pass steps | 68,640 / 48 |
| Numerical residual option / authorization replays | 64 / 4 |
| Activation probes / exact repair neighbors | 32 / 32 |
| Mandatory scalar numerical diagnostics / one optional encoded route or candidate key | 4 / 16,384 bytes |
| Debug projection / encoded response | 65,536 / 65,536 bytes |
| Aggregate service transitions | 100,000 |

The initial proposer is the existing strict reference shadow-price driver with
exactly 64 outer updates, 64 inner updates, and binary64 tolerance `2 ** -40`.
Until RLT-087 accepts a different experiment result, finite non-convergence is
diagnostic-only and cannot produce a proposal. Selecting a different driver,
iteration pair, tolerance, or finite-non-convergence rule creates a different
service policy ID.

Snapshot checksums admitted by this policy use exactly lowercase
`sha256:` followed by 64 hexadecimal digits. Service-publication and wire
identifiers must be well-formed Unicode strings, contain no C0 or DEL control code
point, and stay within both encoded limits. They remain opaque, case-sensitive,
untrimmed, unnormalized, and ordered by raw UTF-16 code units. This is an additive
service-domain restriction; reference-v1 keeps the broader accepted identifier
contract.

The pair index is a nested immutable mapping
`assetIn -> assetOut -> frozen canonical route list`, never a concatenated string
key. The total number of stored routes across all leaf lists equals the published
directional-edge count; repeated ordered pairs share one leaf list. Each list uses
the existing raw-UTF-16 directional-route order. A cursor creation performs one
bounded nested lookup and an advance returns at most one existing frozen route.
The capability is bound to `(snapshotId, snapshotChecksum, policyId)`, and a
future registry cannot replace one snapshot ID with different financial content
in place.

### Service request and later wire boundary

The service intent has exactly these semantic values:

```ts
interface ServiceExactInputIntentValue {
  readonly snapshotId?: string;
  readonly assetIn: string;
  readonly assetOut: string;
  readonly amountIn: bigint;
}
```

The routing engine does not accept that ordinary object. Trusted boundary code
validates and copies the four values into a separately branded opaque
`CapturedServiceIntent` bound to the prepared service context. Intent capture
accepts primitive arguments or a strict decoder-owned plain record; no getter,
Proxy, accessor, callback, function, or caller collection remains reachable from
the synchronous router. A forged or cross-context intent is invalid context.

Intent capture validates the fields in the displayed order before routing entry:
a supported snapshot hint; nonempty distinct identifiers within both policy
lengths and the service Unicode restriction; a positive `bigint` input within the
policy bit limit; and known assets. Failures return typed `invalid-request` and do
not sample the routing clock. Consequently an invalid intent has precedence over
an expired control, while an already-expired valid captured intent has the
entry-deadline behavior below.

The prepared service context selects the exact snapshot checksum and all route,
allocation, numerical, work, diagnostic, and repair configuration. The optional
snapshot ID is only a bounded supported-snapshot hint and must match that context
when present. There is no request checksum, hop limit, route limit, greedy part
count, iteration count, tolerance, proposal-driver selector, work cap, seed, or
debug-size field in the routing intent.

Milestone 8's wire parser must enforce the 2 KiB body limit before decoding and
use a closed six-member, one-level object shape. It rejects duplicate or unknown
members before ordinary object materialization. `amountIn` uses
`[1-9][0-9]*`; its digit length is checked before `bigint` parsing, and a JSON
number is invalid. String UTF-8 bytes, UTF-16 code units, well-formedness, and
controls are checked before lookup. An optional `deadlineMilliseconds` hint is one
of `1`, `5`, `10`, `25`, `50`, or `100`; the server may shorten or reject it and
creates the absolute monotonic deadline. An optional boolean `debug` selects only
the bounded projection. The other fields are `assetIn`, `assetOut`, and optional
`snapshotId`. No checksum or algorithm/resource field is accepted.

The same bounded decoder rule applies to raw snapshot publication before exact-
decimal parsing. It enforces raw and canonical byte limits, object/array/member
counts, schema closure, duplicate-member rejection, string encoded limits, and
decimal lengths before `BigInt`, copying, hashing, or adjacency construction.
Debug output cannot expose raw snapshot state, mutable aliases, controls, proposal
internals, or unbounded diagnostics.

### Opaque control and earliest service entry sample

Service-v2 receives an opaque request control minted by trusted server code for
the same prepared service context. It contains a validated nonnegative absolute
deadline in the context's clock domain and, optionally, a captured cooperative
cancellation check. Wire callers never provide an absolute timestamp or function.
The minting boundary returns `invalid-control` when those primitive values or the
trusted cancellation dependency shape are invalid, before an opaque control or
routing session exists. At router entry, a missing brand, forged handle, wrong
context binding, or policy mismatch is instead `invalid-context`; the router never
reclassifies such an identity failure as `invalid-control`.

At service routing entry, precedence is:

1. validate the context, intent, and control capability identities and their
   already captured primitive deadline without invoking caller code or traversing
   snapshot state;
2. sample the captured monotonic clock before reading captured intent state,
   creating a route frontier, looking up a direct pair, replaying, or constructing
   a proposal;
3. classify a throwing, non-`bigint`, negative, or otherwise invalid sample as a
   typed dependency error with no incumbent and zero work counters;
4. classify `sample >= absoluteDeadline` as `no-plan` /
   `deadline-at-entry`, with no captured intent read and zero direct, structural,
   replay, proposal, repair, and authorization actions; and
5. only then read the already owned bounded intent and initialize the session.

Invalid intent capture has already returned `invalid-request` before this routing
entry. An already-expired valid opaque control therefore cannot race raw request
validation. A forged or cross-context context/intent/control identity has
precedence over the clock because there is no trusted clock domain to sample.
These rules are service-v2 only and do not alter reference validation or deadline
precedence.

The entry sample is stored as the first monotonic sample. At every later pending
service unit the policy performs, in order:

1. determine bounded unit availability or stage completion without an unmetered
   collection scan;
2. apply the deterministic per-kind cap;
3. invoke the optional server-owned cancellation check and validate its boolean
   result;
4. sample and validate the clock, reject regression, and stop on equality or
   expiration; and
5. execute and account the unit atomically.

A cap therefore precedes operational observations for that pending unit, and
cancellation suppresses the later clock sample exactly as in the reference
boundary protocol. The entry sample remains a special service-only boundary and
occurs before any cancellation observation. A completed lane does not invoke
cancellation or sample the clock merely to discover that it has no unit. A
clock/cancellation failure is a typed dependency error, executes and charges no
pending unit, and preserves the prior exact incumbent. The cancellation check must
be a bounded process-local observation; a same-thread callback does not prove that
an HTTP disconnect can interrupt synchronous work.

### Bounded service action catalogue

Every service-v2 action has a stop boundary and a maximum derived only from the
captured policy and published snapshot. The minimum catalogue is:

| Action family | One service action | Maximum-cost dimensions |
|---|---|---|
| Direct | advance one prepared pair cursor and exact-replay at most one one-hop candidate | one hop; bounded identifier, reserve, fee, and amount bits |
| Path discovery | advance exactly one adjacency edge/frontier transition and emit at most one already-canonical complete path | bounded hops, degree, identifiers, retained paths |
| Best single | exact-replay one complete route | bounded hops and exact-value bits |
| Candidate set | perform exactly one frame/anchor transition or one route-compatibility trial, with at most `maxRoutes` stack cleanup operations, and emit at most one set | bounded retained paths, routes, and hops; no retained-path scan |
| Equal | reconstruct one bounded equal allocation and exact-score at most one set | bounded routes, hops, amount bits |
| Greedy | exact-score one route option for one already materialized chunk step | bounded parts, routes, hops, amount bits |
| Baseline authorization | fresh exact-replay one complete proposed split | bounded legs, total hops, exact-value bits |
| Numerical model | construct/reduce/normalize at most one route model | bounded hops and coefficient bit growth derived from reserve, fee, amount, and hop bounds |
| Numerical share | advance exactly one endpoint/finalization transition or one inner bisection update for one route in one outer/final sample | constant binary64 operations; bounded routes, outer updates, and share steps |
| Numerical reconstruction | decode or reconstruct at most one route weight/allocation in one required pass | bounded routes, weight shifts, and amount bits |
| Residual/repair | exact-score one route option, activation probe, or repair neighbor | bounded routes, hops, neighborhood, and exact-value bits |
| Numerical authorization | fresh exact-replay one complete reconstructed split | bounded legs, total hops, exact-value bits |
| Bookkeeping | compare/retain at most one bounded proposal or append at most one bounded semantic diagnostic fragment | bounded records, routes, hops, identifier bytes, and key bytes |
| Terminal projection | freeze/copy one bounded result projection before return | bounded retained records, route keys, diagnostics, and result bytes |

Availability normalization is either constant work or part of the next charged
structural transition. It may not pop, sort, filter, copy, stringify, or scan a
request-scale collection for free. Sorting is avoided in the service request path
by consuming prepared canonical indexes and append-only canonical frontier output.
Service proposal selection maintains an incremental canonical best/seen state and
does not copy and sort a whole proposal map. Route/candidate keys and diagnostics
are constructed and retained incrementally within their key, record, and byte
ceilings. Terminal projection is a pending bounded action with the normal service
boundary; transport serialization remains outside the router deadline and has its
own response-byte ceiling.

An exact replay remains atomic and contains no internal cooperative deadline check.
Its cooperative overshoot is therefore at most one replay whose legs, hops,
identifier lengths, and bigint operand growth are all policy-bounded. The same
rule applies to one route-model reduction: Euclidean and bigint operation cost is
bounded through operand bit lengths and hops. An implementation that groups all
routes or all inner iterations behind either label violates this decision.

Service counters remain distinct by action family, and replay rejection counters
remain distinct from replay attempts. A cap reached before an action does not
increment its counter. A failed atomic replay or numerical action is charged once
when it was permitted and begun, but it exposes no partial receipt, allocation,
weight, or incumbent.

Optional debug projection truncation does not affect feasibility or turn a
complete `no-route` into `no-plan`. Search-affecting semantic diagnostics are
bounded by the numerical-proposal cap so an attempted candidate always retains its
required terminal diagnostic. Reaching a proposal/diagnostic lane cap can close
that lane and record `work-limit`; merely omitting optional debug fragments cannot.
The mandatory service diagnostic identity is a lowercase `sha256:` digest of the
exact UTF-8 bytes of the numerical-reference key encoding frozen above and,
separately, each route key. A route key is compact JSON for an array of hops, each
hop exactly `[assetIn,poolId,assetOut]`; a candidate-set key is compact JSON for
the ordered array of those route arrays. It uses the existing exact JSON string
escaping and contains no whitespace. Its status, failure, convergence, residual,
and attributable counters are mandatory bounded scalar fields. Full keys are
optional debug fragments and are omitted or truncated to keep the complete
projection within its byte cap. Digests and debug keys are observational only:
proposal deduplication and tie-breaking retain exact internal keys, and neither
representation authorizes an incumbent.

### Deterministic non-starving service schedule

Service-v2 uses canonical frontiers and the complete accepted exact objective, but
it does not copy reference stage order. Its deterministic schedule is:

1. advance at most the eight-action initial direct tranche, stopping it early on
   the first valid exact incumbent or natural direct-frontier exhaustion;
2. advance path discovery incrementally and exact-replay each emitted complete
   path as a best-single candidate until an incumbent and the first canonical
   pool-disjoint model-eligible set exist, or the applicable lanes close;
3. for that first set, attempt its cheap equal proposal and distinct exact
   authorization when better;
4. before any greedy option and before processing another set's equal proposal,
   give that set one numerical proposal lane through a terminal
   `improved`, `not-better`, or typed `failed` diagnostic, unless a numerical cap,
   deadline, cancellation, or dependency error stops it; and
5. continue deterministic round-robin refinement over remaining direct candidates,
   path/set frontier output, equal/numerical attempts, and finally optional greedy
   work while controls permit.

A model-eligible set is a canonical cardinality-two-or-more pool-disjoint set whose
routes resolve into the bounded service numerical model, for an input of at least
`2n` so some exact two-leg support is possible. It does not require a successful
equal replay; making activation success a prerequisite would recreate starvation.
Numerical work also requires an existing exact incumbent; approximate work never
creates the fallback. If the initial direct tranche finds none, discovery proceeds
anyway and a freshly replayed best-single route may supply that fallback before
numerical work begins. Remaining direct candidates are revisited in refinement up
to the total direct cap.

The path frontier emits canonical append-only paths. The candidate-set frontier
consumes that growing canonical sequence without rediscovery, reordering, or
recharging prior expansions; anchored prefix behavior remains deterministic when a
later path is appended. Each candidate set is attempted at most once per proposal
family. A cap may close one lane and allow other work based on fully materialized
state to continue, while recording overall `work-limit`. Deadline, cancellation,
or dependency error stops the whole request.

The non-starvation guarantee is structural, not a latency promise: when the first
eligible set and exact fallback exist and numerical caps permit one proposal, no
complete greedy pipeline or later equal set is a prerequisite to that proposal.
A deadline may still expire before it, and an earlier bounded exact action may
consume measurable time. Tight-budget fixtures must distinguish those cases.

### Service result and completion taxonomy

Service-v2 owns additive result types. They do not widen either reference result.
The result classes are exhaustive and non-overlapping:

- `success` contains a fully exact-authorized incumbent and a search summary. Its
  termination may be `complete`, `work-limit`, `deadline`, or `interrupted`;
- `no-plan` contains no incumbent and is used only when `work-limit`,
  `deadline-at-entry`, `deadline-before-plan`, or `interrupted` stops before exact
  authorization. Entry expiry and a later deadline are distinct reason variants;
- `no-route` is used only with `complete` after every frontier in the accepted
  server-bounded search domain is naturally exhausted. Its reason distinguishes no
  structural candidate from candidates whose exact replays all rejected;
- `invalid-request` reports bounded intent validation and performs no route action;
- `invalid-control` reports mint-time rejection of the primitive absolute deadline
  or trusted cancellation-dependency shape, before an opaque control exists, and
  performs no route action;
- `invalid-context` reports a forged, unpublished, policy-invalid, or mismatched
  service capability, intent, or control brand/binding at router entry before a
  trusted request session exists; and
- `dependency-error` reports clock or cancellation throw/type/regression failure,
  includes phase `entry` or `action`, includes the prior exact incumbent or `null`,
  and carries a matching operational termination. It remains an error status even
  when that separate incumbent is non-null; and
- `state-error` reports an impossible session/frontier/action invariant, exposes no
  partial action, and retains any prior exact incumbent separately rather than
  converting the bug to success.

Reaching a direct, discovery, replay, proposal, repair, semantic-diagnostic, or
aggregate transition cap before natural exhaustion prevents `no-route`, even if
later eligible lanes run. With no incumbent the final status is `no-plan` /
`work-limit`; with an incumbent it is `success` / `work-limit`. Policy hop/route
constraints define the accepted search domain, but exhausting a work cap is not
proof that domain has no route. Truncating optional debug or response projection
does not change search completeness.

All returned exact receipts remain bound to the service context's snapshot ID and
checksum. Results and nested values are fresh and deeply frozen. Debug/timing
observations cannot affect result objective, tie-breaking, exact authorization, or
determinism hashes.

### Exact proposal, repair, and authorization boundary

Direct and best-single fresh replays are authorizing candidates under the accepted
objective. Equal, greedy, numerical, activation, non-convergence, and neighborhood
outputs are proposals or scores. A proposed incumbent replacement always requires
a distinct, metered, fresh full-input exact replay against the prepared snapshot.
The authorization receipt must recursively agree with the proposed exact
allocation/output and remain strictly better than the current incumbent.

Every reconstructed service allocation is `bigint`, nonnegative, omits zero legs,
and sums exactly to the requested input. Every exact replay uses latest per-route
pool transitions and preserves snapshot immutability. Any invalid model, nonfinite
value, failed reconstruction, exhausted option set, replay rejection, mismatch,
cap, deadline, cancellation, or dependency failure preserves the last exact
incumbent.

A finite non-converged shadow-price sample is still approximate. The only sample
eligible for the first service experiment is the final sample recomputed after the
configured last completed outer update, in the same operation order as ADR 0004
finalization. The experiment cannot choose between that sample and an earlier
sample after seeing replay output. A service-only variant may expose it for exact
reconstruction and scoring only when every weight is finite, nonnegative,
normal-or-positive-zero, and within the existing domain. It must retain
`converged: false` and a distinct diagnostic. Nonfinite/domain failure remains
unreplayable. Exact replay of a finite proposal does not retroactively make the
numerical model converged.

Activation-aware or bounded-neighborhood repair may use only metered exact option
replays. It may remove zero-output supports, test exact activation thresholds, or
move bounded whole units among canonical routes according to a preregistered rule.
It cannot use an approximate output as a score, leave input unallocated, scan an
unbounded neighborhood, or bypass distinct authorization.

An activation threshold is obtained only by a separately reviewed exact closed-
form derivation or by one exact replay probe per service action under the 32-probe
cap; the first experiment uses the replay-probe path unless its freeze packet
accepts such a derivation before outputs. Every neighbor is generated in canonical
order as a nonnegative exact-sum allocation before replay. A partially scanned
probe or neighborhood is discarded as a proposal while completed attempt/rejection
counters remain truthful.

### Frozen service-fast experiment boundary

RLT-087 must freeze its complete experiment packet before observing any new
numerical output or timing. It compares identical ordered inputs and at least:

1. the immutable 64-outer by 64-inner reference driver;
2. lower fixed iteration pairs;
3. a pinned-runtime square-root share calculation where its operation order can be
   specified; and
4. a deterministic fixed-iteration alternative if it can satisfy the same finite
   domain and exact reconstruction boundary.

It separately crosses strict non-convergence rejection with safe finite-proposal
replay, and current reconstruction with a frozen activation-aware or bounded exact
repair. The packet fixes cohort IDs and hashes, configurations, environment,
warmup/sample order, action caps, failure taxonomy, exact output/regret, time to
first and best improvement, elapsed observations, deadline success, counters,
diagnostics, and a mechanical keep/reject rule. Exact outputs are compared only
within one request/asset pair; timings never authorize a result.

The existing RLT-080/RLT-081 artifacts, their populations, and their selection
rules remain immutable. The new experiment may select one service proposal policy
or retain the reference proposal path. A negative result is complete evidence. No
variant becomes reference-v1, a default package mode, or a performance claim from
this experiment.

### Required reference-parity evidence

Reference extraction must preserve behavior that is deliberately unmetered between
its existing boundaries: path/set availability normalization, path/set prefix
materialization, canonical path sorting, equal-leg construction, greedy chunk
creation, proposal-key construction/deduplication/best-first sorting, numerical
route resolution/model preparation, and final numerical sampling/reconstruction.
RLT-085 may refactor those operations, but it may not add a reference observation,
change a charged unit, or project a new counter. Service-v2 uses the separately
bounded alternatives above.

Before the shared core can integrate, independent evidence covers this matrix:

| Surface | Required parity proof |
|---|---|
| Type and source API | Existing exported names, unions, signatures, field paths, and numerical injection seams typecheck unchanged |
| Access precedence | Adversarial getters/proxies reproduce the exact eight-field request, six/ten-cap control, nested numerical, callback, and deadline access order/count/error |
| Direct establishment | Zero caps, expired reference deadline, callback true/throw, many directs, rejection, and raw UTF-16 order retain all direct work before observation |
| Structural schedule | Independent path/set ledgers match at zero, partial, and natural caps; anchored set prefixes remain append-stable |
| Exact baseline | Direct/best/equal/greedy math, rejection counts, proposal uniqueness/order, and distinct authorization match independent expectations |
| Boundary trace | Every occurrence of every work kind can be stopped with the exact pre-unit checkpoint, incumbent, counter, and callback-before-clock priority |
| Cap semantics | Zero-through-natural exhaustion and componentwise cap increases retain stage continuation, completion, and objective monotonicity |
| Result lattice | Candidate/no-candidate/all-rejected and cap/interruption/deadline/callback/clock outcomes match with and without an incumbent |
| Numerical baseline | The numerical wrapper reproduces all inherited reference stages and counters once, without rediscovery/recharge |
| Numerical tail | RT00–RT13, all four caps, diagnostics, residual exhaustion, non-convergence, and authorization reject/mismatch remain exact |
| Ownership/determinism | Pool permutations, huge integers, caller mutation, reentrancy, freshness, deep freezing, and no aliases remain exact |
| Canonical evidence | Both split-v1 fixture bytes/hashes, strict parser/replay precedence, and all legacy single-path hashes remain unchanged |
| Retained evaluations | Historical and representative semantic verifiers pass without regenerating or reinterpreting elapsed observations |

Numerical-reference caps retain their special accepted behavior: any numerical cap
ends the numerical tail immediately with `work-limit`; the current candidate gets
one stopped diagnostic with its completed attributable state, and unseen candidate
sets emit none. No exact incumbent means no numerical proposal or diagnostic.

### Determinism, evidence, and implementation order

Service-v2 is deterministic under an explicit server policy and deterministic
work stops. Canonical iteration, raw UTF-16 ordering, and exact tie-breaking remain
mandatory. A cap-driven service run may receive a later additive semantic schema,
but this ADR creates none. Deadline-, cancellation-, dependency-, load-, and
transport-driven observations remain operational and have no determinism hash.

Implementation order is fixed:

1. RLT-085 extracts the shared session and proves full reference and numerical-
   reference parity before enabling service behavior;
2. RLT-086 adds service preparation, entry sampling, bounded actions, result types,
   and the non-starving schedule with independent forced-stop evidence;
3. RLT-087 freezes and retains the service-fast numerical/repair experiment before
   integrating any selected variant;
4. RLT-088 integrates the selected policy or explicit reference fallback and runs
   the complete service/export evidence; and
5. RLT-089 independently maps every Milestone 7c gate clause and must state
   `MILESTONE COMPLETE` before Milestone 8 is eligible.

## Consequences

- Existing callers, canonical artifacts, and retained profiles keep their exact
  accepted meaning while duplicated orchestration can be removed.
- Service-v2 has a true entry sample and bounded direct work, but its guarantee is
  cooperative router work, not a hard response deadline.
- Server publication and policy prevent wire callers from choosing work dimensions
  or causing one action to scale with unchecked exact values or collections.
- The service schedule gives the first eligible numerical set an opportunity
  before greedy refinement, while every escaped incumbent remains exact.
- Finer service numerical actions require a new state machine; the coarse reference
  numerical counter remains unchanged.
- M8 still owns wire implementation, snapshot registry/admission, event-loop and
  concurrency measurements, overload behavior, worker selection, and cloneable
  transport results.
- No transaction submission, custody, unrestricted global optimality,
  representative-market, latency, throughput, package, or deployment claim follows.

## Alternatives rejected

- Changing ADR 0001's first deadline sample was rejected because reference bytes,
  counters, forced-stop behavior, and retained evidence are closed.
- Wrapping either current entry in HTTP was rejected because mandatory direct work
  and synchronous callbacks do not establish a service deadline or cancellation.
- Keeping two orchestration copies was rejected because 7c explicitly requires one
  request-session core and parity can preserve policy-specific behavior.
- Treating one reference numerical outer update as a bounded service action was
  rejected because its route-by-inner-iteration cost scales with multiple caller-
  influenced dimensions.
- Letting clients supply hops, routes, iterations, caps, checksum, or proposal
  selection was rejected because they are server resource and trust decisions.
- Returning `no-route` after a cap or deadline was rejected because incomplete work
  cannot prove absence of a feasible exact plan.
- Treating finite non-convergence as success was rejected because exact replay can
  validate an allocation, not retroactively validate approximate convergence.
- Using approximate activation or repair scores as authorization was rejected by
  the exact incumbent boundary.
- Promising an outer HTTP SLA was rejected because synchronous cooperative checks
  cannot observe or preempt all queue, event-loop, serialization, or transport work.
