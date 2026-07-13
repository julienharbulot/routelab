import { join } from 'node:path';

import {
  parseAndVerifyCanonicalSplitRouterCase,
  type CanonicalSplitRouterCase,
  type CanonicalSplitRouterCaseParseError,
} from '../../serialization/canonical-split-router-case/index.ts';
import type {
  ExactInputSplitRuntimeSearchSummary,
  ExactInputSplitWorkCaps,
} from '../../router/anytime-exact-input-split/index.ts';

export const OFFLINE_SPLIT_CASE_VERIFICATION_SCHEMA_VERSION =
  'routelab.split-case-verification.v1';

export const OFFLINE_SPLIT_CASE_VERIFICATION_LIMITATIONS = Object.freeze([
  'fixed offline fixture evidence only',
  'no performance or throughput conclusion',
  'no unrestricted global-optimality claim',
  'no live service, transaction, custody, or protocol execution',
] as const);

export interface OfflineSplitCaseDirectoryEntry {
  readonly name: string;
  readonly isFile: boolean;
}

export interface OfflineSplitCaseVerificationDependencies {
  readonly readDirectory: (
    directory: string,
  ) => Promise<readonly OfflineSplitCaseDirectoryEntry[]>;
  readonly readFile: (path: string) => Promise<string>;
}

export interface SplitCaseDirectoryReadFailedError {
  readonly code: 'split-case-directory-read-failed';
  readonly directory: string;
}

export interface SplitCaseEntryNotFileError {
  readonly code: 'split-case-entry-not-file';
  readonly filename: string;
}

export interface SplitCaseFileReadFailedError {
  readonly code: 'split-case-file-read-failed';
  readonly filename: string;
}

export interface InvalidSplitRouterCaseFileError {
  readonly code: 'invalid-split-router-case-file';
  readonly filename: string;
  readonly caseError: CanonicalSplitRouterCaseParseError;
}

export interface DuplicateSplitRouterCaseIdError {
  readonly code: 'duplicate-split-router-case-id';
  readonly caseId: string;
  readonly firstFilename: string;
  readonly duplicateFilename: string;
}

export type OfflineSplitCaseVerificationError =
  | SplitCaseDirectoryReadFailedError
  | SplitCaseEntryNotFileError
  | SplitCaseFileReadFailedError
  | InvalidSplitRouterCaseFileError
  | DuplicateSplitRouterCaseIdError;

export interface OfflineSplitCaseVerificationCase {
  readonly filename: string;
  readonly caseId: string;
  readonly determinismHash: string;
  readonly status: 'success' | 'no-route' | 'no-plan';
  readonly termination: 'complete' | 'work-limit';
  readonly amountIn: string;
  readonly amountOut: string | null;
  readonly workCaps: ExactInputSplitWorkCaps;
  readonly counters: ExactInputSplitRuntimeSearchSummary['counters'];
}

export interface OfflineSplitCaseVerificationSummary {
  readonly schemaVersion: typeof OFFLINE_SPLIT_CASE_VERIFICATION_SCHEMA_VERSION;
  readonly caseDirectory: string;
  readonly caseCount: number;
  readonly cases: readonly OfflineSplitCaseVerificationCase[];
  readonly limitations: typeof OFFLINE_SPLIT_CASE_VERIFICATION_LIMITATIONS;
}

export interface OfflineSplitCaseVerificationValue {
  readonly summary: OfflineSplitCaseVerificationSummary;
  readonly canonicalJson: string;
}

export type OfflineSplitCaseVerificationResult =
  | { readonly ok: true; readonly value: OfflineSplitCaseVerificationValue }
  | { readonly ok: false; readonly error: OfflineSplitCaseVerificationError };

