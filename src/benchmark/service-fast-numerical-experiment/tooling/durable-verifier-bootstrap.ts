import {
  SERVICE_FAST_MAX_BOUND_SOURCE_BYTES,
  descriptorsEqual,
  sha256Bytes,
  type SourceClosureDescriptor,
} from '../source-closure/codec.ts';
import { verifyDurableServiceFastSourceClosure } from '../source-closure/verification.ts';
import {
  readGitFullTreeEntries,
  readGitHeadRevision,
  readGitIgnoredPaths,
  readGitIndexEntries,
  readGitStatusPorcelain,
  requireSourceClosurePath,
} from '../source-closure/git.ts';
import {
  auditServiceFastRuntimeImports,
  noArgumentParentRuntimeAuditProfile,
  type RuntimeImportAuditProfile,
  type RuntimeProjectDescriptor,
} from './runtime-import-audit.ts';
import {
  SERVICE_FAST_DURABLE_RUNTIME_PROFILE_PATH,
  decodeServiceFastDurableRuntimeProfileSource,
} from './durable-runtime-profile.ts';
import {
  ServiceFastBoundedIdentityReadError,
  readBoundedIdentityFile,
} from './bounded-identity-reader.ts';

const SOURCE_CLOSURE_PATH =
  'fixtures/m7c/service-fast-numerical/source-closure.v1.json';
const SOURCE_CLOSURE_MAX_BYTES = 1_048_576;
const SELECTED_RUNTIME_AGGREGATE_MAX_BYTES = 64 * 1_048_576;
const RETAINED_DIRECTORY =
  'datasets/experiments/ethereum-mainnet-uniswap-v2/block-19000000/core12-v1/supported-regime-suite-v1/service-fast-numerical-v1';
const RETAINED_FILES = Object.freeze([
  'inputs.ndjson',
  'semantic-results.ndjson',
  'call-timing-observations.ndjson',
  'incumbent-timeline-observations.ndjson',
  'deadline-observations.ndjson',
  'analysis.json',
  'manifest.json',
  'README.md',
].map((name) => `${RETAINED_DIRECTORY}/${name}`));

export class ServiceFastDurableBootstrapError extends Error {
  readonly code: string;
  readonly artifact: string;
  readonly toolFailureFamily = 'repository';

  constructor(code: string, artifact: string, message: string) {
    super(message);
    this.code = code;
    this.artifact = artifact;
  }
}

function bootstrapFailure(code: string, artifact: string, message: string): never {
  throw new ServiceFastDurableBootstrapError(code, artifact, message);
}

async function readBoundRegularFile(
  repositoryRoot: string,
  relativePath: string,
  maximumBytes: number,
  expectedBytes?: number,
): Promise<Uint8Array> {
  try {
    return await readBoundedIdentityFile({
      repositoryRoot,
      relativePath,
      maximumBytes,
      ...(expectedBytes === undefined ? {} : { expectedBytes }),
    });
  } catch (error) {
    if (error instanceof ServiceFastDurableBootstrapError) throw error;
    if (error instanceof ServiceFastBoundedIdentityReadError) {
      return bootstrapFailure(
        error.code === 'bounded-file-identity-mismatch'
          ? 'bootstrap-file-identity-mismatch'
          : 'bootstrap-file-admission-failure',
        relativePath,
        'Durable bootstrap file failed bounded identity admission.',
      );
    }
    return bootstrapFailure('bootstrap-file-admission-failure', relativePath, 'Durable bootstrap could not inspect a required file.');
  }
}

function descriptorMap(
  descriptors: readonly SourceClosureDescriptor[],
): ReadonlyMap<string, SourceClosureDescriptor> {
  const byPath = new Map<string, SourceClosureDescriptor>();
  for (const descriptor of descriptors) {
    const prior = byPath.get(descriptor.path);
    if (prior !== undefined && !descriptorsEqual(prior, descriptor)) {
      return bootstrapFailure('bootstrap-descriptor-conflict', descriptor.path, 'Source closure contains conflicting descriptors for one runtime path.');
    }
    byPath.set(descriptor.path, descriptor);
  }
  return byPath;
}

function requireDescriptorBytes(
  bytes: Uint8Array,
  descriptor: SourceClosureDescriptor,
): void {
  if (bytes.byteLength !== descriptor.bytes || sha256Bytes(bytes) !== descriptor.sha256) {
    bootstrapFailure('bootstrap-descriptor-mismatch', descriptor.path, 'Bootstrap bytes differ from the revision-bound source descriptor.');
  }
}

