import path from 'node:path';

import {
  constructAfterExperimentInputAdmission,
  defaultExperimentInputSourceDependencies,
  loadVerifiedExperimentInputSource,
  protectedExperimentInputOperations,
  streamExperimentInputRecords,
  validateExperimentInputPublicationAccounting,
} from '../src/benchmark/service-fast-numerical-experiment/input/build.ts';
import { auditRuntimeImportClosure } from '../src/benchmark/service-fast-numerical-experiment/input/closure-audit.ts';
import { publishExclusiveInputArtifact } from '../src/benchmark/service-fast-numerical-experiment/input/publication.ts';

const repositoryRoot = path.resolve('.');

try {
  const source = await loadVerifiedExperimentInputSource(
    defaultExperimentInputSourceDependencies(repositoryRoot),
  );
  await constructAfterExperimentInputAdmission(
    source,
    async (runtimeClosure) => {
      await auditRuntimeImportClosure({
        repositoryRoot,
        expected: runtimeClosure,
      });
    },
    async (admittedSource) => {
      const publication = await publishExclusiveInputArtifact({
        destinationPath: path.resolve(repositoryRoot, admittedSource.artifactPath),
        maximumBytes: admittedSource.maximumBytes,
        produce: async (sink) =>
          streamExperimentInputRecords(
            admittedSource,
            protectedExperimentInputOperations(),
            sink,
          ),
        validateBeforeCommit: ({ value, bytes, sha256 }) => {
          validateExperimentInputPublicationAccounting(value, { bytes, sha256 });
        },
      });
      process.stdout.write(
        `${JSON.stringify({
          path: admittedSource.artifactPath,
          records: publication.value.recordCount,
          bytes: publication.bytes,
          sha256: publication.sha256,
        })}\n`,
      );
    },
  );
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
