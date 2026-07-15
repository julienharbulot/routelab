# RouteLab TS v0.1 implementation plan

## Outcome

Turn the exact routing core at `cdc5a83` into a usable, measurable, human-sized portfolio release.

The release flow is:

```text
raw snapshot
    -> parse and prepare once
    -> small quote request
    -> bounded strategy
    -> exact authorization
    -> library result / CLI / HTTP response
    -> compact benchmark and intent adapter
```

## Target public surface

```ts
prepareSnapshot(input: unknown): PrepareSnapshotResult;

quote(
  context: RoutingContext,
  request: QuoteRequest,
  options?: QuoteOptions,
): QuoteResult;

serializeQuote(quote: ValidatedQuote): SerializedQuote;
formatQuote(quote: ValidatedQuote): string;
```

The root package exports only the facade, public types, and snapshot parser. Existing detailed runtime types remain internal unless an actual consumer needs them.

### Public request

```ts
type QuoteRequest = {
  snapshotId: string;
  assetIn: string;
  assetOut: string;
  amountIn: bigint;
  maxHops?: number;
  maxRoutes?: number;
};

type QuoteOptions = {
  strategy?: 'best-single' | 'greedy-split' | 'numerical-split';
  effort?: 'fast' | 'balanced' | 'thorough';
  deadlineMs?: number;
  includeDiagnostics?: boolean;
};
```

The facade maps the small options to internal work caps. Detailed numerical iterations and replay caps are not public request fields.

The v0.1 default is `greedy-split` with `balanced` effort. `numerical-split` remains an explicit, first-class option demonstrated by the benchmark. Do not silently change the default based on one machine's timing result.

### Public result

The success result contains:

- snapshot ID and checksum;
- input/output assets;
- exact input/output;
- allocated routes and hops;
- requested strategy and selected plan shape (`single` or `split`);
- fallback and termination information when derivable from runtime diagnostics;
- deterministic work counters;
- optional wall-clock timing;
- a semantic fingerprint that excludes timing;
- optional detailed diagnostics.

Errors are a small discriminated union:

```text
invalid-request
snapshot-mismatch
no-route
deadline-before-plan
dependency-failure
internal-invariant-failure
```

## Target source layout

Keep one package. Do not move every existing module.

```text
src/
├── index.ts
├── public/
│   ├── types.ts
│   ├── quote.ts
│   ├── serialize.ts
│   └── format.ts
├── domain/
├── pools/
├── replay/
├── search/
├── allocation/
├── runtime/
├── router/
│   ├── anytime-exact-input-split/
│   ├── numerical/
│   └── shared/
├── benchmark/
│   └── portfolio/
├── service/
│   ├── http-server.ts
│   ├── request-parser.ts
│   └── snapshot-registry.ts
└── adapters/
    └── near-intents/
```

Large existing files may be split after facade parity is established. Do not rewrite exact logic merely to match the diagram.

## Milestone sequence

### PORT-001 — Clean restart and remove obvious deadweight

Purpose: make the repository describe the product rather than the former workflow.

Deliverables:

- planning overlay integrated;
- generated historical evaluation removed;
- trace/private-public machinery removed;
- long process documents removed or replaced;
- package scripts no longer reference removed files;
- retained snapshot and request corpus still verify;
- baseline core tests pass under the pinned runtime;
- repository working tree drops by at least 7 MB.

No routing semantics change.

Gate:

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm verify:historical-data
pnpm verify:synthetic-requests
pnpm demo
git diff --check
```

### PORT-002 — Public facade and core consolidation

Purpose: establish one supported API and delete redundant runtime surfaces.

Deliverables:

- `src/index.ts` root export;
- `prepareSnapshot`, `quote`, `serializeQuote`, and `formatQuote`;
- three explicit strategies;
- named internal effort profiles;
- exact decimal-string serialization;
- facade golden tests;
- one semantic fingerprint format;
- legacy routers/replay families removed after parity;
- numerical runtime split into understandable modules if necessary;
- no production or test file above 800 lines.

The `numerical-split` strategy must preserve the exact baseline when numerical work fails, stops, or does not improve.

Gate:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm test:core
git diff --check
```

Required facade cases:

- direct route;
- two-hop beats direct;
- split beats best single;
- numerical result exact-authorized;
- disconnected pair;
- malformed request;
- snapshot mismatch;
- zero work or reached deadline returns a valid incumbent when one exists;
- repeated deterministic run has the same semantic fingerprint.

### PORT-003 — Human CLI, demo, and package build

Purpose: make the work usable in five minutes.

Deliverables:

