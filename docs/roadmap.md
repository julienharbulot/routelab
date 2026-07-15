# RouteLab roadmap

RouteLab v0.1 is a compact exact-input liquidity-routing portfolio project. The immediate goal is a defensible release, not a broader solver platform.

## Release-candidate work

- Base quality evidence on all 396 synthetic requests derived from the retained historical reserve snapshot, separated from hand-readable correctness fixtures.
- Report quality against deterministic work with stratification by amount tier and topology.
- Isolate the HTTP server from the load generator, add bounded admission control, and retain worker threads only if the measured gate justifies them.
- Align the offline NEAR Intents parser and unsigned solver draft with current official request/event shapes.
- Complete clean-clone, packed-consumer, CI, and release-note proof before an owner-approved tag.

## Later, evidence-led options

- Additional versioned snapshots and explicit snapshot-update boundaries.
- Live balance-aware quoting and data acquisition, designed separately from the immutable offline core.
- Gas-aware objectives or additional pool models behind new exact semantics and differential evidence.

## Deliberate non-goals for v0.1

No live relay credentials, signing, custody, transaction submission, settlement, frontend, PRIME indexing, learned ordering, concentrated-liquidity math, or unrestricted global-optimality claim.
