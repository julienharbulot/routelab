# PORT-005 — Add the bounded quote service and load evidence

## Outcome

The public facade is available through a small local HTTP service with measured behavior.

## Endpoints

```text
GET  /health
GET  /v1/snapshots
POST /v1/quote
```

## Request rules

- body maximum: 32 KiB;
- `amountIn` is a canonical decimal string;
- bounded identifier lengths;
- `maxHops` and `maxRoutes` bounded by server policy;
- `deadlineMs` bounded by server policy;
- no raw internal work caps;
- diagnostics off by default.

Example request:

```json
{
  "snapshotId": "ethereum-mainnet-uniswap-v2-19000000-core12-v1",
  "assetIn": "WETH",
  "assetOut": "USDC",
  "amountIn": "1000000000000000000",
  "strategy": "greedy-split",
  "effort": "balanced",
  "deadlineMs": 25
}
```

## Response rules

Success uses decimal strings and includes route, strategy, termination, timing, and semantic fingerprint.

Errors use:

```ts
{
  error: {
    code: string;
    message: string;
    field?: string;
  }
}
```

Do not expose stack traces.

## Operational behavior

- Prepare snapshots at startup.
- Assign a request ID.
- Log one structured completion line.
- Measure queue/service/end-to-end time when meaningful.
- Gracefully stop on SIGINT/SIGTERM.
- Use no live upstream.

## Load command

```bash
pnpm load -- --concurrency 1,4,16
```

Retain a concise report with:

- count;
- failures;
- p50/p95/p99;
- throughput;
- deadline success;
- event-loop delay;
- memory.

Implement the same-thread service first. Workers are optional and require a retained before/after result.

## Tests

- health and snapshots;
- successful quote;
- malformed JSON;
- body too large;
- JSON numeric amount rejected;
- noncanonical decimal rejected;
- unknown snapshot/asset;
- deadline validation;
- diagnostics default;
- no stack trace;
- graceful shutdown smoke.

## Acceptance

```bash
pnpm test:api
pnpm serve:smoke
pnpm load:smoke
pnpm load -- --concurrency 1,4,16
git diff --check
```

## Commit

```text
PORT-005: Add the bounded quote service
```
