import { randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  createRepresentativeNumericalProfile,
  REPRESENTATIVE_NUMERICAL_PROFILE_EVIDENCE_REVISION,
} from '../src/benchmark/representative-numerical-profile/index.ts';

async function exists(target: string): Promise<boolean> {
  try { await lstat(target); return true; }
  catch (error) { return (error as NodeJS.ErrnoException).code !== 'ENOENT'; }
}

function fail(code: string, artifact: string, message: string): void {
  process.stderr.write(`${JSON.stringify({ ok: false, error: { code, artifact, message } })}\n`);
  process.exitCode = 1;
}

const rawArguments = process.argv.slice(2);
const arguments_ = rawArguments[0] === '--' ? rawArguments.slice(1) : rawArguments;
const outputDirectory = arguments_[0];
const evidenceRevision = arguments_[1];

if (arguments_.length !== 2 || outputDirectory === undefined || outputDirectory.length === 0
  || evidenceRevision !== REPRESENTATIVE_NUMERICAL_PROFILE_EVIDENCE_REVISION) {
  fail('invalid-cli-arguments', 'arguments',
    `Expected one fresh output directory and evidence revision ${REPRESENTATIVE_NUMERICAL_PROFILE_EVIDENCE_REVISION}.`);
} else if (await exists(outputDirectory)) {
  fail('output-conflict', outputDirectory, 'The output directory already exists; no observation was started.');
} else {
  const result = await createRepresentativeNumericalProfile({
    repositoryRoot: process.cwd(), evidenceRevision, readFile,
  });
  if (!result.ok) {
    process.stderr.write(`${JSON.stringify({ ok: false, error: result.error })}\n`);
    process.exitCode = 1;
  } else {
    const parent = path.dirname(outputDirectory);
    const staging = path.join(parent, `.${path.basename(outputDirectory)}.staging-${process.pid}-${randomUUID()}`);
    let staged = false;
    try {
      await mkdir(parent, { recursive: true });
      if (await exists(outputDirectory)) throw Object.assign(new Error('output conflict'), { code: 'EEXIST' });
      await mkdir(staging); staged = true;
      for (const [name, contents] of Object.entries(result.value.files)) {
        await writeFile(path.join(staging, name), contents, { encoding: 'utf8', flag: 'wx' });
      }
      await rename(staging, outputDirectory); staged = false;
      process.stdout.write(`${JSON.stringify(result.value.summary)}\n`);
    } catch (error) {
      if (staged) await rm(staging, { recursive: true, force: true }).catch(() => undefined);
      const conflict = (error as NodeJS.ErrnoException).code === 'EEXIST';
      fail(conflict ? 'output-conflict' : 'artifact-write-failed', outputDirectory,
        'Could not atomically create the complete representative numerical profile artifact set.');
    }
  }
}
