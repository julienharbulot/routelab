import { join } from 'node:path';

import {
  parseAndVerifyCanonicalSinglePathRouterCase,
  type CanonicalSinglePathRouterCase,
  type CanonicalSinglePathRouterCaseParseError,
} from '../../serialization/canonical-router-case/index.ts';
import type { ExactInputSinglePathSearchSummary } from '../../router/single-path/index.ts';

export const OFFLINE_ROUTER_BENCHMARK_REPORT_SCHEMA_VERSION =
  'routelab.benchmark-report.v1';

export const OFFLINE_ROUTER_BENCHMARK_LIMITATIONS = Object.freeze([
  'one observed verification per case; no warmup or repetition',
  'timings are non-statistical observations, not performance conclusions',
  'inputs are fixed offline repository cases',
  'routing is bounded exact-replayed single-path only',
  'no live service, transaction submission, custody, or protocol execution',
] as const);

export interface OfflineRouterCaseDirectoryEntry {
  readonly name: string;
  readonly isFile: boolean;
}

export interface OfflineRouterBenchmarkDependencies {
  readonly readDirectory: (
    directory: string,
  ) => Promise<readonly OfflineRouterCaseDirectoryEntry[]>;
  readonly readFile: (path: string) => Promise<string>;
  readonly now: () => bigint;
}

export interface OfflineRouterBenchmarkEnvironment {
  readonly nodeVersion: string;
  readonly platform: string;
  readonly arch: string;
}

export interface DiscoveredOfflineRouterCase {
  readonly filename: string;
  readonly canonicalCaseJson: string;
  readonly case: CanonicalSinglePathRouterCase;
  readonly elapsedNanoseconds: bigint;
}

export interface CaseDirectoryReadFailedError {
  readonly code: 'case-directory-read-failed';
  readonly directory: string;
}

export interface CaseFileReadFailedError {
  readonly code: 'case-file-read-failed';
  readonly filename: string;
}

export interface InvalidRouterCaseFileError {
  readonly code: 'invalid-router-case-file';
  readonly filename: string;
  readonly caseError: CanonicalSinglePathRouterCaseParseError;
}

export interface DuplicateRouterCaseIdError {
  readonly code: 'duplicate-router-case-id';
  readonly caseId: string;
  readonly firstFilename: string;
  readonly duplicateFilename: string;
}

export interface NegativeElapsedTimeError {
  readonly code: 'negative-elapsed-time';
  readonly filename: string;
}

export type OfflineRouterCaseDiscoveryError =
  | CaseDirectoryReadFailedError
  | CaseFileReadFailedError
  | InvalidRouterCaseFileError
  | DuplicateRouterCaseIdError
  | NegativeElapsedTimeError;

export type OfflineRouterCaseDiscoveryResult =
  | { readonly ok: true; readonly value: readonly DiscoveredOfflineRouterCase[] }
  | { readonly ok: false; readonly error: OfflineRouterCaseDiscoveryError };

export interface OfflineRouterBenchmarkSemanticCase {
  readonly filename: string;
  readonly caseId: string;
  readonly determinismHash: string;
  readonly status: 'success' | 'no-route' | 'no-plan';
  readonly search: ExactInputSinglePathSearchSummary;
  readonly canonicalCaseJson: string;
  readonly canonicalRunJson: string;
}

export interface OfflineRouterBenchmarkSemantics {
  readonly caseDirectory: string;
  readonly caseCount: number;
  readonly cases: readonly OfflineRouterBenchmarkSemanticCase[];
}

export interface OfflineRouterBenchmarkObservationCase {
  readonly filename: string;
  readonly elapsedNanoseconds: string;
}

export interface OfflineRouterBenchmarkObservations {
  readonly environment: OfflineRouterBenchmarkEnvironment;
  readonly cases: readonly OfflineRouterBenchmarkObservationCase[];
}

export interface OfflineRouterBenchmarkReport {
  readonly schemaVersion: typeof OFFLINE_ROUTER_BENCHMARK_REPORT_SCHEMA_VERSION;
  readonly semantics: OfflineRouterBenchmarkSemantics;
  readonly observations: OfflineRouterBenchmarkObservations;
  readonly limitations: typeof OFFLINE_ROUTER_BENCHMARK_LIMITATIONS;
}

export interface OfflineRouterBenchmarkReportValue {
  readonly report: OfflineRouterBenchmarkReport;
  readonly canonicalJson: string;
}

export type OfflineRouterBenchmarkReportResult =
  | { readonly ok: true; readonly value: OfflineRouterBenchmarkReportValue }
  | { readonly ok: false; readonly error: OfflineRouterCaseDiscoveryError };

