import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

import type { ConstantProductPool, LiquiditySnapshot } from '../src/domain/index.ts';
import {
  prepareRoutingContext,
  type PreparedRoutingContext,
} from '../src/runtime/prepared-routing-context/index.ts';
import * as referenceRuntime from '../src/router/anytime-exact-input-split/index.ts';
import type {
  ExactInputSplitRuntimeControl,
  ExactInputSplitRuntimeRequest,
  ExactInputSplitWorkCaps,
} from '../src/router/anytime-exact-input-split/index.ts';
import * as numericalRuntime from '../src/router/numerical-exact-input-split/index.ts';
import type {
  NumericalExactInputSplitRuntimeControl,
  NumericalExactInputSplitRuntimeRequest,
  NumericalExactInputSplitWorkCaps,
} from '../src/router/numerical-exact-input-split/index.ts';

const REQUEST_FIELDS = [
  'snapshotId',
  'snapshotChecksum',
  'assetIn',
  'assetOut',
  'amountIn',
  'maxHops',
  'maxRoutes',
  'greedyParts',
] as const;

const BASE_CAP_FIELDS = [
  'maxPathExpansions',
  'maxBestSingleCandidateReplays',
  'maxCandidateSetExpansions',
  'maxEqualProposalReplays',
  'maxGreedyOptionReplays',
  'maxFinalAuthorizationReplays',
] as const;

const NUMERICAL_CAP_FIELDS = [
  'maxNumericalProposals',
  'maxNumericalIterations',
  'maxNumericalResidualReplays',
  'maxNumericalAuthorizationReplays',
] as const;

const NUMERICAL_FIELDS = [
  'outerIterations',
  'innerIterations',
  'convergenceTolerance',
] as const;

const COMPLETE_BASE_CAPS: ExactInputSplitWorkCaps = Object.freeze({
  maxPathExpansions: 100,
  maxBestSingleCandidateReplays: 100,
  maxCandidateSetExpansions: 100,
  maxEqualProposalReplays: 100,
  maxGreedyOptionReplays: 100,
  maxFinalAuthorizationReplays: 100,
});

const COMPLETE_NUMERICAL_CAPS: NumericalExactInputSplitWorkCaps = Object.freeze({
  ...COMPLETE_BASE_CAPS,
  maxNumericalProposals: 100,
  maxNumericalIterations: 100,
  maxNumericalResidualReplays: 100,
  maxNumericalAuthorizationReplays: 100,
});

