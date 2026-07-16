# RouteLab roadmap

RouteLab v0.1 is a compact exact-input liquidity-routing portfolio project. The immediate goal is a defensible release, not a broader solver platform.

## Release-candidate work

- Align the offline NEAR Intents parser and unsigned solver draft with current official request/event shapes.
- Complete clean-clone, packed-consumer, CI, and release-note proof before an owner-approved tag.

## Later, evidence-led options

- Additional versioned snapshots and explicit snapshot-update boundaries.
- Live balance-aware quoting and data acquisition, designed separately from the immutable offline core.
- Gas-aware objectives or additional pool models behind new exact semantics and differential evidence.

## Deliberate non-goals for v0.1

No live relay credentials, signing, custody, transaction submission, settlement, frontend, PRIME indexing, learned ordering, concentrated-liquidity math, or unrestricted global-optimality claim.
