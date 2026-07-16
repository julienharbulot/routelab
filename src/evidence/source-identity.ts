import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';

export const EVIDENCE_SOURCE_SCHEMA_VERSION = 'routelab.evidence-source.v1' as const;
export const EVIDENCE_SOURCE_PATH_SET_VERSION = 'routelab.evidence-source-paths.v1' as const;

export const EVIDENCE_SOURCE_PATH_SPECS = Object.freeze([
  ':(glob)src/**/*.ts',
  ':(glob)cli/**/*.ts',
  ':(glob)scripts/**/*.ts',
  '.nvmrc',
  'eslint.config.mjs',
  'package.json',
  'pnpm-lock.yaml',
  'tsconfig.json',
  'tsconfig.build.json',
  'datasets/ethereum-mainnet/uniswap-v2/block-19000000/core12-v1/canonical-snapshot-content.json',
  'datasets/ethereum-mainnet/uniswap-v2/block-19000000/core12-v1/manifest.json',
  'datasets/ethereum-mainnet/uniswap-v2/block-19000000/core12-v1/policy.json',
  'datasets/ethereum-mainnet/uniswap-v2/block-19000000/core12-v1/reconciliation.json',
  'datasets/ethereum-mainnet/uniswap-v2/block-19000000/core12-v1/snapshot.json',
  'datasets/ethereum-mainnet/uniswap-v2/block-19000000/core12-v1/sources/infura-normalized.json',
  'datasets/ethereum-mainnet/uniswap-v2/block-19000000/core12-v1/sources/sqd-normalized.json',
]);

export interface EvidenceSourceIdentity {
  readonly schemaVersion: typeof EVIDENCE_SOURCE_SCHEMA_VERSION;
  readonly revision: string;
  readonly pathSet: {
    readonly schemaVersion: string;
    readonly paths: readonly string[];
  };
  readonly digest: string;
}

interface EvidenceSourceOptions {
  readonly pathSetVersion?: string;
  readonly pathSpecs?: readonly string[];
}

function git(root: string, arguments_: readonly string[]): string {
  return execFileSync('git', arguments_, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function ordered(values: readonly string[]): readonly string[] {
  return Object.freeze([...values].sort((left, right) => left < right ? -1 : left > right ? 1 : 0));
}

function relevantPaths(root: string, pathSpecs: readonly string[]): readonly string[] {
  const paths = git(root, ['ls-files', '-z', '--', ...pathSpecs])
    .split('\0')
    .filter((value) => value.length > 0);
  const result = ordered(paths);
  if (result.length === 0) throw new Error('Evidence source path set resolved to no tracked files.');
  return result;
}

function dirtyRelevantPaths(root: string, pathSpecs: readonly string[]): string {
  return git(root, [
    'status',
    '--porcelain=v1',
    '--untracked-files=all',
    '--',
    ...pathSpecs,
  ]).trim();
}

export function computeEvidenceSourceDigest(root: string, paths: readonly string[]): string {
  const hash = createHash('sha256').update('routelab.evidence-source-digest.v1\0');
  for (const file of ordered(paths)) {
    const contents = readFileSync(path.join(root, file));
    hash.update(`${Buffer.byteLength(file, 'utf8')}\0${file}\0${contents.byteLength}\0`);
    hash.update(contents);
  }
  return `sha256:${hash.digest('hex')}`;
}

function readIdentity(root: string, options: EvidenceSourceOptions): EvidenceSourceIdentity {
  const pathSpecs = options.pathSpecs ?? EVIDENCE_SOURCE_PATH_SPECS;
  const paths = relevantPaths(root, pathSpecs);
  const revision = git(root, ['rev-parse', 'HEAD']).trim();
  if (!/^[0-9a-f]{40}$/u.test(revision)) {
    throw new Error('Evidence source requires a full 40-character Git revision.');
  }
  return Object.freeze({
    schemaVersion: EVIDENCE_SOURCE_SCHEMA_VERSION,
    revision,
    pathSet: Object.freeze({
      schemaVersion: options.pathSetVersion ?? EVIDENCE_SOURCE_PATH_SET_VERSION,
      paths,
    }),
    digest: computeEvidenceSourceDigest(root, paths),
  });
}

export function inspectEvidenceSource(
  root = process.cwd(),
  options: EvidenceSourceOptions = {},
): EvidenceSourceIdentity {
  return readIdentity(root, options);
}

export function captureEvidenceSource(
  root = process.cwd(),
  options: EvidenceSourceOptions = {},
): EvidenceSourceIdentity {
  const pathSpecs = options.pathSpecs ?? EVIDENCE_SOURCE_PATH_SPECS;
  const before = dirtyRelevantPaths(root, pathSpecs);
  if (before.length !== 0) {
    throw new Error(`Retained evidence requires clean relevant paths:\n${before}`);
  }
  const identity = readIdentity(root, options);
  const after = dirtyRelevantPaths(root, pathSpecs);
  const revisionAfter = git(root, ['rev-parse', 'HEAD']).trim();
  if (after.length !== 0 || revisionAfter !== identity.revision) {
    throw new Error('Evidence source changed while its identity was being captured.');
  }
  return identity;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

export function verifyEvidenceSource(
  input: unknown,
  root = process.cwd(),
  options: EvidenceSourceOptions = {},
): readonly string[] {
  const issues: string[] = [];
  const source = record(input);
  const pathSet = record(source?.['pathSet']);
  const paths = pathSet?.['paths'];
  if (source?.['schemaVersion'] !== EVIDENCE_SOURCE_SCHEMA_VERSION) {
    issues.push('Unexpected evidence-source schema.');
  }
  if (typeof source?.['revision'] !== 'string' || !/^[0-9a-f]{40}$/u.test(source['revision'])) {
    issues.push('Evidence source revision is not a full 40-character SHA.');
  }
  const expectedPathSetVersion = options.pathSetVersion ?? EVIDENCE_SOURCE_PATH_SET_VERSION;
  if (pathSet?.['schemaVersion'] !== expectedPathSetVersion) {
    issues.push('Unexpected evidence-source path-set schema.');
  }
  if (
    !Array.isArray(paths)
    || paths.length === 0
    || paths.some((value) => typeof value !== 'string' || value.length === 0)
  ) {
    issues.push('Evidence source path list is invalid.');
  }
  if (typeof source?.['digest'] !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(source['digest'])) {
    issues.push('Evidence source digest is invalid.');
  }
  if (issues.length !== 0) return Object.freeze(issues);

  try {
    const pathSpecs = options.pathSpecs ?? EVIDENCE_SOURCE_PATH_SPECS;
    const expectedPaths = relevantPaths(root, pathSpecs);
    const recordedPaths = paths as readonly string[];
    if (JSON.stringify(recordedPaths) !== JSON.stringify(expectedPaths)) {
      issues.push('Evidence source path list changed.');
    }
    if (source?.['digest'] !== computeEvidenceSourceDigest(root, expectedPaths)) {
      issues.push('Evidence source digest does not match the current executable tree.');
    }
    if (dirtyRelevantPaths(root, pathSpecs).length !== 0) {
      issues.push('Relevant evidence-source paths are dirty.');
    }
  } catch {
    issues.push('Could not recompute the evidence source identity.');
  }
  return Object.freeze(issues);
}
