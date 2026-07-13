import {
  parseAndVerifyCanonicalSplitRouterRun,
  type CanonicalSplitRouterRun,
  type CanonicalSplitRouterRunParseError,
} from '../canonical-split-router-run/index.ts';

export const CANONICAL_SPLIT_ROUTER_CASE_SCHEMA_VERSION =
  'routelab.split-router-case.v1';

export interface InvalidSplitRouterCaseIdError {
  readonly code: 'invalid-split-router-case-id';
}

export interface InvalidSplitRouterCaseJsonError {
  readonly code: 'invalid-split-router-case-json';
}

export interface InvalidSplitRouterCaseShapeError {
  readonly code: 'invalid-split-router-case-shape';
  readonly path: string;
}

export interface UnsupportedSplitRouterCaseVersionError {
  readonly code: 'unsupported-split-router-case-version';
  readonly actual: string;
}

export interface SplitRouterCaseCanonicalMismatchError {
  readonly code: 'split-router-case-canonical-mismatch';
}

export interface CanonicalSplitRouterCase {
  readonly caseId: string;
  readonly run: CanonicalSplitRouterRun;
  readonly canonicalJson: string;
}

export type CanonicalSplitRouterCaseCreateError =
  | InvalidSplitRouterCaseIdError
  | CanonicalSplitRouterRunParseError;

export type CanonicalSplitRouterCaseCreateResult =
  | { readonly ok: true; readonly value: CanonicalSplitRouterCase }
  | { readonly ok: false; readonly error: CanonicalSplitRouterCaseCreateError };

export type CanonicalSplitRouterCaseParseError =
  | InvalidSplitRouterCaseJsonError
  | InvalidSplitRouterCaseShapeError
  | UnsupportedSplitRouterCaseVersionError
  | CanonicalSplitRouterCaseCreateError
  | SplitRouterCaseCanonicalMismatchError;

export type CanonicalSplitRouterCaseParseResult =
  | { readonly ok: true; readonly value: CanonicalSplitRouterCase }
  | { readonly ok: false; readonly error: CanonicalSplitRouterCaseParseError };

type InputObject = Record<string, unknown>;
const CASE_FIELDS = ['schemaVersion', 'caseId', 'determinismHash', 'run'] as const;

function isInputObject(value: unknown): value is InputObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function fieldError(value: InputObject): string | undefined {
  for (const field of CASE_FIELDS) {
    if (!Object.hasOwn(value, field)) return `$.${field}`;
  }
  const expected = new Set<string>(CASE_FIELDS);
  const extra = Object.keys(value)
    .filter((field) => !expected.has(field))
    .sort()[0];
  return extra === undefined ? undefined : `$.${extra}`;
}

function invalidCaseId(): InvalidSplitRouterCaseIdError {
  return Object.freeze({ code: 'invalid-split-router-case-id' });
}

function createFailure(error: CanonicalSplitRouterCaseCreateError) {
  return Object.freeze({ ok: false as const, error });
}

function parseFailure(error: CanonicalSplitRouterCaseParseError) {
  return Object.freeze({ ok: false as const, error });
}

export function createCanonicalSplitRouterCase(
  caseId: string,
  canonicalRunJson: string,
  determinismHash: string,
): CanonicalSplitRouterCaseCreateResult {
  if (typeof caseId !== 'string' || caseId.length === 0) {
    return createFailure(invalidCaseId());
  }
  const verifiedRun = parseAndVerifyCanonicalSplitRouterRun(
    canonicalRunJson,
    determinismHash,
  );
  if (!verifiedRun.ok) return createFailure(verifiedRun.error);

  const runObject: unknown = JSON.parse(verifiedRun.value.canonicalJson);
  const canonicalJson = JSON.stringify({
    schemaVersion: CANONICAL_SPLIT_ROUTER_CASE_SCHEMA_VERSION,
    caseId,
    determinismHash: verifiedRun.value.determinismHash,
    run: runObject,
  });
  const value: CanonicalSplitRouterCase = Object.freeze({
    caseId,
    run: verifiedRun.value,
    canonicalJson,
  });
  return Object.freeze({ ok: true, value });
}

export function parseAndVerifyCanonicalSplitRouterCase(
  canonicalCaseJson: string,
): CanonicalSplitRouterCaseParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(canonicalCaseJson) as unknown;
  } catch {
    return parseFailure(Object.freeze({ code: 'invalid-split-router-case-json' }));
  }

  if (!isInputObject(parsed)) {
    return parseFailure(
      Object.freeze({ code: 'invalid-split-router-case-shape', path: '$' }),
    );
  }
  const exactFieldError = fieldError(parsed);
  if (exactFieldError !== undefined) {
    return parseFailure(
      Object.freeze({
        code: 'invalid-split-router-case-shape',
        path: exactFieldError,
      }),
    );
  }
  if (typeof parsed['schemaVersion'] !== 'string') {
    return parseFailure(
      Object.freeze({
        code: 'invalid-split-router-case-shape',
        path: '$.schemaVersion',
      }),
    );
  }
  if (typeof parsed['caseId'] !== 'string') {
    return parseFailure(
      Object.freeze({
        code: 'invalid-split-router-case-shape',
        path: '$.caseId',
      }),
    );
  }
  if (typeof parsed['determinismHash'] !== 'string') {
    return parseFailure(
      Object.freeze({
        code: 'invalid-split-router-case-shape',
        path: '$.determinismHash',
      }),
    );
  }
  if (!isInputObject(parsed['run'])) {
    return parseFailure(
      Object.freeze({
        code: 'invalid-split-router-case-shape',
        path: '$.run',
      }),
    );
  }

  if (parsed['schemaVersion'] !== CANONICAL_SPLIT_ROUTER_CASE_SCHEMA_VERSION) {
    return parseFailure(
      Object.freeze({
        code: 'unsupported-split-router-case-version',
        actual: parsed['schemaVersion'],
      }),
    );
  }

  const recomputed = createCanonicalSplitRouterCase(
    parsed['caseId'],
    JSON.stringify(parsed['run']),
    parsed['determinismHash'],
  );
  if (!recomputed.ok) return parseFailure(recomputed.error);
  if (recomputed.value.canonicalJson !== canonicalCaseJson) {
    return parseFailure(
      Object.freeze({ code: 'split-router-case-canonical-mismatch' }),
    );
  }
  return Object.freeze({ ok: true, value: recomputed.value });
}
