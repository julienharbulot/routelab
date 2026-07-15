# PORT-003 — Add the human CLI, demo, and package build

## Outcome

A reviewer can install, build, and understand RouteLab without reading internal modules.

## Quote CLI

Add:

```bash
pnpm quote -- --help
```

Support:

```text
--snapshot <path>
--asset-in <id>
--asset-out <id>
--amount-in <canonical decimal>
--strategy <best-single|greedy-split|numerical-split>
--effort <fast|balanced|thorough>
--deadline-ms <integer>
--json
```

Default output shows:

- snapshot;
- exact input;
- selected route(s);
- allocation per route;
- exact output;
- improvement over best single when available;
- strategy and fallback;
- termination;
- elapsed time;
- exact validation;
- semantic fingerprint.

Keep default output below 35 lines.

## Demo

`pnpm demo` runs:

1. one small hand-readable split fixture;
2. one documented request from the retained historical snapshot.

It prints readable text, not one-line JSON.

## Package

Add:

- `src/index.ts`;
- `tsconfig.build.json`;
- `build` script;
- declaration output;
- package `exports`;
- `files` allowlist;
- version `0.1.0`;
- a project license selected by the owner;
- `pnpm pack --dry-run`.

Use TypeScript’s relative import extension rewriting for emitted JavaScript rather than manually maintaining separate import paths.

Target package metadata:

```json
{
  "version": "0.1.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "files": ["dist", "README.md", "LICENSE"]
}
```

`tsconfig.build.json` should extend the strict project settings, enable emit/declarations, set `rootDir` and `outDir`, and rewrite relative `.ts` import extensions in emitted JavaScript.

## Acceptance

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm demo
pnpm quote -- --help
pnpm quote -- <documented command>
pnpm quote -- <documented command> --json
pnpm pack --dry-run
git diff --check
```

The package archive must not include datasets, raw reports, tests, private files, or agent prompts unless explicitly intended.

## Commit

```text
PORT-003: Add the quote CLI and buildable package
```
