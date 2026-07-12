import { readdir, readFile } from 'node:fs/promises';

import {
  createOfflineRouterBenchmarkReport,
  type OfflineRouterBenchmarkDependencies,
} from '../src/benchmark/offline-router-cases/index.ts';

const USAGE = 'Usage: pnpm benchmark [--cases <directory>]';
const DEFAULT_CASE_DIRECTORY = 'fixtures/m3/router-cases';

function parseCaseDirectory(arguments_: readonly string[]):
  | { readonly kind: 'run'; readonly directory: string }
  | { readonly kind: 'help' }
  | { readonly kind: 'invalid' } {
  if (arguments_.length === 0) {
    return { kind: 'run', directory: DEFAULT_CASE_DIRECTORY };
  }
  if (arguments_.includes('--help')) {
    return arguments_.length === 1
      ? { kind: 'help' }
      : { kind: 'invalid' };
  }
  if (
    arguments_.length === 2 &&
    arguments_[0] === '--cases' &&
    arguments_[1] !== undefined &&
    arguments_[1].length > 0 &&
    !arguments_[1].startsWith('--')
  ) {
    return { kind: 'run', directory: arguments_[1] };
  }
  return { kind: 'invalid' };
}

const parsedArguments = parseCaseDirectory(process.argv.slice(2));
if (parsedArguments.kind === 'help') {
  process.stdout.write(`${USAGE}\n`);
} else if (parsedArguments.kind === 'invalid') {
  process.stderr.write(`${USAGE}\n`);
  process.exitCode = 1;
} else {
  const dependencies: OfflineRouterBenchmarkDependencies = {
    async readDirectory(directory) {
      const entries = await readdir(directory, { withFileTypes: true });
      return entries.map((entry) => ({
        name: entry.name,
        isFile: entry.isFile(),
      }));
    },
    async readFile(path) {
      return readFile(path, 'utf8');
    },
    now: () => process.hrtime.bigint(),
  };
  const result = await createOfflineRouterBenchmarkReport(
    parsedArguments.directory,
    dependencies,
    {
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
    },
  );

  if (!result.ok) {
    process.stderr.write(`benchmark failed: ${result.error.code}\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write(`${result.value.canonicalJson}\n`);
  }
}