export function admitServiceFastAttestedRuntimeDescriptorBytes(
  descriptors: Iterable<RuntimeProjectDescriptor>,
): void {
  let attestedRuntimeBytes = 0n;
  for (const descriptor of descriptors) {
    if (
      !Number.isSafeInteger(descriptor.bytes) ||
      descriptor.bytes < 0 ||
      descriptor.bytes > SERVICE_FAST_MAX_BOUND_SOURCE_BYTES
    ) {
      return bootstrapFailure(
        'bootstrap-runtime-byte-cap-exceeded',
        descriptor.path,
        'Attested runtime descriptor has an invalid per-source byte count.',
      );
    }
    attestedRuntimeBytes += BigInt(descriptor.bytes);
    if (attestedRuntimeBytes > BigInt(SELECTED_RUNTIME_AGGREGATE_MAX_BYTES)) {
      return bootstrapFailure(
        'bootstrap-runtime-byte-cap-exceeded',
        'attested runtime graph',
        'Attested parent and selected-child runtime descriptors exceed the reviewed aggregate byte cap.',
      );
    }
  }
}

function dispatchRepositoryState(
  repositoryRoot: string,
): Readonly<{
  readonly head: string;
  readonly trackedPaths: ReadonlySet<string>;
  readonly fingerprint: string;
}> {
  const head = readGitHeadRevision(repositoryRoot);
  const indexEntries = readGitIndexEntries(repositoryRoot);
  const indexByPath = new Map<string, typeof indexEntries[number]>();
  for (const entry of indexEntries) {
    if (entry.stage !== 0 || entry.mode === '160000' || indexByPath.has(entry.path)) {
      return bootstrapFailure('bootstrap-index-identity-mismatch', entry.path, 'Durable dispatch requires one nonsubmodule stage-zero index identity per tracked path.');
    }
    indexByPath.set(entry.path, entry);
  }
  const treeEntries = readGitFullTreeEntries(repositoryRoot, head);
  const treeByPath = new Map(treeEntries.map((entry) => [entry.path, entry]));
  if (
    treeByPath.size !== treeEntries.length ||
    treeByPath.size !== indexByPath.size ||
    treeEntries.some((treeEntry) => {
      const indexEntry = indexByPath.get(treeEntry.path);
      return treeEntry.type !== 'blob' ||
        treeEntry.mode === '160000' ||
        indexEntry === undefined ||
        indexEntry.mode !== treeEntry.mode ||
        indexEntry.objectId !== treeEntry.objectId;
    })
  ) {
    return bootstrapFailure('bootstrap-index-identity-mismatch', repositoryRoot, 'Durable dispatch index identities differ from current HEAD.');
  }
  let decodedStatus: string;
  try {
    decodedStatus = new TextDecoder('utf-8', { fatal: true }).decode(
      readGitStatusPorcelain(repositoryRoot),
    );
  } catch {
    return bootstrapFailure('bootstrap-repository-state-mismatch', repositoryRoot, 'Durable dispatch repository status is not canonical UTF-8.');
  }
  const records = decodedStatus.split('\0');
  if (records.at(-1) !== '') {
    return bootstrapFailure('bootstrap-repository-state-mismatch', repositoryRoot, 'Durable dispatch repository status is not NUL terminated.');
  }
  const allowedUntracked = new Set(RETAINED_FILES);
  const admittedStatusPaths: string[] = [];
  for (const record of records.slice(0, -1)) {
    if (!record.startsWith('?? ')) {
      return bootstrapFailure('bootstrap-repository-state-mismatch', repositoryRoot, 'Durable dispatch rejects every tracked worktree or index change.');
    }
    let relativePath: string;
    try {
      relativePath = requireSourceClosurePath(record.slice(3));
    } catch {
      return bootstrapFailure('bootstrap-repository-state-mismatch', repositoryRoot, 'Durable dispatch status contains a noncanonical path.');
    }
    if (!allowedUntracked.has(relativePath)) {
      return bootstrapFailure('bootstrap-repository-state-mismatch', relativePath, 'Only the eight frozen retained files may be untracked during durable dispatch.');
    }
    admittedStatusPaths.push(relativePath);
  }
  admittedStatusPaths.sort();
  return Object.freeze({
    head,
    trackedPaths: new Set(indexByPath.keys()),
    fingerprint: JSON.stringify({
      head,
      index: indexEntries.map((entry) => [entry.mode, entry.objectId, entry.stage, entry.path]),
      admittedStatusPaths,
    }),
  });
}

