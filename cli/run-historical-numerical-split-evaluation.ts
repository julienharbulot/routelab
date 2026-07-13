import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  createHistoricalNumericalSplitEvaluation,
  HISTORICAL_NUMERICAL_SPLIT_EVALUATION_ID,
} from '../src/benchmark/historical-numerical-split/index.ts';

interface CliError {
  readonly code: 'invalid-cli-arguments' | 'output-conflict' | 'artifact-write-failed';
  readonly artifact: string;
  readonly message: string;
}

function fail(error: CliError): void {
  process.stderr.write(`${JSON.stringify({ ok: false, error })}\n`);
  process.exitCode = 1;
}

const rawArguments = process.argv.slice(2);
const arguments_ = rawArguments[0] === '--' ? rawArguments.slice(1) : rawArguments;
const outputDirectory = arguments_[0];

if (arguments_.length !== 1 || outputDirectory === undefined || outputDirectory.length === 0) {
  fail({
    code: 'invalid-cli-arguments',
    artifact: 'arguments',
    message: 'Expected one output directory.',
  });
} else {
  const result = await createHistoricalNumericalSplitEvaluation({ readFile });
  if (!result.ok) {
    process.stderr.write(`${JSON.stringify({ ok: false, error: result.error })}\n`);
    process.exitCode = 1;
  } else {
    const artifacts = [
      ['semantic-results.json', result.value.semanticResultsJson],
      ['manifest.json', result.value.manifestJson],
    ] as const;
    const written: string[] = [];
    let failedArtifact: string | undefined;
    try {
      await mkdir(outputDirectory, { recursive: true });
      for (const [name, contents] of artifacts) {
        failedArtifact = name;
        const target = path.join(outputDirectory, name);
        await writeFile(target, contents, { encoding: 'utf8', flag: 'wx' });
        written.push(target);
      }
    } catch {
      for (const target of written.reverse()) {
        await rm(target, { force: true }).catch(() => undefined);
      }
      fail({
        code: written.length === 0 ? 'output-conflict' : 'artifact-write-failed',
        artifact: failedArtifact ?? 'output-directory',
        message: 'Could not create the complete generated evaluation artifact set.',
      });
    }
    if (written.length === artifacts.length) {
      process.stdout.write(`${JSON.stringify({
        schemaVersion: 'routelab.numerical-historical-evaluation-generation-summary.v1',
        evaluationId: HISTORICAL_NUMERICAL_SPLIT_EVALUATION_ID,
        comparisonConfigSha256: result.value.summary.comparisonConfigSha256,
        eligibilitySha256: result.value.summary.eligibilitySha256,
        baselineSemanticResultsSha256: result.value.summary.baselineSemanticResultsSha256,
        semanticResultsSha256: result.value.summary.semanticResultsSha256,
        requestCount: result.value.summary.requestCount,
        profileCount: result.value.summary.profileCount,
        cellCount: result.value.summary.cellCount,
        eligibleCellCount: result.value.summary.eligibleCellCount,
        ineligibleCellCount: result.value.summary.ineligibleCellCount,
        mode: result.value.summary.decision.mode,
      })}\n`);
    }
  }
}
