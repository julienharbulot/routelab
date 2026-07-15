# PORT-006 — Add the NEAR Intents fixture adapter and release v0.1

## Outcome

The project demonstrates an honest intent-ready boundary and is packaged for portfolio review.

## Adapter input

Before coding, verify the current official NEAR Intents Market Maker/Message Bus documentation and record the access date in the adapter README. Do not copy an old schema from project prose without checking it.

Support an offline exact-input request shaped around:

```text
defuse_asset_identifier_in
defuse_asset_identifier_out
exact_amount_in
min_deadline_ms
```

Use an explicit asset map from external identifiers to snapshot asset IDs.

Reject:

- exact-output requests;
- unknown assets;
- noncanonical amounts;
- unreasonable deadlines.

## Adapter output

Return an unsigned quote candidate containing:

- external input/output asset identifiers;
- exact input/output decimal strings;
- expiry or validity metadata;
- RouteLab semantic fingerprint;
- selected strategy;
- a clear `unsigned: true` marker or equivalent type name.

The adapter calls only `prepareSnapshot`/`quote` public surfaces.

## Out of scope

Do not add:

- partner JWT handling;
- WebSocket or RPC relay connectivity;
- NEP-413 signing;
- private keys;
- Verifier contract balance checks;
- deposits;
- settlement;
- live capital.

## Fixtures

Add:

```text
fixtures/near-intents/asset-map.json
fixtures/near-intents/exact-input-request.json
fixtures/near-intents/expected-unsigned-quote.json
```

Use fictional/local asset mappings when a real symbol could imply live compatibility.

## Release work

- final README below 250 lines;
- architecture and benchmark docs linked;
- explicit limitations;
- CI runs lint, typecheck, tests, build, demo, and benchmark smoke;
- package archive inspected;
- no generated raw evidence;
- no secrets or private control files;
- final benchmark and load reports committed;
- final version `0.1.0`.

## Acceptance

```bash
pnpm check
pnpm benchmark
pnpm benchmark:verify
pnpm test:api
pnpm load:smoke
pnpm pack --dry-run
git diff --check
git status --short
```

Create and inspect:

```bash
git archive --format=tar.gz --output=/tmp/routelab-v0.1.0.tar.gz HEAD
tar -tzf /tmp/routelab-v0.1.0.tar.gz
```

## Final report

State:

- what the router does;
- what was removed;
- exact test/build commands;
- benchmark result;
- load result;
- adapter boundary;
- known limitations;
- next evidence-led extension.

## Commit

```text
PORT-006: Release RouteLab TS v0.1
```
