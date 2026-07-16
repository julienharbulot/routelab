# Ethereum mainnet Uniswap V2 block 19000000 core12 v1

This immutable directory is RouteLab's first curated historical dataset. It records 54 positive-reserve Uniswap V2 pools among a frozen 12-token allowlist at Ethereum mainnet block `19000000`, identified by block hash `0xcf384012b91b081230cdf17a3f7dd370d8e67056058af6b272b3d54aa2714fac`.

Infura archive-backed EIP-1898 state calls supplied the direct-state values. SQD finalized `PairCreated` and `Sync` event values matched those values exactly at event locations supplied by the Infura acquisition path. SQD did not independently discover the latest relevant event location for every accepted field.

The six companion JSON files are deterministic curated facts and project metadata. Raw provider responses, logs, requests, caches, credentials, and acquisition work are deliberately excluded. The manifest records the conservative publication boundary and official terms/source-license references; it grants no license and is not legal advice.

Run the offline integrity and preparation boundary:

```bash
pnpm verify:inputs
```

The verifier checks the retained block and token metadata, companion file hashes, snapshot identity and checksum, pool and asset counts, and acceptance through the untrusted snapshot parse-before-prepare boundary. It then derives the fixed benchmark requests from the verified snapshot.

This snapshot represents stored reserves for the selected subset at one historical block. It does not establish complete liquidity, historical order flow, token-transfer feasibility, transaction simulation or submission, custody, live execution, future state, or unrestricted routing optimality. The generated benchmark workload is synthetic evaluation evidence only.
