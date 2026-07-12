# RouteLab TS

RouteLab TS is a small, exact, measurable liquidity-router project. Its target first release is deterministic offline exact-input routing over immutable snapshots of two-asset constant-product pools.

Today the executable code validates immutable in-memory pool snapshots and deterministically selects the best exact-replayed single path found within explicit hop and edge-expansion limits. It can serialize canonical v1 snapshot financial content, compute or verify its prefixed SHA-256 checksum, create a checksum-verified canonical in-memory bounded-router run with a determinism hash, and parse that record back only after fresh exact replay reproduces its bytes and hash. The general router still treats checksums as pinned identity; verification is enforced by the canonical-run boundary. Exact pool/replay/search/router behavior, focused tests, and independent bounded financial, graph, router, checksum, run-record, and reader oracles are public. Split allocation, unrestricted global optimality, checkpoint/resume and wall-clock deadlines, canonical run file persistence, benchmark tooling, services, and protocol adapters are not implemented. The offline deterministic demo reports capability status only; it does not execute a financial request.

## Prerequisites

- Node.js 24.18.0
- pnpm 11.12.0

The repository pins both versions. It does not require a global package-manager installation. With Corepack distributed alongside Node.js 24.18.0:

```bash
corepack pnpm --version
corepack pnpm install --frozen-lockfile
```

The version command must report `11.12.0`. Do not modify a host toolchain to repair a missing runtime; use an already-supported local/CI path or report the unverified check.

## Commands

```bash
pnpm trace:check:index    # Verify the exact staged publication surface.
pnpm trace:check:head     # Verify the current commit tree.
pnpm trace:check:history  # Audit every reachable commit; known historical exposure fails.
pnpm lint         # Run typed ESLint rules.
pnpm typecheck    # Run strict TypeScript checks without emitting files.
pnpm test         # Run Node's built-in test runner.
pnpm demo         # Print deterministic offline capability status.
pnpm check        # Run the complete local gate.
```

CI performs a frozen install and runs `pnpm check`.

## Technical contract

- [Accepted financial and deterministic invariants](docs/invariants.md)
- [Milestone 0 fixtures](fixtures/m0/README.md)
- [Technical roadmap](IMPLEMENTATION_PLAN.md)
- [Current public status](STATUS.md)
- [Research references](docs/references.md)

## Engineering method and evidence

RouteLab uses a bounded human-led workflow with separate implementation, independent oracle, and read-only review roles. Accepted contracts, reviewed decisions, reproducible evidence, and concise integrated outcomes stay public. Active coordination, raw reports, prompts, unpublished evidence, and local tool state remain private.

See the [development model](docs/CODEX_OPERATING_MODEL.md), [review contract](docs/CODE_REVIEW.md), [task template](tasks/TASK_TEMPLATE.md), and [engineering log](docs/engineering-log/README.md). `pnpm check` runs the staged-index boundary check, while the HEAD and history modes provide explicit committed-tree audits.
