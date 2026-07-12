# Milestone 3 canonical router cases

These versioned offline fixtures wrap canonical router runs that are independently evidenced by the RLT-032 replay-verifying reader. Each JSON file is compact UTF-8 with no BOM or trailing newline.

| File | Case ID | Run status | Bytes | File SHA-256 | Run determinism hash |
|---|---|---:|---:|---|---|
| `success.json` | `m3-success` | `success` | 1306 | `35f4fde18b840bbaec6862264024ef22ab2c78f303d003635add6cd0a1735e3f` | `sha256:c4b3c03b960ba1405c1b1f86a92fd7e6d51d5a5a59ab22caefd689b18efc4011` |
| `no-route.json` | `m3-no-route` | `no-route` | 1077 | `dfb4ebd1e382efcc1961101c55223dd755a39891c3760e500bbf8ab4a3faeb23` | `sha256:e93bc0384de0d99417a10ed0fc8b86cfb44645253cf087e38a0e5f7db6be8d90` |
| `no-plan.json` | `m3-no-plan` | `no-plan` | 927 | `05db31a8660fe3a3b71058f282f86ddd0d6d63bc929a8725a8aecccc96971ac1` | `sha256:abc4690200fa7aab7f82b16c1d9c4a4e88535449e02b449e1210d54fa498fed4` |

## Derivation

The embedded success, no-route, and no-plan runs are the fixed RLT-032 oracle vectors. Each wrapper was created by replay-verifying its exact inner JSON and run hash, then serializing the explicit `routelab.router-case.v1` field order. File SHA-256 values are lowercase hexadecimal digests over the exact file bytes; byte counts are UTF-8 byte lengths.

## Limitations

These files are deterministic offline router inputs only. They contain no timing, environment, observation, live-data, benchmark-result, service, protocol-adapter, or transaction behavior. Directory discovery and benchmark execution remain outside this fixture slice.