function compareRawUtf16(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function canonicalSnapshotContent(value: LiquiditySnapshot): string {
  const pools = [...value.pools]
    .sort((left, right) => compareRawUtf16(left.poolId, right.poolId))
    .map((candidate) => ({
      poolId: candidate.poolId,
      asset0: candidate.asset0,
      reserve0: candidate.reserve0.toString(10),
      asset1: candidate.asset1,
      reserve1: candidate.reserve1.toString(10),
      feeChargedNumerator: candidate.feeChargedNumerator.toString(10),
      feeDenominator: candidate.feeDenominator.toString(10),
    }));
  return JSON.stringify({ schemaVersion: 'routelab.snapshot.v1', pools });
}

function pool(poolId: string): ConstantProductPool {
  return {
    poolId,
    asset0: 'A',
    reserve0: 100n,
    asset1: 'C',
    reserve1: 100n,
    feeChargedNumerator: 0n,
    feeDenominator: 1n,
  };
}

function snapshot(): LiquiditySnapshot {
  const pending: LiquiditySnapshot = {
    snapshotId: 'reference-contract-parity',
    snapshotChecksum: 'pending',
    pools: [pool('left-ac'), pool('right-ac')],
  };
  const digest = createHash('sha256')
    .update(canonicalSnapshotContent(pending), 'utf8')
    .digest('hex');
  return { ...pending, snapshotChecksum: `sha256:${digest}` };
}

function prepare(value: LiquiditySnapshot): PreparedRoutingContext {
  const result = prepareRoutingContext(value);
  if (!result.ok) assert.fail(`prepared context rejected: ${result.error.code}`);
  return result.value;
}

function baseRequest(value: LiquiditySnapshot): ExactInputSplitRuntimeRequest {
  return {
    snapshotId: value.snapshotId,
    snapshotChecksum: value.snapshotChecksum,
    assetIn: 'A',
    assetOut: 'C',
    amountIn: 100n,
    maxHops: 1,
    maxRoutes: 2,
    greedyParts: 2,
  };
}

function numericalRequest(
  value: LiquiditySnapshot,
): NumericalExactInputSplitRuntimeRequest {
  return {
    ...baseRequest(value),
    numerical: {
      outerIterations: 2,
      innerIterations: 2,
      convergenceTolerance: 1,
    },
  };
}

function tracedRequest(
  source: ExactInputSplitRuntimeRequest,
  trace: string[],
  throwAt?: (typeof REQUEST_FIELDS)[number],
): ExactInputSplitRuntimeRequest {
  return new Proxy(source, {
    get(target, property, receiver): unknown {
      const field = String(property);
      trace.push(`request.${field}`);
      if (field === throwAt) throw new Error(`forced request getter: ${field}`);
      return Reflect.get(target, property, receiver);
    },
  });
}

function tracedNumericalRequest(
  source: NumericalExactInputSplitRuntimeRequest,
  trace: string[],
  throwAt?: string,
): NumericalExactInputSplitRuntimeRequest {
  const numerical = new Proxy(source.numerical, {
    get(target, property, receiver): unknown {
      const field = String(property);
      trace.push(`numerical.${field}`);
      if (`numerical.${field}` === throwAt) {
        throw new Error(`forced numerical getter: ${field}`);
      }
      return Reflect.get(target, property, receiver);
    },
  });
  return new Proxy({ ...source, numerical }, {
    get(target, property, receiver): unknown {
      const field = String(property);
      trace.push(`request.${field}`);
      if (`request.${field}` === throwAt) {
        throw new Error(`forced request getter: ${field}`);
      }
      return Reflect.get(target, property, receiver);
    },
  });
}

function tracedBaseControl(
  trace: string[],
  throwAt?: string,
  caps: ExactInputSplitWorkCaps = COMPLETE_BASE_CAPS,
): ExactInputSplitRuntimeControl {
  const tracedCaps = new Proxy(caps, {
    get(target, property, receiver): unknown {
      const field = String(property);
      trace.push(`cap.${field}`);
      if (`cap.${field}` === throwAt) throw new Error(`forced cap getter: ${field}`);
      return Reflect.get(target, property, receiver);
    },
  });
  const deadline = new Proxy({
    deadlineNanoseconds: 1_000_000n,
    nowNanoseconds(): bigint {
      return 0n;
    },
  }, {
    get(target, property, receiver): unknown {
      const field = String(property);
      trace.push(`deadline.${field}`);
      if (`deadline.${field}` === throwAt) {
        throw new Error(`forced deadline getter: ${field}`);
      }
      return Reflect.get(target, property, receiver);
    },
  });
  const target: ExactInputSplitRuntimeControl = {
    workCaps: tracedCaps,
    shouldInterrupt(): boolean {
      return false;
    },
    deadline,
  };
  return new Proxy(target, {
    get(control, property, receiver): unknown {
      const field = String(property);
      trace.push(`control.${field}`);
      if (`control.${field}` === throwAt) {
        throw new Error(`forced control getter: ${field}`);
      }
      return Reflect.get(control, property, receiver);
    },
  });
}

function tracedNumericalControl(
  trace: string[],
  throwAt?: string,
  caps: NumericalExactInputSplitWorkCaps = COMPLETE_NUMERICAL_CAPS,
): NumericalExactInputSplitRuntimeControl {
  const tracedCaps = new Proxy(caps, {
    get(target, property, receiver): unknown {
      const field = String(property);
      trace.push(`cap.${field}`);
      if (`cap.${field}` === throwAt) throw new Error(`forced cap getter: ${field}`);
      return Reflect.get(target, property, receiver);
    },
  });
  const deadline = new Proxy({
    deadlineNanoseconds: 1_000_000n,
    nowNanoseconds(): bigint {
      return 0n;
    },
  }, {
    get(target, property, receiver): unknown {
      const field = String(property);
      trace.push(`deadline.${field}`);
      if (`deadline.${field}` === throwAt) {
        throw new Error(`forced deadline getter: ${field}`);
      }
      return Reflect.get(target, property, receiver);
    },
  });
  const target: NumericalExactInputSplitRuntimeControl = {
    workCaps: tracedCaps,
    shouldInterrupt(): boolean {
      return false;
    },
    deadline,
  };
  return new Proxy(target, {
    get(control, property, receiver): unknown {
      const field = String(property);
      trace.push(`control.${field}`);
      if (`control.${field}` === throwAt) {
        throw new Error(`forced control getter: ${field}`);
      }
      return Reflect.get(control, property, receiver);
    },
  });
}

function zeroBaseCaps(): ExactInputSplitWorkCaps {
  return {
    maxPathExpansions: 0,
    maxBestSingleCandidateReplays: 0,
    maxCandidateSetExpansions: 0,
    maxEqualProposalReplays: 0,
    maxGreedyOptionReplays: 0,
    maxFinalAuthorizationReplays: 0,
  };
}

function zeroNumericalCaps(): NumericalExactInputSplitWorkCaps {
  return {
    ...zeroBaseCaps(),
    maxNumericalProposals: 0,
    maxNumericalIterations: 0,
    maxNumericalResidualReplays: 0,
    maxNumericalAuthorizationReplays: 0,
  };
}

const BASE_CONTROL_TRACE = [
  'control.workCaps',
  ...BASE_CAP_FIELDS.map((field) => `cap.${field}`),
  'control.shouldInterrupt',
  'control.deadline',
  'deadline.deadlineNanoseconds',
  'deadline.nowNanoseconds',
] as const;

const NUMERICAL_CONTROL_TRACE = [
  'control.workCaps',
  ...[...BASE_CAP_FIELDS, ...NUMERICAL_CAP_FIELDS].map((field) => `cap.${field}`),
  'control.shouldInterrupt',
  'control.deadline',
  'deadline.deadlineNanoseconds',
  'deadline.nowNanoseconds',
] as const;

void test('keeps the complete public source declaration and value-export inventories exact', () => {
  assert.deepEqual(Object.keys(referenceRuntime), ['routeExactInputSplitAnytime']);
  assert.deepEqual(Object.keys(numericalRuntime), [
    'routeExactInputSplitNumericalAnytime',
    'routeExactInputSplitNumericalAnytimeWithAuthorizationReplay',
    'routeExactInputSplitNumericalAnytimeWithProposalDriver',
  ]);

  const referenceSource = readFileSync(
    new URL('../src/router/anytime-exact-input-split/index.ts', import.meta.url),
    'utf8',
  );
  const numericalSource = readFileSync(
    new URL('../src/router/numerical-exact-input-split/index.ts', import.meta.url),
    'utf8',
  );
  const exportedNames = (source: string): string[] => [...source.matchAll(
    /^export (?:declare )?(?:interface|type|function|const|class) ([A-Za-z0-9_]+)/gmu,
  )].map((match) => match[1]!);
  assert.deepEqual(exportedNames(referenceSource), [
    'ExactInputSplitRuntimeRequest',
    'ExactInputSplitRuntimeValidationErrorCode',
    'ExactInputSplitRuntimeValidationErrorField',
    'ExactInputSplitRuntimeValidationError',
    'ExactInputSplitWorkCaps',
    'ExactInputSplitWorkCounters',
    'ExactInputSplitRuntimeWorkKind',
    'ExactInputSplitRuntimeCheckpoint',
    'ExactInputSplitRuntimeDeadlineControl',
    'ExactInputSplitRuntimeControl',
    'ExactInputSplitRuntimeControlValidationError',
    'ExactInputSplitRuntimeControlError',
    'ExactInputSplitRuntimeDeadlineError',
    'ExactInputSplitRuntimeTermination',
    'ExactInputSplitRuntimeSearchSummary',
    'ExactInputSplitRuntimePlan',
    'ExactInputSplitRuntimeResult',
    'routeExactInputSplitAnytime',
  ]);
  assert.deepEqual(exportedNames(numericalSource), [
    'NumericalExactInputSplitConfiguration',
    'NumericalExactInputSplitRuntimeRequest',
    'NumericalExactInputSplitRuntimeValidationError',
    'NumericalExactInputSplitWorkCaps',
    'NumericalExactInputSplitWorkCounters',
    'NumericalExactInputSplitRuntimeWorkKind',
    'NumericalExactInputSplitRuntimeCheckpoint',
    'NumericalExactInputSplitRuntimeControl',
    'NumericalExactInputSplitRuntimeControlValidationError',
    'NumericalExactInputSplitFailureCode',
    'NumericalExactInputSplitCandidateCounters',
    'NumericalExactInputSplitDiagnostic',
    'NumericalExactInputSplitRuntimeSearchSummary',
    'NumericalExactInputSplitRuntimePlan',
    'NumericalExactInputSplitRuntimeResult',
    'NumericalExactInputSplitAuthorizationReplay',
    'NumericalExactInputSplitProposalDriver',
    'routeExactInputSplitNumericalAnytime',
    'routeExactInputSplitNumericalAnytimeWithAuthorizationReplay',
    'routeExactInputSplitNumericalAnytimeWithProposalDriver',
  ]);

  const normalizedDeclarationDigest = (source: string): string => {
    const declarations: string[] = [];
    for (const match of source.matchAll(
      /^export (interface|type) [A-Za-z0-9_]+/gmu,
    )) {
      const start = match.index;
      const kind = match[1];
      let end = -1;
      if (kind === 'interface') {
        let depth = 0;
        const openingBrace = source.indexOf('{', start);
        assert.notEqual(openingBrace, -1);
        for (let index = openingBrace; index < source.length; index += 1) {
          const character = source[index];
          if (character === '{') depth += 1;
          if (character === '}') {
            depth -= 1;
            if (depth === 0) {
              end = index + 1;
              break;
            }
          }
        }
      } else {
        let parentheses = 0;
        let brackets = 0;
        let braces = 0;
        const equals = source.indexOf('=', start);
        assert.notEqual(equals, -1);
        for (let index = equals + 1; index < source.length; index += 1) {
          const character = source[index];
          if (character === '(') parentheses += 1;
          if (character === ')') parentheses -= 1;
          if (character === '[') brackets += 1;
          if (character === ']') brackets -= 1;
          if (character === '{') braces += 1;
          if (character === '}') braces -= 1;
          if (
            character === ';'
            && parentheses === 0
            && brackets === 0
            && braces === 0
          ) {
            end = index + 1;
            break;
          }
        }
      }
      assert.notEqual(end, -1);
      declarations.push(source.slice(start, end).replace(/\s+/gu, ''));
    }
    return createHash('sha256')
      .update(declarations.join('\n'), 'utf8')
      .digest('hex');
  };
  assert.equal(
    normalizedDeclarationDigest(referenceSource),
    'ec7d1390f857e6cc4f3e74762ec81d7d48256213e3711df2cc2f9c538db28a63',
  );
  assert.equal(
    normalizedDeclarationDigest(numericalSource),
    'a83cf62df979a23c7932590ce56bdcf884733eb933574e9dcb221f401b347b0f',
  );
});

void test('reference request getters stop at the exact throwing field and project its frozen error', () => {
  const value = snapshot();
  const errors = [
    { field: 'snapshotId', error: { code: 'snapshot-identity-mismatch', field: 'snapshotIdentity' } },
    { field: 'snapshotChecksum', error: { code: 'snapshot-identity-mismatch', field: 'snapshotIdentity' } },
    { field: 'assetIn', error: { code: 'empty-identifier', field: 'assetIn' } },
    { field: 'assetOut', error: { code: 'empty-identifier', field: 'assetOut' } },
    { field: 'amountIn', error: { code: 'nonpositive-input', field: 'amountIn' } },
    { field: 'maxHops', error: { code: 'invalid-max-hops', field: 'maxHops' } },
    { field: 'maxRoutes', error: { code: 'invalid-max-routes', field: 'maxRoutes' } },
    { field: 'greedyParts', error: { code: 'invalid-greedy-parts', field: 'greedyParts' } },
  ] as const;
  for (const [index, fixture] of errors.entries()) {
    const trace: string[] = [];
    const result = referenceRuntime.routeExactInputSplitAnytime(
      prepare(value),
      tracedRequest(baseRequest(value), trace, fixture.field),
      { workCaps: COMPLETE_BASE_CAPS },
    );
    assert.deepEqual(trace, REQUEST_FIELDS.slice(0, index + 1).map((field) => `request.${field}`));
    assert.deepEqual(result, { status: 'invalid-request', error: fixture.error });
    assert.equal(Object.isFrozen(result), true);
    assert.equal(Object.isFrozen(result.error), true);
  }
});

void test('reference control getters have one exact full trace and field-local throwing failures', () => {
  const value = snapshot();
  const requestTrace: string[] = [];
  const controlTrace: string[] = [];
  const complete = referenceRuntime.routeExactInputSplitAnytime(
    prepare(value),
    tracedRequest(baseRequest(value), requestTrace),
    tracedBaseControl(controlTrace, undefined, zeroBaseCaps()),
  );
  assert.equal(complete.status, 'success');
  assert.deepEqual(requestTrace, REQUEST_FIELDS.map((field) => `request.${field}`));
  assert.deepEqual(controlTrace, BASE_CONTROL_TRACE);

  const failures = [
    { at: 'control.workCaps', error: { code: 'invalid-work-caps', field: 'workCaps' } },
    ...BASE_CAP_FIELDS.map((field) => ({
      at: `cap.${field}`,
      error: { code: 'invalid-work-cap', field: `workCaps.${field}` },
    })),
    { at: 'control.shouldInterrupt', error: { code: 'invalid-interruption-callback', field: 'shouldInterrupt' } },
    { at: 'control.deadline', error: { code: 'invalid-deadline-control', field: 'deadline' } },
    { at: 'deadline.deadlineNanoseconds', error: { code: 'invalid-deadline-nanoseconds', field: 'deadline.deadlineNanoseconds' } },
    { at: 'deadline.nowNanoseconds', error: { code: 'invalid-deadline-clock', field: 'deadline.nowNanoseconds' } },
  ] as const;
  for (const fixture of failures) {
    const trace: string[] = [];
    const result = referenceRuntime.routeExactInputSplitAnytime(
      prepare(value),
      baseRequest(value),
      tracedBaseControl(trace, fixture.at),
    );
    const failureIndex = BASE_CONTROL_TRACE.indexOf(fixture.at);
    assert.notEqual(failureIndex, -1);
    assert.deepEqual(trace, BASE_CONTROL_TRACE.slice(0, failureIndex + 1));
    assert.deepEqual(result, { status: 'invalid-control', error: fixture.error });
  }
});

void test('numerical request capture reads inherited then nested fields exactly and retains inherited precedence', () => {
  const value = snapshot();
  const inheritedErrors = [
    { field: 'snapshotId', error: { code: 'snapshot-identity-mismatch', field: 'snapshotIdentity' } },
    { field: 'snapshotChecksum', error: { code: 'snapshot-identity-mismatch', field: 'snapshotIdentity' } },
    { field: 'assetIn', error: { code: 'empty-identifier', field: 'assetIn' } },
    { field: 'assetOut', error: { code: 'empty-identifier', field: 'assetOut' } },
    { field: 'amountIn', error: { code: 'nonpositive-input', field: 'amountIn' } },
    { field: 'maxHops', error: { code: 'invalid-max-hops', field: 'maxHops' } },
    { field: 'maxRoutes', error: { code: 'invalid-max-routes', field: 'maxRoutes' } },
    { field: 'greedyParts', error: { code: 'invalid-greedy-parts', field: 'greedyParts' } },
  ] as const;
  for (const [index, fixture] of inheritedErrors.entries()) {
    const trace: string[] = [];
    const result = numericalRuntime.routeExactInputSplitNumericalAnytime(
      prepare(value),
      tracedNumericalRequest(numericalRequest(value), trace, `request.${fixture.field}`),
      { workCaps: COMPLETE_NUMERICAL_CAPS },
    );
    assert.deepEqual(trace, REQUEST_FIELDS.slice(0, index + 1).map((field) => `request.${field}`));
    assert.deepEqual(result, { status: 'invalid-request', error: fixture.error });
  }

  const numericalFailures = [
    { at: 'request.numerical', error: { code: 'invalid-numerical-configuration', field: 'numerical' } },
    { at: 'numerical.outerIterations', error: { code: 'invalid-outer-iterations', field: 'numerical.outerIterations' } },
    { at: 'numerical.innerIterations', error: { code: 'invalid-inner-iterations', field: 'numerical.innerIterations' } },
    { at: 'numerical.convergenceTolerance', error: { code: 'invalid-convergence-tolerance', field: 'numerical.convergenceTolerance' } },
  ] as const;
  for (const fixture of numericalFailures) {
    const trace: string[] = [];
    const result = numericalRuntime.routeExactInputSplitNumericalAnytime(
      prepare(value),
      tracedNumericalRequest(numericalRequest(value), trace, fixture.at),
      { workCaps: COMPLETE_NUMERICAL_CAPS },
    );
    const expected = REQUEST_FIELDS.map((field) => `request.${field}`);
    expected.push('request.numerical');
    if (fixture.at !== 'request.numerical') {
      expected.push(...NUMERICAL_FIELDS.map((field) => `numerical.${field}`));
    }
    assert.deepEqual(trace, expected);
    assert.deepEqual(result, { status: 'invalid-request', error: fixture.error });
  }

  const precedenceTrace: string[] = [];
  const invalidIdentity = numericalRequest(value);
  const precedence = numericalRuntime.routeExactInputSplitNumericalAnytime(
    prepare(value),
    tracedNumericalRequest(
      { ...invalidIdentity, snapshotChecksum: 'wrong' },
      precedenceTrace,
      'numerical.outerIterations',
    ),
    { workCaps: COMPLETE_NUMERICAL_CAPS },
  );
  assert.deepEqual(precedenceTrace, [
    ...REQUEST_FIELDS.map((field) => `request.${field}`),
    'request.numerical',
    ...NUMERICAL_FIELDS.map((field) => `numerical.${field}`),
  ]);
  assert.deepEqual(precedence, {
    status: 'invalid-request',
    error: { code: 'snapshot-identity-mismatch', field: 'snapshotIdentity' },
  });
});

void test('numerical control getters have one exact ten-cap trace and field-local failures', () => {
  const value = snapshot();
  const requestTrace: string[] = [];
  const controlTrace: string[] = [];
  const complete = numericalRuntime.routeExactInputSplitNumericalAnytime(
    prepare(value),
    tracedNumericalRequest(numericalRequest(value), requestTrace),
    tracedNumericalControl(controlTrace, undefined, zeroNumericalCaps()),
  );
  assert.equal(complete.status, 'success');
  assert.deepEqual(requestTrace, [
    ...REQUEST_FIELDS.map((field) => `request.${field}`),
    'request.numerical',
    ...NUMERICAL_FIELDS.map((field) => `numerical.${field}`),
  ]);
  assert.deepEqual(controlTrace, NUMERICAL_CONTROL_TRACE);

  const failures = [
    { at: 'control.workCaps', error: { code: 'invalid-work-caps', field: 'workCaps' } },
    ...[...BASE_CAP_FIELDS, ...NUMERICAL_CAP_FIELDS].map((field) => ({
      at: `cap.${field}`,
      error: { code: 'invalid-work-cap', field: `workCaps.${field}` },
    })),
    { at: 'control.shouldInterrupt', error: { code: 'invalid-interruption-callback', field: 'shouldInterrupt' } },
    { at: 'control.deadline', error: { code: 'invalid-deadline-control', field: 'deadline' } },
    { at: 'deadline.deadlineNanoseconds', error: { code: 'invalid-deadline-nanoseconds', field: 'deadline.deadlineNanoseconds' } },
    { at: 'deadline.nowNanoseconds', error: { code: 'invalid-deadline-clock', field: 'deadline.nowNanoseconds' } },
  ] as const;
  for (const fixture of failures) {
    const trace: string[] = [];
    const result = numericalRuntime.routeExactInputSplitNumericalAnytime(
      prepare(value),
      numericalRequest(value),
      tracedNumericalControl(trace, fixture.at),
    );
    const failureIndex = NUMERICAL_CONTROL_TRACE.indexOf(fixture.at);
    assert.notEqual(failureIndex, -1);
    assert.deepEqual(trace, NUMERICAL_CONTROL_TRACE.slice(0, failureIndex + 1));
    assert.deepEqual(result, { status: 'invalid-control', error: fixture.error });
  }
});

void test('captured callback and clock references are called plainly with callback priority', () => {
  const value = snapshot();
  const trace: string[] = [];
  let callbackCalled = false;
  let clockCalled = false;
  function shouldInterrupt(this: unknown): boolean {
    assert.equal(this, undefined);
    callbackCalled = true;
    trace.push('call.shouldInterrupt');
    return true;
  }
  function nowNanoseconds(this: unknown): bigint {
    assert.equal(this, undefined);
    clockCalled = true;
    trace.push('call.nowNanoseconds');
    return 0n;
  }
  const result = referenceRuntime.routeExactInputSplitAnytime(
    prepare(value),
    baseRequest(value),
    {
      workCaps: COMPLETE_BASE_CAPS,
      shouldInterrupt,
      deadline: { deadlineNanoseconds: 100n, nowNanoseconds },
    },
  );
  assert.equal(result.status, 'success');
  if (result.status !== 'success') assert.fail('expected direct incumbent');
  assert.equal(result.plan.search.termination, 'interrupted');
  assert.deepEqual(trace, ['call.shouldInterrupt']);
  assert.equal(callbackCalled, true);
  assert.equal(clockCalled, false);
});

void test('session extraction is either the exact activation source or one acyclic shared core', () => {
  const referencePath = new URL('../src/router/anytime-exact-input-split/index.ts', import.meta.url);
  const numericalPath = new URL('../src/router/numerical-exact-input-split/index.ts', import.meta.url);
  const sessionPath = new URL('../src/router/exact-input-split-session/index.ts', import.meta.url);
  const referenceSource = readFileSync(referencePath, 'utf8');
  const numericalSource = readFileSync(numericalPath, 'utf8');
  if (!existsSync(sessionPath)) {
    assert.equal(
      createHash('sha256').update(referenceSource, 'utf8').digest('hex'),
      'eaf3a7dc64a421c859e458f3156840031cc96c287c7903c17781ce3ec62dd37d',
    );
    assert.equal(
      createHash('sha256').update(numericalSource, 'utf8').digest('hex'),
      'f43365addfa4378eea98d2af2027eafbac2eebc173482a07a06604bd963c8305',
    );
    return;
  }

  const sessionSource = readFileSync(sessionPath, 'utf8');
  assert.equal(referenceSource.includes('../exact-input-split-session/index.ts'), true);
  assert.equal(numericalSource.includes('../exact-input-split-session/index.ts'), true);
  for (const wrapperSource of [referenceSource, numericalSource]) {
    for (const primitive of [
      'createPreparedSimplePathFrontier',
      'expandPreparedSimplePathFrontier',
      'hasPreparedSimplePathExpansion',
      'materializePreparedSimplePaths',
      'preparedDirectRoutes',
      'createSharedCandidateSetFrontier',
      'expandSharedCandidateSetFrontier',
      'hasSharedCandidateSetExpansion',
      'materializeSharedCandidateSets',
    ]) {
      assert.equal(wrapperSource.includes(primitive), false, primitive);
    }
  }
  assert.equal(referenceSource.includes('replayPreparedExactInputSplit'), false);
  assert.equal(referenceSource.includes('isStrictlyBetterSplitReceipt'), false);
  assert.equal(sessionSource.includes('../anytime-exact-input-split/index.ts'), false);
  assert.equal(sessionSource.includes('../numerical-exact-input-split/index.ts'), false);
  assert.equal(sessionSource.includes('runExactInputSplitReferencePolicy'), true);
});