- `pnpm quote`;
- readable default output and `--json`;
- `pnpm demo` with at least one historical quote and one small split fixture;
- `pnpm build`;
- declarations and package exports;
- `pnpm pack --dry-run`;
- package version `0.1.0`;
- project license chosen and added;
- README quickstart.

The CLI uses no framework unless manual parsing would exceed about 150 lines.

Gate:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm demo
pnpm quote -- --help
pnpm quote -- <documented fixture command>
pnpm pack --dry-run
```

### PORT-004 — Compact benchmark and report

Purpose: replace retained artifact bulk with evidence a human can interpret.

Deliverables:

- one curated portfolio case set;
- optional extended run over the retained corpus;
- deterministic quality lane;
- wall-clock latency lane;
- best-single, greedy-split, numerical-split, and long-budget numerical reference;
- exact output, regret, improvement, work, convergence, and rejection metrics;
- p50/p95/p99 based on at least 100 measured observations per reported profile;
- `reports/portfolio-v1.md`;
- `reports/portfolio-v1.json` or CSV below 1 MB;
- `reports/quality-vs-budget.svg`;
- raw observations ignored.

Do not claim that the long-budget numerical result is globally optimal.

Gate:

```bash
pnpm benchmark
pnpm benchmark:verify
pnpm test:benchmark
git diff --check
```

The committed report states dataset limits, environment, warmups, measured sample count, and exact configuration.

### PORT-005 — Bounded HTTP quote service and load evidence

Purpose: demonstrate an operational boundary and measured systems behavior.

Endpoints:

```text
GET  /health
GET  /v1/snapshots
POST /v1/quote
```

Constraints:

- Node built-in HTTP is preferred;
- request body maximum 32 KiB;
- exact amount is a canonical decimal string;
- identifiers and numeric ranges are bounded;
- the server, not the client, owns internal work caps;
- structured request ID, status, strategy, termination, and timing log;
- typed 4xx/5xx response envelope;
- no remote network dependency.

Load command:

```bash
pnpm load -- --concurrency 1,4,16
```

Measure:

- completed and failed requests;
- p50/p95/p99 end-to-end latency;
- throughput;
- deadline completion;
- event-loop delay;
- peak RSS or memory delta.

Run the same-thread server first. Add a bounded worker pool only when the retained measurement shows a clear tail-latency or event-loop problem and the implementation remains small. A documented decision not to add workers is acceptable.

Gate:

```bash
pnpm test:api
pnpm serve:smoke
pnpm load:smoke
pnpm load -- --concurrency 1,4,16
```

### PORT-006 — NEAR Intents fixture adapter and release

Purpose: connect the routing result to the target domain without pretending to be a live solver.

Input boundary supports exact-input quote fields equivalent to:

```text
defuse_asset_identifier_in
defuse_asset_identifier_out
exact_amount_in
min_deadline_ms
```

The adapter:

- maps external asset IDs through an explicit fixture map;
- converts canonical decimal strings to/from `bigint`;
- invokes only the public `quote()` facade;
- returns an unsigned quote candidate;
- rejects exact-output requests in v0.1;
- does not sign, connect to a relay, custody assets, or settle.

Deliverables:

- adapter types and functions;
- one request fixture, asset map, and expected output fixture;
- adapter tests;
- final README, architecture, benchmark, and limitations;
- CI;
- release archive/package inspection;
- final portfolio claims derived from committed evidence.

Gate:

```bash
pnpm check
pnpm benchmark
pnpm test:api
pnpm load:smoke
pnpm pack --dry-run
git archive --format=tar.gz --output=/tmp/routelab-v0.1.0.tar.gz HEAD
```

## Benchmark/release decision gates

### Worker-thread gate

Add workers only if all are true:

1. same-thread service measurements are retained;
2. CPU routing work is the dominant cause;
3. concurrency materially harms p95/p99 or event-loop delay;
4. a small fixed worker pool improves the result;
5. snapshot initialization and deadline semantics remain clear.

Otherwise retain the simpler server.

### More-data gate

Do not block v0.1 on more historical snapshots. Add snapshots only when the acquisition path is reproducible, redistribution is acceptable, and the work does not delay the public API/service.

### ML and PRIME gate

Neither is a v0.1 task. Reconsider only after the released benchmark identifies path ordering or path discovery as a material bottleneck on a larger dataset.

## Final repository quality gate

At release:

- one supported route API;
- no obsolete public router variants;
- no generated evidence bulk;
- no process-control subsystem;
- no file above the documented size limit without a brief reason;
- README below 250 lines;
- all claims trace to a command or committed report;
- the codebase is smaller or approximately the same size as `cdc5a83` despite adding the service and adapter.