export async function authenticateServiceFastDurableVerifierBeforeDispatch(
  repositoryRoot: string,
): Promise<void> {
  const stateBefore = dispatchRepositoryState(repositoryRoot);
  const closureBytes = await readBoundRegularFile(
    repositoryRoot,
    SOURCE_CLOSURE_PATH,
    SOURCE_CLOSURE_MAX_BYTES,
  );
  const verified = verifyDurableServiceFastSourceClosure(
    repositoryRoot,
    closureBytes,
  );
  const descriptors = descriptorMap([
    ...verified.closure.sources,
    ...verified.closure.protectedSources,
  ]);
  const profileDescriptor = descriptors.get(SERVICE_FAST_DURABLE_RUNTIME_PROFILE_PATH);
  if (profileDescriptor === undefined) {
    return bootstrapFailure('bootstrap-profile-descriptor-missing', SERVICE_FAST_DURABLE_RUNTIME_PROFILE_PATH, 'Source closure omits the durable runtime profile data leaf.');
  }
  const profileBytes = await readBoundRegularFile(
    repositoryRoot,
    SERVICE_FAST_DURABLE_RUNTIME_PROFILE_PATH,
    SERVICE_FAST_MAX_BOUND_SOURCE_BYTES,
    profileDescriptor.bytes,
  );
  requireDescriptorBytes(profileBytes, profileDescriptor);
  const profileData = decodeServiceFastDurableRuntimeProfileSource(profileBytes);
  const projectSources: RuntimeProjectDescriptor[] = profileData.projectSources.map((sourcePath) => {
    const descriptor = descriptors.get(sourcePath);
    if (descriptor === undefined) {
      return bootstrapFailure('bootstrap-runtime-descriptor-missing', sourcePath, 'Durable runtime profile names a path absent from the source closure.');
    }
    return Object.freeze({
      path: descriptor.path,
      bytes: descriptor.bytes,
      sha256: descriptor.sha256,
    });
  });
  const runtimeProfile: RuntimeImportAuditProfile = Object.freeze({
    profileId: profileData.profileId,
    entryRoots: profileData.entryRoots,
    projectSources: Object.freeze(projectSources),
    nodeBuiltins: profileData.nodeBuiltins,
    pathCapabilities: profileData.pathCapabilities,
  });
  const parentProfile = noArgumentParentRuntimeAuditProfile(
    [...descriptors.values()].map((descriptor) => Object.freeze({
      path: descriptor.path,
      bytes: descriptor.bytes,
      sha256: descriptor.sha256,
    })),
  );
  const attestedDescriptors = new Map<string, RuntimeProjectDescriptor>();
  for (const descriptor of [
    ...parentProfile.projectSources,
    ...runtimeProfile.projectSources,
  ]) {
    const prior = attestedDescriptors.get(descriptor.path);
    if (
      prior !== undefined &&
      (prior.bytes !== descriptor.bytes || prior.sha256 !== descriptor.sha256)
    ) {
      return bootstrapFailure(
        'bootstrap-descriptor-conflict',
        descriptor.path,
        'Parent and selected-child profiles disagree on one runtime descriptor.',
      );
    }
    attestedDescriptors.set(descriptor.path, descriptor);
  }
  admitServiceFastAttestedRuntimeDescriptorBytes(attestedDescriptors.values());
  const attestedPaths = [...attestedDescriptors.keys()];
  const ignoredPaths = readGitIgnoredPaths(repositoryRoot, attestedPaths);
  await auditServiceFastRuntimeImports({
    repositoryRoot,
    profile: parentProfile,
    trackedPaths: stateBefore.trackedPaths,
    ignoredPaths,
  });
  await auditServiceFastRuntimeImports({
    repositoryRoot,
    profile: runtimeProfile,
    trackedPaths: stateBefore.trackedPaths,
    ignoredPaths,
  });

  {
    const closureAfter = await readBoundRegularFile(
      repositoryRoot,
      SOURCE_CLOSURE_PATH,
      SOURCE_CLOSURE_MAX_BYTES,
      closureBytes.byteLength,
    );
    if (
      closureAfter.byteLength !== closureBytes.byteLength ||
      sha256Bytes(closureAfter) !== sha256Bytes(closureBytes)
    ) {
      return bootstrapFailure('bootstrap-closure-snapshot-mismatch', SOURCE_CLOSURE_PATH, 'Source closure changed after durable runtime admission.');
    }
  }
  {
    const profileAfter = await readBoundRegularFile(
      repositoryRoot,
      SERVICE_FAST_DURABLE_RUNTIME_PROFILE_PATH,
      SERVICE_FAST_MAX_BOUND_SOURCE_BYTES,
      profileDescriptor.bytes,
    );
    requireDescriptorBytes(profileAfter, profileDescriptor);
  }
  for (const descriptor of attestedDescriptors.values()) {
    const bytes = await readBoundRegularFile(
      repositoryRoot,
      descriptor.path,
      SERVICE_FAST_MAX_BOUND_SOURCE_BYTES,
      descriptor.bytes,
    );
    requireDescriptorBytes(bytes, descriptor);
  }
  const stateAfter = dispatchRepositoryState(repositoryRoot);
  if (stateAfter.fingerprint !== stateBefore.fingerprint) {
    return bootstrapFailure('bootstrap-repository-snapshot-mismatch', repositoryRoot, 'Durable dispatch repository state changed during admission.');
  }
  verifyDurableServiceFastSourceClosure(repositoryRoot, closureBytes);
}
