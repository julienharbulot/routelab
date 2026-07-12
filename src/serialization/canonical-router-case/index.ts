import {
  parseAndVerifyCanonicalSinglePathRouterRun,
  type CanonicalSinglePathRouterRun,
  type CanonicalSinglePathRouterRunParseError,
} from '../canonical-router-run/index.ts';

export const CANONICAL_ROUTER_CASE_SCHEMA_VERSION = 'routelab.router-case.v1';

export interface InvalidRouterCaseIdError {
  readonly code: 'invalid-router-case-id';
}

export interface InvalidRouterCaseJsonError {
  readonly code: 'invalid-router-case-json';
}

export interface InvalidRouterCaseShapeError {
  readonly code: 'invalid-router-case-shape';
  readonly path: string;
}

export interface UnsupportedRouterCaseVersionError {
  readonly code: 'unsupported-router-case-version';
  readonly actual: string;
}

export interface RouterCaseCanonicalMismatchError {
  readonly code: 'router-case-canonical-mismatch';
}

export interface CanonicalSinglePathRouterCase {
  readonly caseId: string;
  readonly run: CanonicalSinglePathRouterRun;
  readonly canonicalJson: string;
}

export type CanonicalSinglePathRouterCaseCreateError =
  | InvalidRouterCaseIdError
  | CanonicalSinglePathRouterRunParseError;

export type CanonicalSinglePathRouterCaseCreateResult =
  | { readonly ok: true; readonly value: CanonicalSinglePathRouterCase }
  | { readonly ok: false; readonly error: CanonicalSinglePathRouterCaseCreateError };

export type CanonicalSinglePathRouterCaseParseError =
  | InvalidRouterCaseJsonError
  | InvalidRouterCaseShapeError
  | UnsupportedRouterCaseVersionError
  | CanonicalSinglePathRouterCaseCreateError
  | RouterCaseCanonicalMismatchError;

export type CanonicalSinglePathRouterCaseParseResult =
  | { readonly ok: true; readonly value: CanonicalSinglePathRouterCase }
  | { readonly ok: false; readonly error: CanonicalSinglePathRouterCaseParseError };

type InputObject = Record<string, unknown>;

const CASE_FIELDS = ['schemaVersion', 'caseId', 'determinismHash', 'run'] as const;

function isInputObject(value: unknown): value is InputObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function exactCaseFieldError(value: InputObject): string | undefined {
  for (const field of CASE_FIELDS) {
    if (!Object.hasOwn(value, field)) return `$.${field}`;
  }

  const expected = new Set<string>(CASE_FIELDS);
  const extra = Object.keys(value)
    .filter((field) => !expected.has(field))
    .sort()[0];
  return extra === undefined ? undefined : `$.${extra}`;
}

function createFailure(error: CanonicalSinglePathRouterCaseCreateError) {
  return Object.freeze({ ok: false as const, error });
}

function parseFailure(error: CanonicalSinglePathRouterCaseParseError) {
  return Object.freeze({ ok: false as const, error });
}

function invalidCaseId() {
  const error: InvalidRouterCaseIdError = Object.freeze({
    code: 'invalid-router-case-id',
  });
  return error;
}

export function createCanonicalSinglePathRouterCase(
  caseId: string,
  canonicalRunJson: string,
  determinismHash: string,
): CanonicalSinglePathRouterCaseCreateResult {
  if (typeof caseId !== 'string' || caseId.length === 0) {
    return createFailure(invalidCaseId());
  }

  const verifiedRun = parseAndVerifyCanonicalSinglePathRouterRun(
    canonicalRunJson,
    determinismHash,
  );
  if (!verifiedRun.ok) return createFailure(verifiedRun.error);

  const runObject: unknown = JSON.parse(verifiedRun.value.canonicalJson);
  const canonicalJson = JSON.stringify({
    schemaVersion: CANONICAL_ROUTER_CASE_SCHEMA_VERSION,
    caseId,
    determinismHash: verifiedRun.value.determinismHash,
    run: runObject,
  });
  const value: CanonicalSinglePathRouterCase = Object.freeze({
    caseId,
    run: verifiedRun.value,
    canonicalJson,
  });
  return Object.freeze({ ok: true, value });
}

export function parseAndVerifyCanonicalSinglePathRouterCase(
  canonicalCaseJson: string,
): CanonicalSinglePathRouterCaseParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(canonicalCaseJson) as unknown;
  } catch {
    const error: InvalidRouterCaseJsonError = Object.freeze({
      code: 'invalid-router-case-json',
    });
    return parseFailure(error);
  }

  if (!isInputObject(parsed)) {
    const error: InvalidRouterCaseShapeError = Object.freeze({
      code: 'invalid-router-case-shape',
      path: '$',
    });
    return parseFailure(error);
  }
  const fieldError = exactCaseFieldError(parsed);
  if (fieldError !== undefined) {
    const error: InvalidRouterCaseShapeError = Object.freeze({
      code: 'invalid-router-case-shape',
      path: fieldError,
    });
    return parseFailure(error);
  }

  const schemaVersion = parsed['schemaVersion'];
  if (typeof schemaVersion !== 'string') {
    const error: InvalidRouterCaseShapeError = Object.freeze({
      code: 'invalid-router-case-shape',
      path: '$.schemaVersion',
    });
    return parseFailure(error);
  }
  const caseId = parsed['caseId'];
  if (typeof caseId !== 'string') {
    const error: InvalidRouterCaseShapeError = Object.freeze({
      code: 'invalid-router-case-shape',
      path: '$.caseId',
    });
    return parseFailure(error);
  }
  const determinismHash = parsed['determinismHash'];
  if (typeof determinismHash !== 'string') {
    const error: InvalidRouterCaseShapeError = Object.freeze({
      code: 'invalid-router-case-shape',
      path: '$.determinismHash',
    });
    return parseFailure(error);
  }
  const run = parsed['run'];
  if (!isInputObject(run)) {
    const error: InvalidRouterCaseShapeError = Object.freeze({
      code: 'invalid-router-case-shape',
      path: '$.run',
    });
    return parseFailure(error);
  }

  if (schemaVersion !== CANONICAL_ROUTER_CASE_SCHEMA_VERSION) {
    const error: UnsupportedRouterCaseVersionError = Object.freeze({
      code: 'unsupported-router-case-version',
      actual: schemaVersion,
    });
    return parseFailure(error);
  }

  const canonicalRunJson = JSON.stringify(run);
  const recomputed = createCanonicalSinglePathRouterCase(
    caseId,
    canonicalRunJson,
    determinismHash,
  );
  if (!recomputed.ok) return parseFailure(recomputed.error);

  if (recomputed.value.canonicalJson !== canonicalCaseJson) {
    const error: RouterCaseCanonicalMismatchError = Object.freeze({
      code: 'router-case-canonical-mismatch',
    });
    return parseFailure(error);
  }

  return Object.freeze({ ok: true, value: recomputed.value });
}
