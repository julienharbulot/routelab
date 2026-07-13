# ADR 0002: Validate raw snapshots before preparation

- **Status:** Accepted
- **Date:** 2026-07-13
- **Scope:** Milestone 6 input boundary prerequisite

## Context

ADR 0001 deliberately defines `prepareRoutingContext` over an already
domain-validated `LiquiditySnapshot`. That factory defensively captures the typed
value, recomputes and verifies its canonical checksum, and only then builds derived
state.

`LiquiditySnapshot` remains a structural TypeScript interface. It is not runtime
proof that an external value has distinct pool IDs and assets, positive reserves,
valid fees, canonical exact-value strings, or even the expected runtime field
types. A correct checksum binds canonical financial content but does not substitute
for domain validation.

Milestone 6 will introduce external historical input. It needs one enforceable
entry point that cannot accidentally treat a cast or JavaScript object as validated
snapshot data.

## Decision

Add this public direct-module boundary:

```ts
export type ParseAndPrepareRoutingContextResult =
  | { readonly ok: true; readonly value: PreparedRoutingContext }
  | { readonly ok: false; readonly errors: readonly SnapshotValidationError[] }
  | {
      readonly ok: false;
      readonly error: CanonicalSnapshotChecksumMismatchError;
    };

export declare function parseAndPrepareRoutingContext(
  input: unknown,
): ParseAndPrepareRoutingContextResult;
```

The operation has exactly this order:

```text
unknown input
  -> parseLiquiditySnapshot
  -> verify declared checksum against canonical validated financial content
  -> construct PreparedRoutingContext and derived state
```

`parseAndPrepareRoutingContext` returns the existing frozen parser failure unchanged
when domain validation fails. It does not compute a checksum or call preparation in
that branch. After successful parsing, it delegates to the existing
`prepareRoutingContext` and returns that factory's frozen success or checksum
failure unchanged.

The lower-level `prepareRoutingContext(snapshot: LiquiditySnapshot)` signature and
checksum-only failure contract remain unchanged. Trusted typed callers and existing
canonical execution paths may continue to use it after their own domain-validation
boundary. External importers and other untrusted snapshot-shaped inputs must enter
through `parseAndPrepareRoutingContext` or an equivalent boundary that explicitly
calls the same domain parser before preparation.

## Evidence requirements

Focused evidence must cover successful opaque preparation, duplicate pool IDs,
same-asset pools, invalid fee numerator and denominator values, nonpositive
reserves, wrong runtime exact-value types, domain-error precedence over a bad
declared checksum, and a checksum mismatch after otherwise successful domain
validation. Failure exposes no prepared capability. Successful preparation retains
the existing defensive-capture and opaque-capability guarantees.

## Consequences and non-goals

The API addition makes the M6 trust boundary explicit without branding or rewriting
the existing domain types. It does not select or import a historical source, change
the parser, alter canonical snapshot bytes or hashes, change routing or financial
semantics, define package exports, or make a dataset or performance claim.
