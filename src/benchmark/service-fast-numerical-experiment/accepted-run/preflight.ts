import {
  loadVerifiedExperimentInputSource,
  protectedExperimentInputOperations,
  type ExperimentInputOperations,
  type ExperimentInputSource,
} from '../input/build.ts';
import {
  sha256Bytes,
  type FrozenServiceFastConfiguration,
  type ServiceFastSourceClosure,
  type SourceClosureDescriptor,
} from '../source-closure/codec.ts';
import {
  readGitHeadRevision,
  readGitIgnoredPaths,
  readGitIndexEntries,
  readGitStatusPorcelain,
} from '../source-closure/git.ts';
import {
  verifyExecutableServiceFastSourceClosure,
  type VerifiedServiceFastSourceClosure,
} from '../source-closure/verification.ts';
import {
  readBoundedIdentityFile,
} from '../tooling/bounded-identity-reader.ts';
import {
  auditServiceFastRuntimeImports,
} from '../tooling/runtime-import-audit.ts';
import {
  ACCEPTED_INPUT_PATH,
  ACCEPTED_SOURCE_CLOSURE_PATH,
  type AcceptedArtifactDescriptor,
  type AcceptedInputRecord,
  type AcceptedJsonObject,
} from './contract.ts';
import { captureAcceptedEnvironment } from './environment.ts';
import {
  acceptedRunFailure,
  projectAcceptedRunFailure,
} from './failure.ts';
import {
  decodeAcceptedInputBytes,
  prepareAcceptedCells,
  type AcceptedPreparedCell,
} from './input.ts';
import {
  admitAcceptedPublication,
  abortAcceptedPublication,
  defaultAcceptedPublicationDependencies,
  type AcceptedPublicationDependencies,
  type AcceptedPublicationSession,
} from './publication.ts';
import { hashAcceptedBytes } from './projection.ts';
import { acceptedRunRuntimeAuditProfile } from './runtime-profile.ts';

const SOURCE_CLOSURE_CAP = 1024 * 1024;
const INPUT_CAP = 64 * 1024 * 1024;

export interface AcceptedPreflightResult {
  readonly closure: ServiceFastSourceClosure;
  readonly config: FrozenServiceFastConfiguration;
  readonly configValue: AcceptedJsonObject;
  readonly sourceClosureDescriptor: AcceptedArtifactDescriptor;
  readonly inputDescriptor: AcceptedArtifactDescriptor;
  readonly inputBytes: Uint8Array;
  readonly source: ExperimentInputSource;
  readonly operations: ExperimentInputOperations;
  readonly records: readonly AcceptedInputRecord[];
  readonly cells: readonly AcceptedPreparedCell[];
  readonly environment: AcceptedJsonObject;
  readonly publication: AcceptedPublicationSession;
}

export interface AcceptedPreflightDependencies {
  readonly readIdentity: typeof readBoundedIdentityFile;
  readonly verifyClosure: (
    repositoryRoot: string,
    bytes: Uint8Array,
  ) => Promise<VerifiedServiceFastSourceClosure>;
  readonly loadSource: (
    readFile: (relativePath: string) => Promise<Uint8Array>,
  ) => Promise<ExperimentInputSource>;
  readonly operations: () => ExperimentInputOperations;
  readonly captureEnvironment: () => AcceptedJsonObject;
  readonly publicationDependencies: AcceptedPublicationDependencies;
  readonly admitPublication: typeof admitAcceptedPublication;
  readonly auditRuntime: typeof auditServiceFastRuntimeImports;
  readonly head: typeof readGitHeadRevision;
  readonly index: typeof readGitIndexEntries;
  readonly status: typeof readGitStatusPorcelain;
  readonly ignored: typeof readGitIgnoredPaths;
}

export function defaultAcceptedPreflightDependencies(): AcceptedPreflightDependencies {
  return Object.freeze({
    readIdentity: readBoundedIdentityFile,
    verifyClosure: verifyExecutableServiceFastSourceClosure,
    loadSource: (readFile: (relativePath: string) => Promise<Uint8Array>) =>
      loadVerifiedExperimentInputSource(Object.freeze({ readFile })),
    operations: protectedExperimentInputOperations,
    captureEnvironment: captureAcceptedEnvironment,
    publicationDependencies: defaultAcceptedPublicationDependencies(hashAcceptedBytes),
    admitPublication: admitAcceptedPublication,
    auditRuntime: auditServiceFastRuntimeImports,
    head: readGitHeadRevision,
    index: readGitIndexEntries,
    status: readGitStatusPorcelain,
    ignored: readGitIgnoredPaths,
  });
}

function descriptor(
  source: SourceClosureDescriptor,
): AcceptedArtifactDescriptor {
  return Object.freeze({ path: source.path, bytes: source.bytes, sha256: source.sha256 });
}

function admittedIndexEntries(
  dependencies: AcceptedPreflightDependencies,
  repositoryRoot: string,
): ReturnType<AcceptedPreflightDependencies['index']> {
  const entries = dependencies.index(repositoryRoot);
  if (entries.some((entry) => entry.stage !== 0 || entry.mode === '160000')) {
    throw acceptedRunFailure('preflight-repository-binding');
  }
  return entries;
}

function indexFingerprint(
  entries: ReturnType<AcceptedPreflightDependencies['index']>,
): string {
  return JSON.stringify(entries.map((entry) => [entry.mode, entry.objectId, entry.stage, entry.path]));
}