function rawUtf16Compare(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function failure(error: OfflineRouterCaseDiscoveryError) {
  return Object.freeze({ ok: false as const, error });
}

function searchSummary(caseValue: CanonicalSinglePathRouterCase) {
  const result = caseValue.run.routerResult;
  return result.status === 'success' ? result.plan.search : result.search;
}

function freezeSearch(
  search: ExactInputSinglePathSearchSummary,
): ExactInputSinglePathSearchSummary {
  return Object.freeze({
    expansions: search.expansions,
    enumeratedCandidates: search.enumeratedCandidates,
    replayedCandidates: search.replayedCandidates,
    rejectedCandidates: search.rejectedCandidates,
    termination: search.termination,
  });
}

export async function discoverOfflineRouterCases(
  directory: string,
  dependencies: OfflineRouterBenchmarkDependencies,
): Promise<OfflineRouterCaseDiscoveryResult> {
  let sourceEntries: readonly OfflineRouterCaseDirectoryEntry[];
  try {
    sourceEntries = await dependencies.readDirectory(directory);
  } catch {
    const error: CaseDirectoryReadFailedError = Object.freeze({
      code: 'case-directory-read-failed',
      directory,
    });
    return failure(error);
  }

  const filenames = sourceEntries
    .map((entry) => ({ name: entry.name, isFile: entry.isFile }))
    .filter((entry) => entry.isFile && entry.name.endsWith('.json'))
    .map((entry) => entry.name)
    .sort(rawUtf16Compare);
  const discovered: DiscoveredOfflineRouterCase[] = [];
  const filenamesByCaseId = new Map<string, string>();

  for (const filename of filenames) {
    const startedAt = dependencies.now();
    let canonicalCaseJson: string;
    try {
      canonicalCaseJson = await dependencies.readFile(join(directory, filename));
    } catch {
      const error: CaseFileReadFailedError = Object.freeze({
        code: 'case-file-read-failed',
        filename,
      });
      return failure(error);
    }

    const parsed = parseAndVerifyCanonicalSinglePathRouterCase(canonicalCaseJson);
    if (!parsed.ok) {
      const error: InvalidRouterCaseFileError = Object.freeze({
        code: 'invalid-router-case-file',
        filename,
        caseError: parsed.error,
      });
      return failure(error);
    }

    const finishedAt = dependencies.now();
    const elapsedNanoseconds = finishedAt - startedAt;
    if (elapsedNanoseconds < 0n) {
      const error: NegativeElapsedTimeError = Object.freeze({
        code: 'negative-elapsed-time',
        filename,
      });
      return failure(error);
    }

    const firstFilename = filenamesByCaseId.get(parsed.value.caseId);
    if (firstFilename !== undefined) {
      const error: DuplicateRouterCaseIdError = Object.freeze({
        code: 'duplicate-router-case-id',
        caseId: parsed.value.caseId,
        firstFilename,
        duplicateFilename: filename,
      });
      return failure(error);
    }
    filenamesByCaseId.set(parsed.value.caseId, filename);

    discovered.push(
      Object.freeze({
        filename,
        canonicalCaseJson,
        case: parsed.value,
        elapsedNanoseconds,
      }),
    );
  }

  return Object.freeze({ ok: true, value: Object.freeze(discovered) });
}

export async function createOfflineRouterBenchmarkReport(
  directory: string,
  dependencies: OfflineRouterBenchmarkDependencies,
  environment: OfflineRouterBenchmarkEnvironment,
): Promise<OfflineRouterBenchmarkReportResult> {
  const discovery = await discoverOfflineRouterCases(directory, dependencies);
  if (!discovery.ok) return failure(discovery.error);

  const semanticCases = Object.freeze(
    discovery.value.map((entry) =>
      Object.freeze({
        filename: entry.filename,
        caseId: entry.case.caseId,
        determinismHash: entry.case.run.determinismHash,
        status: entry.case.run.routerResult.status,
        search: freezeSearch(searchSummary(entry.case)),
        canonicalCaseJson: entry.canonicalCaseJson,
        canonicalRunJson: entry.case.run.canonicalJson,
      }),
    ),
  );
  const semantics: OfflineRouterBenchmarkSemantics = Object.freeze({
    caseDirectory: directory,
    caseCount: semanticCases.length,
    cases: semanticCases,
  });

  const capturedEnvironment: OfflineRouterBenchmarkEnvironment = Object.freeze({
    nodeVersion: environment.nodeVersion,
    platform: environment.platform,
    arch: environment.arch,
  });
  const observationCases = Object.freeze(
    discovery.value.map((entry) =>
      Object.freeze({
        filename: entry.filename,
        elapsedNanoseconds: entry.elapsedNanoseconds.toString(10),
      }),
    ),
  );
  const observations: OfflineRouterBenchmarkObservations = Object.freeze({
    environment: capturedEnvironment,
    cases: observationCases,
  });
  const report: OfflineRouterBenchmarkReport = Object.freeze({
    schemaVersion: OFFLINE_ROUTER_BENCHMARK_REPORT_SCHEMA_VERSION,
    semantics,
    observations,
    limitations: OFFLINE_ROUTER_BENCHMARK_LIMITATIONS,
  });
  const value: OfflineRouterBenchmarkReportValue = Object.freeze({
    report,
    canonicalJson: JSON.stringify(report),
  });
  return Object.freeze({ ok: true, value });
}
