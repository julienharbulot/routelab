# Synthetic exhaustive exact-input request corpus v1

This directory contains a separately versioned synthetic request corpus bound to the canonical RouteLab historical snapshot at Ethereum mainnet block 19,000,000. It does not modify that immutable source dataset.

`requests.json` exhaustively covers all 132 ordered distinct pairs from the frozen 12-asset allowlist at three exact input-asset liquidity-relative scales. Asset and pair iteration uses raw UTF-16 address order. Amounts are exact `bigint`-compatible decimal strings derived from 1/100000, 1/10000, and 1/1000 of the input asset's maximum incident stored reserve. Direct/no-direct labels use stored-pair adjacency only. There is no sampling or seed, and no router result influenced selection or labels.

Run `pnpm verify:synthetic-requests` from the repository root to revalidate the historical dataset, artifact bytes and hash, strict schemas, exact graph/amount derivation, ordering, and all 396 requests offline.

The tiers are not equal economic notionals, historical order sizes, or a representative demand distribution. Maximum-reserve anchors can reflect hubs or outliers. This corpus contains no runtime parameters, work controls, routes, outputs, timings, performance claim, transaction behavior, or unrestricted-optimality claim.