function requireOnlyOwnedLock(
  dependencies: AcceptedPreflightDependencies,
  repositoryRoot: string,
  session: AcceptedPublicationSession,
): void {
  const relativeLock = session.lockPath.slice(repositoryRoot.length + 1).split('\\').join('/');
  let status: string;
  try {
    status = new TextDecoder('utf-8', { fatal: true }).decode(dependencies.status(repositoryRoot));
  } catch {
    throw acceptedRunFailure('preflight-repository-binding');
  }
  if (status !== `?? ${relativeLock}\0`) {
    throw acceptedRunFailure('preflight-repository-binding');
  }
}

async function readBound(
  dependencies: AcceptedPreflightDependencies,
  repositoryRoot: string,
  relativePath: string,
  maximumBytes: number,
  expectedBytes?: number,
): Promise<Uint8Array> {
  return dependencies.readIdentity({
    repositoryRoot,
    relativePath,
    maximumBytes,
    ...(expectedBytes === undefined ? {} : { expectedBytes }),
  });
}

/** Re-read every closure-bound byte sequence immediately before candidate work. @internal */
export async function recheckAcceptedBoundBytes(
  repositoryRoot: string,
  descriptors: readonly SourceClosureDescriptor[],
  dependencies: Pick<AcceptedPreflightDependencies, 'readIdentity'>,
): Promise<void> {
  for (const bound of descriptors) {
    const bytes = await dependencies.readIdentity({
      repositoryRoot,
      relativePath: bound.path,
      maximumBytes: Math.max(1, bound.bytes),
      expectedBytes: bound.bytes,
    });
    if (sha256Bytes(bytes) !== bound.sha256) {
      throw acceptedRunFailure('preflight-repository-binding');
    }
  }
}

/** Complete all source/input/runtime/environment/filesystem admission before candidates. @internal */
export async function performAcceptedPreflight(
  repositoryRoot: string,
  dependencies: AcceptedPreflightDependencies,
): Promise<AcceptedPreflightResult> {
  let publication: AcceptedPublicationSession | undefined;
  try {
    const closureBytes = await readBound(
      dependencies,
      repositoryRoot,
      ACCEPTED_SOURCE_CLOSURE_PATH,
      SOURCE_CLOSURE_CAP,
    );
    const verified = await dependencies.verifyClosure(repositoryRoot, closureBytes);
    const closure = verified.closure;
    const headBefore = dependencies.head(repositoryRoot);
    const indexEntriesBefore = admittedIndexEntries(dependencies, repositoryRoot);
    const indexBefore = indexFingerprint(indexEntriesBefore);
    if (closure.inputArtifact.path !== ACCEPTED_INPUT_PATH) {
      throw acceptedRunFailure('preflight-repository-binding');
    }
    const sourceClosureDescriptor = Object.freeze({
      path: ACCEPTED_SOURCE_CLOSURE_PATH,
      bytes: closureBytes.byteLength,
      sha256: sha256Bytes(closureBytes),
    });
    const finalBoundDescriptors = Object.freeze([
      sourceClosureDescriptor,
      closure.config,
      closure.artifactSchema,
      closure.inputArtifact,
      ...closure.sources,
      ...closure.protectedSources,
    ]);
    const inputBytes = await readBound(
      dependencies,
      repositoryRoot,
      closure.inputArtifact.path,
      INPUT_CAP,
      closure.inputArtifact.bytes,
    );
    if (sha256Bytes(inputBytes) !== closure.inputArtifact.sha256) {
      throw acceptedRunFailure('preflight-repository-binding');
    }
    const source = await dependencies.loadSource((relativePath) =>
      readBound(dependencies, repositoryRoot, relativePath, INPUT_CAP));
    const operations = dependencies.operations();
    const records = decodeAcceptedInputBytes(inputBytes);
    const cells = prepareAcceptedCells(records, source, operations);
    const allDescriptors = Object.freeze([
      ...closure.sources,
      ...closure.protectedSources,
    ]);
    const profile = acceptedRunRuntimeAuditProfile(allDescriptors);
    const trackedPaths = new Set(indexEntriesBefore.map((entry) => entry.path));
    const ignoredPaths = dependencies.ignored(
      repositoryRoot,
      profile.projectSources.map((entry) => entry.path),
    );
    await dependencies.auditRuntime({ repositoryRoot, profile, trackedPaths, ignoredPaths });
    const environment = dependencies.captureEnvironment();
    publication = await dependencies.admitPublication(
      repositoryRoot,
      dependencies.publicationDependencies,
    );
    if (
      dependencies.head(repositoryRoot) !== headBefore ||
      indexFingerprint(admittedIndexEntries(dependencies, repositoryRoot)) !== indexBefore
    ) throw acceptedRunFailure('preflight-repository-binding');
    requireOnlyOwnedLock(dependencies, repositoryRoot, publication);
    const lockHandleIdentity = await publication.lockHandle.stat({ bigint: true });
    const lockPathIdentity = await dependencies.publicationDependencies.lstat(
      publication.lockPath,
      { bigint: true },
    );
    if (
      lockHandleIdentity.dev !== lockPathIdentity.dev ||
      lockHandleIdentity.ino !== lockPathIdentity.ino
    ) throw acceptedRunFailure('preflight-filesystem-admission');
    await recheckAcceptedBoundBytes(
      repositoryRoot,
      finalBoundDescriptors,
      dependencies,
    );
    return Object.freeze({
      closure,
      config: verified.config,
      configValue: verified.config as unknown as AcceptedJsonObject,
      sourceClosureDescriptor,
      inputDescriptor: descriptor(closure.inputArtifact),
      inputBytes,
      source,
      operations,
      records,
      cells,
      environment,
      publication,
    });
  } catch (error) {
    const primary = projectAcceptedRunFailure(
      error,
      'preflight-repository-binding',
    );
    if (publication !== undefined) {
      return abortAcceptedPublication(publication, primary);
    }
    throw primary;
  }
}
