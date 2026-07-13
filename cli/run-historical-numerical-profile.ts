import { randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  createHistoricalNumericalProfile,
  NUMERICAL_BASELINE_PROFILE_EVIDENCE_REVISION,
  type HistoricalNumericalProfileError,
} from '../src/benchmark/historical-numerical-profile/index.ts';

interface CliError {
  readonly code: 'invalid-cli-arguments' | 'output-conflict' | 'artifact-write-failed';
  readonly artifact: string;
  readonly message: string;
}

function fail(error: CliError | HistoricalNumericalProfileError): void {
  process.stderr.write(`${JSON.stringify({ ok: false, error })}\n`);
  process.exitCode = 1;
}

async function exists(target: string): Promise<boolean> {
  try {
    await lstat(target);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ENOENT';
  }
}

const rawArguments = process.argv.slice(2);
const arguments_ = rawArguments[0] === '--' ? rawArguments.slice(1) : rawArguments;
const outputDirectory = arguments_[0];
const evidenceRevision = arguments_[1];

if (arguments_.length !== 2 || outputDirectory === undefined || outputDirectory.length === 0
  || evidenceRevision !== NUMERICAL_BASELINE_PROFILE_EVIDENCE_REVISION) {
  fail({
    code: 'invalid-cli-arguments',
    artifact: 'arguments',
    message: `Expected one fresh output directory and evidence revision ${NUMERICAL_BASELINE_PROFILE_EVIDENCE_REVISION}.`,
  });
} else if (await exists(outputDirectory)) {
  fail({
    code: 'output-conflict',
    artifact: outputDirectory,
    message: 'The output directory already exists; no observation was started.',
  });
} else {
  const result = await createHistoricalNumericalProfile({
    repositoryRoot: process.cwd(),
    evidenceRevision,
    readFile,
  });
  if (!result.ok) {
    fail(result.error);
  } else {
    const parent = path.dirname(outputDirectory);
    const staging = path.join(parent, `.${path.basename(outputDirectory)}.staging-${process.pid}-${randomUUID()}`);
    let staged = false;
    try {
      await mkdir(parent, { recursive: true });
      if (await exists(outputDirectory)) {
        throw Object.assign(new Error('output conflict'), { code: 'EEXIST' });
      }
      await mkdir(staging, { recursive: false });
      staged = true;
      for (const [name, contents] of Object.entries(result.value.files)) {
        await writeFile(path.join(staging, name), contents, { encoding: 'utf8', flag: 'wx' });
      }
      await rename(staging, outputDirectory);
      staged = false;
      process.stdout.write(`${JSON.stringify(result.value.summary)}\n`);
    } catch (error) {
      if (staged) await rm(staging, { recursive: true, force: true }).catch(() => undefined);
      const conflict = (error as NodeJS.ErrnoException).code === 'EEXIST';
      fail({
        code: conflict ? 'output-conflict' : 'artifact-write-failed',
        artifact: outputDirectory,
        message: 'Could not atomically create the complete numerical baseline profile artifact set.',
      });
    }
  }
}