function rawUtf16Compare(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function failure(error: OfflineSplitCaseVerificationError) {
  return Object.freeze({ ok: false as const, error });
}

function freezeCaps(caps: ExactInputSplitWorkCaps): ExactInputSplitWorkCaps {
  return Object.freeze({ ...caps });
}

function searchSummary(caseValue: CanonicalSplitRouterCase) {
  const result = caseValue.run.routerResult;
  return result.status === 'success' ? result.plan.search : result.search;
}

function projectCase(
  filename: string,
  caseValue: CanonicalSplitRouterCase,
): OfflineSplitCaseVerificationCase {
  const parsedRun = JSON.parse(caseValue.run.canonicalJson) as {
    readonly request: { readonly amountIn: string };
    readonly control: ExactInputSplitWorkCaps;
  };
  const result = caseValue.run.routerResult;
  const search = searchSummary(caseValue);
  return Object.freeze({
    filename,
    caseId: caseValue.caseId,
    determinismHash: caseValue.run.determinismHash,
    status: result.status,
    termination: search.termination as 'complete' | 'work-limit',
    amountIn: parsedRun.request.amountIn,
    amountOut:
      result.status === 'success' ? result.plan.receipt.amountOut.toString(10) : null,
    workCaps: freezeCaps(parsedRun.control),
    counters: Object.freeze({ ...search.counters }),
  });
}

export async function verifyOfflineSplitRouterCases(
  directory: string,
  dependencies: OfflineSplitCaseVerificationDependencies,
): Promise<OfflineSplitCaseVerificationResult> {
  let sourceEntries: readonly OfflineSplitCaseDirectoryEntry[];
  try {
    sourceEntries = await dependencies.readDirectory(directory);
  } catch {
    return failure(
      Object.freeze({ code: 'split-case-directory-read-failed', directory }),
    );
  }

  const entries = sourceEntries.map((entry) => ({
    name: entry.name,
    isFile: entry.isFile,
  }));
  const nonfile = entries
    .filter((entry) => entry.name.endsWith('.json') && !entry.isFile)
    .sort((left, right) => rawUtf16Compare(left.name, right.name))[0];
  if (nonfile !== undefined) {
    return failure(
      Object.freeze({ code: 'split-case-entry-not-file', filename: nonfile.name }),
    );
  }

  const filenames = entries
    .filter((entry) => entry.isFile && entry.name.endsWith('.json'))
    .map((entry) => entry.name)
    .sort(rawUtf16Compare);
  const projectedCases: OfflineSplitCaseVerificationCase[] = [];
  const filenamesByCaseId = new Map<string, string>();

  for (const filename of filenames) {
    let canonicalCaseJson: string;
    try {
      canonicalCaseJson = await dependencies.readFile(join(directory, filename));
    } catch {
      return failure(
        Object.freeze({ code: 'split-case-file-read-failed', filename }),
      );
    }
    const parsed = parseAndVerifyCanonicalSplitRouterCase(canonicalCaseJson);
    if (!parsed.ok) {
      return failure(
        Object.freeze({
          code: 'invalid-split-router-case-file',
          filename,
          caseError: parsed.error,
        }),
      );
    }
    const firstFilename = filenamesByCaseId.get(parsed.value.caseId);
    if (firstFilename !== undefined) {
      return failure(
        Object.freeze({
          code: 'duplicate-split-router-case-id',
          caseId: parsed.value.caseId,
          firstFilename,
          duplicateFilename: filename,
        }),
      );
    }
    filenamesByCaseId.set(parsed.value.caseId, filename);
    projectedCases.push(projectCase(filename, parsed.value));
  }

  const summary: OfflineSplitCaseVerificationSummary = Object.freeze({
    schemaVersion: OFFLINE_SPLIT_CASE_VERIFICATION_SCHEMA_VERSION,
    caseDirectory: directory,
    caseCount: projectedCases.length,
    cases: Object.freeze(projectedCases),
    limitations: OFFLINE_SPLIT_CASE_VERIFICATION_LIMITATIONS,
  });
  const value: OfflineSplitCaseVerificationValue = Object.freeze({
    summary,
    canonicalJson: JSON.stringify(summary),
  });
  return Object.freeze({ ok: true, value });
}
