import { lstat, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';

import {
  SERVICE_FAST_CONFIG_BYTES,
  SERVICE_FAST_CONFIG_PATH,
  SERVICE_FAST_MAX_BOUND_SOURCE_BYTES,
  descriptorForBytes,
  descriptorsEqual,
  encodeServiceFastSourceClosure,
  parseFrozenServiceFastConfiguration,
  sha256Bytes,
  type FrozenServiceFastConfiguration,
  type ServiceFastSourceClosure,
  type SourceClosureDescriptor,
  type SourceClosureEntry,
} from './codec.ts';
import {
  assertCleanTrackedRepository,
  readGitBlob,
  readGitIgnoredPaths,
  requireSourceClosureRevision,
  type GitIndexEntry,
  type GitTreeEntry,
} from './git.ts';
import { publishCanonicalSourceClosure } from './publication.ts';
import {
  auditServiceFastRuntimeImports,
  generationChildRuntimeAuditProfile,
  noArgumentParentRuntimeAuditProfile,
  SERVICE_FAST_GENERATION_CHILD_RUNTIME_PATHS,
  SERVICE_FAST_NO_ARGUMENT_PARENT_RUNTIME_PATHS,
} from '../tooling/runtime-import-audit.ts';
import {
  admitPreSourceClosureArtifactSizes,
  type PreSourceClosureSizeAdmission,
} from '../tooling/size-admission.ts';
import {
  SERVICE_FAST_REVIEWED_INPUT_BINDING_PATH,
  decodeReviewedInputBindingSource,
  requireReviewedInputBinding,
} from './reviewed-input-binding.ts';
import {
  compareClosureToRevision,
  rolesForPath,
  sourcePathOrder,
  treeEntriesForRoot,
  treeEntryForFile,
  verifyFrozenAuthoritiesAtRevision,
  verifyFrozenProtectedSourcesAtRevision,
} from './revision-admission.ts';
import {
  ServiceFastSourceClosureError,
  sourceClosureFailure,
} from './error.ts';
import {
  ServiceFastBoundedIdentityReadError,
  readBoundedIdentityFile,
} from '../tooling/bounded-identity-reader.ts';

export interface PreparedServiceFastSourceClosure {
  readonly closure: ServiceFastSourceClosure;
  readonly bytes: Uint8Array;
  readonly sizeAdmission: PreSourceClosureSizeAdmission;
}

export { ServiceFastSourceClosureError } from './error.ts';

async function inspectRepositoryFilesystem<T>(
  artifact: string,
  operation: () => Promise<T>,
): Promise<T> {
  try {
    return await operation();
  } catch {
    return sourceClosureFailure(
      'filesystem-inspection-failure',
      artifact,
      `Could not inspect required repository path ${artifact}.`,
    );
  }
}

function compareRawUtf16(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

async function assertNoSymlinkComponents(
  repositoryRoot: string,
  relativePath: string,
  targetKind: 'file' | 'directory',
): Promise<void> {
  const rootReal = await inspectRepositoryFilesystem(repositoryRoot, () => realpath(repositoryRoot));
  const absolutePath = path.join(repositoryRoot, relativePath);
  let cursor = repositoryRoot;
  const segments = relativePath.split('/');
  for (const [index, segment] of segments.entries()) {
    cursor = path.join(cursor, segment);
    const stats = await inspectRepositoryFilesystem(relativePath, () => lstat(cursor));
    if (stats.isSymbolicLink()) {
      return sourceClosureFailure('symlink-source-forbidden', relativePath, `Source ${relativePath} contains a symlink component.`);
    }
    const isTarget = index === segments.length - 1;
    if (!isTarget && !stats.isDirectory()) {
      return sourceClosureFailure('invalid-source-parent', relativePath, `Source ${relativePath} has a non-directory parent.`);
    }
    if (isTarget && targetKind === 'file' && !stats.isFile()) {
      return sourceClosureFailure('nonregular-source', relativePath, `Source ${relativePath} is not a regular file.`);
    }
    if (isTarget && targetKind === 'directory' && !stats.isDirectory()) {
      return sourceClosureFailure('non-directory-root', relativePath, `Implementation root ${relativePath} is not a directory.`);
    }
  }
  const targetReal = await inspectRepositoryFilesystem(relativePath, () => realpath(absolutePath));
  if (targetReal !== path.join(rootReal, relativePath)) {
    return sourceClosureFailure('symlink-source-forbidden', relativePath, `Source ${relativePath} resolves outside its canonical path.`);
  }
}

async function enumerateFilesystemRoot(
  repositoryRoot: string,
  rootPath: string,
  maximumEntries: number,
): Promise<readonly string[]> {
  await assertNoSymlinkComponents(repositoryRoot, rootPath, 'directory');
  const files: string[] = [];
  const pending = [rootPath];
  while (pending.length > 0) {
    const directory = pending.pop() as string;
    const names = await inspectRepositoryFilesystem(directory, () =>
      readdir(path.join(repositoryRoot, directory)));
    names.sort(compareRawUtf16);
    for (let index = names.length - 1; index >= 0; index -= 1) {
      const name = names[index];
      if (name === undefined) continue;
      const relativePath = `${directory}/${name}`;
      const stats = await inspectRepositoryFilesystem(relativePath, () =>
        lstat(path.join(repositoryRoot, relativePath)));
      if (stats.isSymbolicLink()) {
        return sourceClosureFailure('symlink-source-forbidden', relativePath, `Implementation root contains symlink ${relativePath}.`);
      }
      if (stats.isDirectory()) pending.push(relativePath);
      else if (stats.isFile()) files.push(relativePath);
      else return sourceClosureFailure('nonregular-source', relativePath, `Implementation root contains nonregular source ${relativePath}.`);
      if (files.length + pending.length > maximumEntries) {
        return sourceClosureFailure('source-entry-cap-exceeded', rootPath, 'Filesystem enumeration exceeds the frozen source cap.');
      }
    }
  }
  return Object.freeze(files.sort(compareRawUtf16));
}

async function crossCheckFilesystemRoots(
  repositoryRoot: string,
  revision: string,
  config: FrozenServiceFastConfiguration,
): Promise<void> {
  const section = config.artifacts.sourceClosure;
  for (const rootPath of section.implementationRoots) {
    const revisionPaths = treeEntriesForRoot(repositoryRoot, revision, rootPath).map((entry) => entry.path);
    const filesystemPaths = await enumerateFilesystemRoot(repositoryRoot, rootPath, section.maxSourceEntries);
    if (
      revisionPaths.length !== filesystemPaths.length ||
      revisionPaths.some((relativePath, index) => relativePath !== filesystemPaths[index])
    ) {
      return sourceClosureFailure('filesystem-revision-tree-mismatch', rootPath, `Filesystem contents do not exactly match revision tree ${revision}.`);
    }
  }
}

function assertIndexEntryMatches(
  relativePath: string,
  treeEntry: GitTreeEntry,
  indexByPath: ReadonlyMap<string, GitIndexEntry>,
): void {
  const indexEntry = indexByPath.get(relativePath);
  if (
    indexEntry === undefined ||
    indexEntry.stage !== 0 ||
    indexEntry.mode !== treeEntry.mode ||
    indexEntry.objectId !== treeEntry.objectId
  ) {
    sourceClosureFailure('tracked-stage-zero-mismatch', relativePath, `Source ${relativePath} is not the exact tracked stage-zero revision file.`);
  }
}

async function descriptorFromFilesystemAndRevision(
  repositoryRoot: string,
  revision: string,
  relativePath: string,
  indexByPath: ReadonlyMap<string, GitIndexEntry>,
): Promise<SourceClosureDescriptor> {
  const treeEntry = treeEntryForFile(repositoryRoot, revision, relativePath);
  assertIndexEntryMatches(relativePath, treeEntry, indexByPath);
  const revisionBytes = readGitBlob(
    repositoryRoot,
    revision,
    relativePath,
    SERVICE_FAST_MAX_BOUND_SOURCE_BYTES,
  );
  let bytes: Uint8Array;
  try {
    bytes = await readBoundedIdentityFile({
      repositoryRoot,
      relativePath,
      maximumBytes: SERVICE_FAST_MAX_BOUND_SOURCE_BYTES,
      expectedBytes: revisionBytes.byteLength,
    });
  } catch (error) {
    if (error instanceof ServiceFastBoundedIdentityReadError) {
      return sourceClosureFailure(
        error.code === 'bounded-file-symlink-forbidden'
          ? 'symlink-source-forbidden'
          : error.code === 'bounded-file-identity-mismatch'
            ? 'filesystem-source-identity-mismatch'
            : 'source-byte-cap-or-identity-mismatch',
        relativePath,
        `Source ${relativePath} failed bounded identity admission.`,
      );
    }
    throw error;
  }
  if (revisionBytes.byteLength !== bytes.byteLength || sha256Bytes(revisionBytes) !== sha256Bytes(bytes)) {
    return sourceClosureFailure('filesystem-revision-byte-mismatch', relativePath, `Source ${relativePath} bytes do not match revision ${revision}.`);
  }
  return descriptorForBytes(relativePath, bytes);
}

async function loadFrozenConfigFromFilesystem(
  repositoryRoot: string,
): Promise<{ readonly config: FrozenServiceFastConfiguration; readonly bytes: Uint8Array }> {
  let bytes: Uint8Array;
  try {
    bytes = await readBoundedIdentityFile({
      repositoryRoot,
      relativePath: SERVICE_FAST_CONFIG_PATH,
      maximumBytes: SERVICE_FAST_CONFIG_BYTES,
      expectedBytes: SERVICE_FAST_CONFIG_BYTES,
    });
  } catch (error) {
    if (error instanceof ServiceFastBoundedIdentityReadError) {
      return sourceClosureFailure(
        'filesystem-inspection-failure',
        SERVICE_FAST_CONFIG_PATH,
        'Frozen config failed bounded identity admission.',
      );
    }
    throw error;
  }
  return Object.freeze({ config: parseFrozenServiceFastConfiguration(bytes), bytes });
}

async function readCurrentDescriptorBytes(
  repositoryRoot: string,
  descriptor: SourceClosureDescriptor,
): Promise<Uint8Array> {
  try {
    const bytes = await readBoundedIdentityFile({
      repositoryRoot,
      relativePath: descriptor.path,
      maximumBytes: SERVICE_FAST_MAX_BOUND_SOURCE_BYTES,
      expectedBytes: descriptor.bytes,
    });
    if (sha256Bytes(bytes) !== descriptor.sha256) {
      return sourceClosureFailure(
        'filesystem-descriptor-mismatch',
        descriptor.path,
        `Current bytes for ${descriptor.path} differ from its admitted descriptor.`,
      );
    }
    return bytes;
  } catch (error) {
    if (error instanceof ServiceFastSourceClosureError) throw error;
    if (error instanceof ServiceFastBoundedIdentityReadError) {
      return sourceClosureFailure(
        'filesystem-descriptor-admission-failure',
        descriptor.path,
        `Current bytes for ${descriptor.path} failed bounded identity admission.`,
      );
    }
    throw error;
  }
}

export async function prepareServiceFastSourceClosure(
  repositoryRoot: string,
  implementationInputRevision: string,
): Promise<PreparedServiceFastSourceClosure> {
  requireSourceClosureRevision(implementationInputRevision);
  const indexByPath = assertCleanTrackedRepository(repositoryRoot, implementationInputRevision);
  const loaded = await loadFrozenConfigFromFilesystem(repositoryRoot);
  const config = loaded.config;
  const configDescriptor = await descriptorFromFilesystemAndRevision(
    repositoryRoot,
    implementationInputRevision,
    SERVICE_FAST_CONFIG_PATH,
    indexByPath,
  );
  if (configDescriptor.bytes !== SERVICE_FAST_CONFIG_BYTES) {
    return sourceClosureFailure('config-descriptor-mismatch', SERVICE_FAST_CONFIG_PATH, 'Frozen config byte count changed during generation.');
  }
  verifyFrozenAuthoritiesAtRevision(repositoryRoot, implementationInputRevision, config);
  verifyFrozenProtectedSourcesAtRevision(repositoryRoot, implementationInputRevision, config);
  await crossCheckFilesystemRoots(repositoryRoot, implementationInputRevision, config);
  const artifactSchema = await descriptorFromFilesystemAndRevision(
    repositoryRoot,
    implementationInputRevision,
    config.artifactSchema.path,
    indexByPath,
  );
  if (!descriptorsEqual(artifactSchema, config.artifactSchema)) {
    return sourceClosureFailure('schema-descriptor-mismatch', artifactSchema.path, 'Artifact schema differs from its frozen config descriptor.');
  }
  const inputArtifact = await descriptorFromFilesystemAndRevision(
    repositoryRoot,
    implementationInputRevision,
    config.inputConstruction.inputArtifact.path,
    indexByPath,
  );
  const inputBytes = await readCurrentDescriptorBytes(repositoryRoot, inputArtifact);
  const reviewedInputBindingDescriptor = await descriptorFromFilesystemAndRevision(
    repositoryRoot,
    implementationInputRevision,
    SERVICE_FAST_REVIEWED_INPUT_BINDING_PATH,
    indexByPath,
  );
  const reviewedInputBindingBytes = await readCurrentDescriptorBytes(
    repositoryRoot,
    reviewedInputBindingDescriptor,
  );
  requireReviewedInputBinding(
    decodeReviewedInputBindingSource(reviewedInputBindingBytes),
    inputArtifact,
  );
  const sizeAdmission = admitPreSourceClosureArtifactSizes(inputBytes, config);
  if (!descriptorsEqual(sizeAdmission.inputWidths.descriptor, inputArtifact)) {
    return sourceClosureFailure('input-descriptor-mismatch', inputArtifact.path, 'Size admission did not preserve the committed input descriptor.');
  }

  const sources: SourceClosureEntry[] = [];
  for (const relativePath of sourcePathOrder(repositoryRoot, implementationInputRevision, config)) {
    const descriptor = await descriptorFromFilesystemAndRevision(
      repositoryRoot,
      implementationInputRevision,
      relativePath,
      indexByPath,
    );
    sources.push(Object.freeze({
      roles: rolesForPath(relativePath, config),
      path: descriptor.path,
      bytes: descriptor.bytes,
      sha256: descriptor.sha256,
    }));
  }
  const protectedSources: SourceClosureDescriptor[] = [];
  const frozenProtected = Object.values(config.protectedRuntimeSources);
  for (const [index, relativePath] of config.artifacts.sourceClosure.protectedPaths.entries()) {
    const descriptor = await descriptorFromFilesystemAndRevision(
      repositoryRoot,
      implementationInputRevision,
      relativePath,
      indexByPath,
    );
    const expectedDescriptor = frozenProtected[index];
    if (expectedDescriptor === undefined || !descriptorsEqual(descriptor, expectedDescriptor)) {
      return sourceClosureFailure('protected-descriptor-mismatch', relativePath, 'Protected runtime source differs from its frozen config descriptor.');
    }
    protectedSources.push(descriptor);
  }
  const closure: ServiceFastSourceClosure = Object.freeze({
    schemaVersion: 'routelab.service-fast-numerical-source-closure.v1',
    experimentId: 'm7c-core12-service-fast-numerical-v1',
    implementationInputRevision,
    observationPerformed: false,
    config: configDescriptor,
    artifactSchema,
    inputArtifact,
    sources: Object.freeze(sources),
    protectedSources: Object.freeze(protectedSources),
  });
  const bytes = encodeServiceFastSourceClosure(closure, config);
  compareClosureToRevision(repositoryRoot, closure, config);
  const runtimeDescriptors = sources.map((entry) => Object.freeze({
    path: entry.path,
    bytes: entry.bytes,
    sha256: entry.sha256,
  }));
  const trackedPaths = new Set(indexByPath.keys());
  const ignoredPaths = readGitIgnoredPaths(
    repositoryRoot,
    Object.freeze([...new Set([
      ...SERVICE_FAST_NO_ARGUMENT_PARENT_RUNTIME_PATHS,
      ...SERVICE_FAST_GENERATION_CHILD_RUNTIME_PATHS,
    ])]),
  );
  await auditServiceFastRuntimeImports({
    repositoryRoot,
    profile: noArgumentParentRuntimeAuditProfile(runtimeDescriptors),
    trackedPaths,
    ignoredPaths,
  });
  await auditServiceFastRuntimeImports({
    repositoryRoot,
    profile: generationChildRuntimeAuditProfile(runtimeDescriptors),
    trackedPaths,
    ignoredPaths,
  });
  assertCleanTrackedRepository(repositoryRoot, implementationInputRevision);
  return Object.freeze({ closure, bytes, sizeAdmission });
}

export async function generateServiceFastSourceClosure(
  repositoryRoot: string,
  implementationInputRevision: string,
): Promise<PreparedServiceFastSourceClosure> {
  const prepared = await prepareServiceFastSourceClosure(
    repositoryRoot,
    implementationInputRevision,
  );
  const loaded = await loadFrozenConfigFromFilesystem(repositoryRoot);
  assertCleanTrackedRepository(repositoryRoot, implementationInputRevision);
  await publishCanonicalSourceClosure(
    path.join(repositoryRoot, loaded.config.artifacts.sourceClosure.path),
    prepared.bytes,
    loaded.config.artifacts.sourceClosure.maxBytes,
  );
  return prepared;
}
