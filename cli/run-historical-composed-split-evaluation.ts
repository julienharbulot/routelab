import { readFile, mkdir, rm, writeFile } from 'node:fs/promises';
import { arch, cpus, platform, release } from 'node:os';
import path from 'node:path';

import {
  createHistoricalComposedSplitEvaluation,
  HISTORICAL_COMPOSED_SPLIT_EVALUATION_ID,
  HISTORICAL_COMPOSED_SPLIT_RUNTIME_REVISION,
} from '../src/benchmark/historical-composed-split/index.ts';

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
const runtimeRevision = arguments_[1];

if (
  arguments_.length !== 2
  || outputDirectory === undefined
  || outputDirectory.length === 0
  || runtimeRevision === undefined
  || runtimeRevision !== HISTORICAL_COMPOSED_SPLIT_RUNTIME_REVISION
) {
  fail({
    code: 'invalid-cli-arguments',
    artifact: 'arguments',
    message: 'Expected one output directory and the frozen lowercase 40-hex runtime revision.',
  });
} else {
  const cpuList = cpus();
  const cpu = cpuList[0];
  if (cpu === undefined || cpuList.length === 0) {
    fail({
      code: 'artifact-write-failed',
      artifact: 'environment',
      message: 'Could not capture the required evaluation environment.',
    });
  } else {
    const result = await createHistoricalComposedSplitEvaluation({
      readFile,
      nowNanoseconds: () => process.hrtime.bigint(),
      environment: {
        nodeVersion: process.version,
        platform: platform(),
        arch: arch(),
        osRelease: release(),
        cpuModel: cpu.model,
        logicalCpuCount: cpuList.length,
      },
      runtimeRevision,
    });
    if (!result.ok) {
      process.stderr.write(`${JSON.stringify({ ok: false, error: result.error })}\n`);
      process.exitCode = 1;
    } else {
      const artifacts = [
        ['semantic-results.json', result.value.semanticResultsJson],
        ['observations.json', result.value.observationsJson],
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
          schemaVersion: 'routelab.composed-historical-evaluation-generation-summary.v3',
          evaluationId: HISTORICAL_COMPOSED_SPLIT_EVALUATION_ID,
          runtimeRevision,
          comparisonConfigSha256: result.value.summary.comparisonConfigSha256,
          observationConfigSha256: result.value.summary.observationConfigSha256,
          semanticResultsSha256: result.value.summary.semanticResultsSha256,
          requestCount: result.value.summary.requestCount,
          profileCount: result.value.summary.profileCount,
          semanticCellCount: result.value.summary.semanticCellCount,
          observationSampleCount: result.value.summary.observationSampleCount,
        })}\n`);
      }
    }
  }
}
