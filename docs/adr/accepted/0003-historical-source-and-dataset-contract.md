# ADR 0003: Select the first historical source and freeze the dataset contract

- **Status:** Accepted
- **Date:** 2026-07-13
- **Scope:** Milestone 6 source selection and canonical-import contract

## Context

RouteLab has an accepted untrusted-input boundary and a composed exact-routing
runtime, but it has no accepted historical source or public historical dataset.
Before one snapshot can be imported, the project must identify the exact chain
state being asserted, distinguish acquisition from verification, freeze selection
and deterministic serialization rules, and avoid publishing provider material
without an established redistribution grant.

This decision selects the source contract for the first import. It does not import
data, promote an acquisition client, define synthetic requests, or evaluate a
routing algorithm.

## Decision

### Historical assertion and venue

The canonical assertion is Ethereum mainnet contract state at this exact block:

- block number: `19000000`;
- block hash:
  `0xcf384012b91b081230cdf17a3f7dd370d8e67056058af6b272b3d54aa2714fac`.

The hash, not a provider-specific response encoding, identifies the asserted chain
state. Acquisition must address this state by hash where the API permits it, using
the [EIP-1898 block parameter](https://eips.ethereum.org/EIPS/eip-1898).

The venue is the canonical Ethereum Uniswap V2 factory at
`0x5c69bee701ef814a2b6a3edd4b1652cb9cc5aa6f` and the two-asset
constant-product pairs it created. The accepted source semantics follow the
upstream [factory](https://github.com/Uniswap/v2-core/blob/master/contracts/UniswapV2Factory.sol)
and [pair](https://github.com/Uniswap/v2-core/blob/master/contracts/UniswapV2Pair.sol)
contracts:

- each imported pool uses the pair's stored `uint112` `reserve0` and `reserve1`
  values at the selected block;
- `asset0` and `asset1` preserve the pair's token order; and
- RouteLab represents the Uniswap V2 swap charge as
  `feeChargedNumerator = 3` and `feeDenominator = 1000`, with the existing exact
  one-final-floor quote semantics.

RouteLab does not scale reserves by token decimals. The imported reserves remain
exact atomic-unit counts encoded as canonical unsigned decimal strings. This is a
bounded field and fee mapping into RouteLab's accepted model, not a claim of
byte-for-byte or economic equivalence with a deployed pair.

### Frozen 12-token selection policy

The first import uses exactly this fixed lowercase-address allowlist. Decimals are
provenance metadata only and do not alter exact reserve values or RouteLab quote
arithmetic.

| Symbol | Asset ID | Decimals |
|---|---|---:|
| WETH | `0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2` | 18 |
| USDC | `0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48` | 6 |
| USDT | `0xdac17f958d2ee523a2206206994597c13d831ec7` | 6 |
| DAI | `0x6b175474e89094c44da98b954eedeac495271d0f` | 18 |
| WBTC | `0x2260fac5e5542a773aa44fbcfedf7c193bc2c599` | 8 |
| UNI | `0x1f9840a85d5af5bf1d1762f925bdaddc4201f984` | 18 |
| LINK | `0x514910771af9ca656af840dff83e8264ecf986ca` | 18 |
| AAVE | `0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9` | 18 |
| MKR | `0x9f8f72aa9304c8b593d555f12ef6589cc3a579a2` | 18 |
| COMP | `0xc00e94cb662c3520282e6f5717214004a7f26888` | 18 |
| CRV | `0xd533a949740bb3306d119cc777fa900ba034cd52` | 18 |
| YFI | `0x0bc529c00c6401aef6d220be8c6ea1667f6ad93e` | 18 |

Selection examines all 66 unordered combinations of these 12 assets through the
selected factory. It retains every returned pair whose two stored reserves are
positive at the selected block. The frozen policy yields 54 pools. The allowlist,
combination rule, positivity rule, and block identity must not be retuned after
observing routing results.

### Acquisition and verification roles

Infura archive-backed state calls are the primary direct-state acquisition path.
Calls use EIP-1898 block-hash addressing for the selected block to acquire the
factory pair identity, pair token order, and stored reserves.

SQD Portal finalized Ethereum event data provides a second value path. Its
[Portal overview](https://docs.sqd.dev/en/portal/overview),
[EVM API reference](https://docs.sqd.dev/en/api/evm/introduction), and
[finalized-stream reference](https://docs.sqd.dev/en/api/evm/finalized-stream)
describe block-range, log-filter, and finalized-event access. For this dataset, SQD
verifies `PairCreated` and `Sync` event values at event locations supplied by the
Infura acquisition path. The accepted values reconcile exactly.

This is not fully independent latest-event discovery: SQD does not independently
discover the latest relevant event location for each accepted field. The public
claim is therefore direct-state acquisition plus event-value verification at
Infura-supplied locations, not independent end-to-end source discovery.

### Dataset identity and immutable versioning

The first dataset ID and canonical snapshot ID are:

```text
ethereum-mainnet-uniswap-v2-block-19000000-core12-v1
```

The expected canonical snapshot contains 54 positive-reserve pools and has this
`routelab.snapshot.v1` financial-content checksum:

```text
sha256:5d21166cf218997776efc23b203c2f70637b1fb822807fb236bfc6fd0bf3e755
```

This identity is immutable. Any change to chain or block identity, venue, source
roles, allowlist, selection or positivity rule, accepted financial semantics,
normalized content, or schema meaning requires a new dataset ID and version. A
provider response-format change that leaves all curated canonical facts unchanged
does not by itself change the dataset version.

### Canonical public-import contract

A later task may add a deliberate tracked `datasets/` root. The first import must
contain only curated deterministic normalized artifacts and project-authored
metadata. Its strict manifest must have a fixed versioned schema, reject missing or
unknown fields, and record:

- the dataset/snapshot ID, chain identity, exact block number and hash, venue and
  factory address;
- the complete allowlist and frozen selection rule;
- the direct-state and event-verification roles, including the location-hint
  limitation;
- declared relative public artifact paths and a SHA-256 byte hash for every
  companion artifact;
- the pool count and declared canonical snapshot checksum; and
- the schema/validation boundary required before routing use.

The manifest and companion artifacts contain no operational timestamp, request ID,
host or environment observation, secret, provider response, cache reference, or
dangling path to non-public work. Exact amounts, reserves, fees, and other exact
integers use the accepted canonical unsigned decimal grammar, never JSON numbers.
Snapshot pools are serialized in ascending raw, case-sensitive UTF-16 pool-ID
order; locale-sensitive sorting is forbidden.

Artifact SHA-256 hashes bind public file bytes. They do not replace the canonical
snapshot checksum, which binds validated financial content independently of pool
input order. Before routing use, imported snapshot JSON is treated as `unknown` and
must enter `parseAndPrepareRoutingContext`. That boundary performs strict schema
and domain parsing before canonical checksum verification and prepared-context
construction, as required by ADR 0002.

### Redistribution and licensing boundary

Only the curated normalized output and project-authored metadata described above
are eligible for a separately reviewed public import. Provider response bodies,
raw block or log streams, request and attempt logs, caches, authentication
material, local acquisition work, and the superseded working ZIP remain private.

The project has not established an explicit provider grant permitting
redistribution of those raw materials. Their exclusion is therefore conservative;
it does not assert that no permission could exist. The current
[Consensys Terms of Use](https://consensys.io/terms-of-use), last updated June 2026,
are retained as the official terms reference for the Infura offering. The Uniswap
V2 source's [GPL-3.0 license](https://github.com/Uniswap/v2-core/blob/master/LICENSE)
is retained with the upstream source references.

This ADR is an engineering publication boundary. It is not legal advice, does not
grant a license, and does not decide rights beyond the project's conservative
choice not to publish raw provider material.

### Interpretation limits

Historical stored reserves establish only the selected pool fields at the selected
block under the source and reconciliation limits above. They do not establish order
flow, transfer-tax or token-transfer feasibility, transaction simulation or
submission, custody, live execution, future state, or unrestricted routing
optimality. Any later evaluation requests are synthetic and require their own
versioned contract.

## Consequences

- Source selection is complete and the canonical public import is the next gate.
- RLT-062 must reproduce the frozen 54-pool identity, checksum, manifest, ordering,
  artifact hashes, and parse-before-prepare acceptance path before any historical
  snapshot can be claimed as imported.
- No public dataset artifact, acquisition client, evaluation corpus, request set,
  algorithm comparison, or performance result exists as a consequence of this
  decision.
