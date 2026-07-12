# RouteLab TS

RouteLab TS is being built as a small, exact, and measurable liquidity router. The current repository contract provides strict TypeScript checks, typed linting, tests, and a deterministic offline walking-skeleton demo.

Financial quoting is intentionally deferred until the amount, fee, rounding, reserve-transition, and snapshot invariants are documented and reviewed.

## Prerequisites

- Node.js 24
- pnpm 11.12.0

The `packageManager` and `engines` fields in `package.json` pin the package-manager version and maintained Node line used by CI.

## Bootstrap

Install the pinned pnpm version if it is not already available, then install the locked development dependencies:

```bash
npm install --global pnpm@11.12.0
pnpm install --frozen-lockfile
```

## Commands

```bash
pnpm lint       # Run typed ESLint rules.
pnpm typecheck  # Run strict TypeScript checks without emitting files.
pnpm test       # Run the Node.js built-in test runner.
pnpm demo       # Print deterministic offline walking-skeleton status.
pnpm check      # Run lint, type-checking, tests, and the demo.
```

CI performs a frozen install and runs the same `pnpm check` command.
