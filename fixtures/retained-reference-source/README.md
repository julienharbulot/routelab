# Retained reference source provenance

This directory preserves exact historical source bytes required to reconstruct
accepted retained evidence after the corresponding logical source changes.

| Historical logical path | Retained source path | Bytes | SHA-256 |
|---|---|---:|---|
| `package.json` | `fixtures/retained-reference-source/rlt080-package.source.json` | 2,017 | `490fbe328e08fbd1fe1edf171e09c099cf2bc0daa301aac9d1ddf6101a4cb101` |

The retained package source is byte-identical to `package.json` at the RLT-080
profiler integration revision `8434ad6dc69517c33c04cbe36ec67967efe2cd46`.
The numerical runtime implementation revision inside the retained profile
manifest identifies only the runtime source; it is not the package source
revision. The retained verifier maps the exact historical logical path while the
current package remains authoritative for current commands.
