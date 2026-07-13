import assert from 'node:assert/strict';
import test from 'node:test';

import {
  advancePathShadowPriceProposal,
  capturePathShadowPriceConfiguration,
  finalizePathShadowPriceProposal,
  preparePathShadowPriceProposal,
  reconstructPathShadowPriceBase,
  type CapturedPathShadowPriceConfiguration,
  type PathShadowPriceIterationState,
  type PathShadowPriceProposalRequest,
  type PathShadowPriceReadyState,
  type PathShadowPriceResolvedHop,
} from '../src/allocation/path-shadow-price/index.ts';

function assertDeepFrozen(value: unknown, seen = new Set<object>()): void {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) return;
  if (seen.has(value)) return;
  seen.add(value);
  assert.equal(Object.isFrozen(value), true);
  for (const key of Reflect.ownKeys(value)) assertDeepFrozen(Reflect.get(value, key), seen);
}

function configuration(
  outerIterations = 64,
  innerIterations = 64,
  convergenceTolerance = 2 ** -40,
): CapturedPathShadowPriceConfiguration {
  const result = capturePathShadowPriceConfiguration({
    outerIterations,
    innerIterations,
    convergenceTolerance,
  });
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error('Expected configuration capture to succeed.');
  return result.value;
}

function hop(
  reserveIn: bigint,
  reserveOut: bigint,
  feeChargedNumerator = 0n,
  feeDenominator = 1n,
): PathShadowPriceResolvedHop {
  return { reserveIn, reserveOut, feeChargedNumerator, feeDenominator };
}

function request(
  routes: PathShadowPriceProposalRequest['routes'],
  amountIn = 2n,
  capturedConfiguration = configuration(),
): PathShadowPriceProposalRequest {
  return { amountIn, routes, configuration: capturedConfiguration };
}

function prepared(value: PathShadowPriceProposalRequest) {
  const result = preparePathShadowPriceProposal(value);
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error('Expected proposal preparation to succeed.');
  return result.value;
}

function ready(value: PathShadowPriceProposalRequest): PathShadowPriceReadyState {
  let state = prepared(value).state;
  for (;;) {
    const result = advancePathShadowPriceProposal(state);
    assert.equal(result.ok, true);
    if (!result.ok) throw new Error('Expected proposal advancement to succeed.');
    if (result.value.status === 'ready') return result.value.state;
    state = result.value.state;
  }
}

function float64Bits(value: number): bigint {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setFloat64(0, value, false);
  let bits = 0n;
  for (const byte of bytes) bits = (bits << 8n) | BigInt(byte);
  return bits;
}

void test('captures configuration fields once in order and returns a fresh frozen value', () => {
  const observed: string[] = [];
  const caller = {
    extra: { mutable: true },
    get outerIterations() {
      observed.push('outerIterations');
      return 64;
    },
    get innerIterations() {
      observed.push('innerIterations');
      return 32;
    },
    get convergenceTolerance() {
      observed.push('convergenceTolerance');
      return 2 ** -40;
    },
  };
  const result = capturePathShadowPriceConfiguration(caller);
  assert.deepEqual(observed, [
    'outerIterations',
    'innerIterations',
    'convergenceTolerance',
  ]);
  assert.deepEqual(result, {
    ok: true,
    value: {
      outerIterations: 64,
      innerIterations: 32,
      convergenceTolerance: 2 ** -40,
    },
  });
  assert.equal(Object.isFrozen(caller), false);
  assert.equal(Object.isFrozen(caller.extra), false);
  assertDeepFrozen(result);

  const repeated = capturePathShadowPriceConfiguration(caller);
  assert.equal(repeated.ok, true);
  assert.equal(result.ok, true);
  if (repeated.ok && result.ok) assert.notEqual(repeated.value, result.value);
});

void test('projects configuration shape, getter, count, and tolerance failures exactly', () => {
  for (const input of [undefined, null, true, 1, 'value', () => undefined]) {
    assert.deepEqual(capturePathShadowPriceConfiguration(input), {
      ok: false,
      error: { code: 'invalid-numerical-configuration', field: 'numerical' },
    });
  }

  const valid = {
    outerIterations: 1,
    innerIterations: 1,
    convergenceTolerance: 1,
  };
  for (const outerIterations of [undefined, 0, 257, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.deepEqual(capturePathShadowPriceConfiguration({ ...valid, outerIterations }), {
      ok: false,
      error: { code: 'invalid-outer-iterations', field: 'numerical.outerIterations' },
    });
  }
  for (const innerIterations of [undefined, 0, 257, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.deepEqual(capturePathShadowPriceConfiguration({ ...valid, innerIterations }), {
      ok: false,
      error: { code: 'invalid-inner-iterations', field: 'numerical.innerIterations' },
    });
  }
  for (const convergenceTolerance of [
    undefined,
    -0,
    0,
    Number.MIN_VALUE,
    2 ** -1023,
    1 + Number.EPSILON,
    Number.NaN,
    Number.POSITIVE_INFINITY,
  ]) {
    assert.deepEqual(
      capturePathShadowPriceConfiguration({ ...valid, convergenceTolerance }),
      {
        ok: false,
        error: {
          code: 'invalid-convergence-tolerance',
          field: 'numerical.convergenceTolerance',
        },
      },
    );
  }
  assert.equal(capturePathShadowPriceConfiguration([]).ok, false);
  assert.equal(
    capturePathShadowPriceConfiguration({
      ...valid,
      convergenceTolerance: 2 ** -1022,
    }).ok,
    true,
  );
  assert.equal(capturePathShadowPriceConfiguration(valid).ok, true);

  for (const field of ['outerIterations', 'innerIterations', 'convergenceTolerance'] as const) {
    const input = { ...valid };
    Object.defineProperty(input, field, {
      get() {
        throw new Error('getter failed');
      },
    });
    assert.deepEqual(capturePathShadowPriceConfiguration(input), {
      ok: false,
      error: {
        code:
          field === 'outerIterations'
            ? 'invalid-outer-iterations'
            : field === 'innerIterations'
              ? 'invalid-inner-iterations'
              : 'invalid-convergence-tolerance',
        field: `numerical.${field}`,
      },
    });
  }
});

void test('stops configuration capture at the first invalid field', () => {
  const observed: string[] = [];
  const result = capturePathShadowPriceConfiguration({
    get outerIterations() {
      observed.push('outer');
      return 0;
    },
    get innerIterations() {
      observed.push('inner');
      return 1;
    },
    get convergenceTolerance() {
      observed.push('tolerance');
      return 1;
    },
  });
  assert.equal(result.ok, false);
  assert.deepEqual(observed, ['outer']);
});

void test('prepares primitive exact coefficients, reduced rationals, and normalized bits', () => {
  const routes = [
    [hop(2n, 4n, 0n, 10n)],
    [hop(2n, 4n, 0n, 10n)],
  ];
  const value = prepared(request(routes, 3n));
  assert.deepEqual(value.routeModels, [
    {
      coefficientA: 4n,
      coefficientB: 2n,
      coefficientC: 1n,
      exactMarginalScale: { numerator: 2n, denominator: 1n },
      exactInputScale: { numerator: 3n, denominator: 2n },
      nonauthorizingMarginalScale: 2,
      nonauthorizingInputScale: 1.5,
    },
    {
      coefficientA: 4n,
      coefficientB: 2n,
      coefficientC: 1n,
      exactMarginalScale: { numerator: 2n, denominator: 1n },
      exactInputScale: { numerator: 3n, denominator: 2n },
      nonauthorizingMarginalScale: 2,
      nonauthorizingInputScale: 1.5,
    },
  ]);
  assert.equal(float64Bits(value.routeModels[0]?.nonauthorizingMarginalScale ?? 0), 0x4000000000000000n);
  assert.equal(float64Bits(value.routeModels[0]?.nonauthorizingInputScale ?? 0), 0x3ff8000000000000n);
  assert.deepEqual(value.state, { completedOuterIterations: 0 });
  assertDeepFrozen(value);
});

void test('composes two hops in route order and reduces exact route rationals', () => {
  const composedRoute = [
    hop(4n, 9n, 1n, 10n),
    hop(5n, 7n, 1n, 4n),
  ];
  const value = prepared(request([composedRoute, composedRoute], 3n));
  for (const model of value.routeModels) {
    assert.deepEqual(model, {
      coefficientA: 1_701n,
      coefficientB: 800n,
      coefficientC: 423n,
      exactMarginalScale: { numerator: 1_701n, denominator: 800n },
      exactInputScale: { numerator: 1_269n, denominator: 800n },
      nonauthorizingMarginalScale: 1_701 / 800,
      nonauthorizingInputScale: 1_269 / 800,
    });
  }
});

void test('captures request, routes, and hop financial fields once in frozen supplied order', () => {
  const observed: string[] = [];
  const capturedConfiguration = configuration(1, 1, 1);
  const observedHop = {
    get reserveIn() {
      observed.push('reserveIn');
      return 1n;
    },
    get reserveOut() {
      observed.push('reserveOut');
      return 2n;
    },
    get feeChargedNumerator() {
      observed.push('feeChargedNumerator');
      return 0n;
    },
    get feeDenominator() {
      observed.push('feeDenominator');
      return 1n;
    },
  };
  const input = {
    get amountIn() {
      observed.push('amountIn');
      return 2n;
    },
    get routes() {
      observed.push('routes');
      return [[observedHop], [observedHop]];
    },
    get configuration() {
      observed.push('configuration');
      return capturedConfiguration;
    },
  };
  const result = preparePathShadowPriceProposal(input);
  assert.equal(result.ok, true);
  assert.deepEqual(observed, [
    'amountIn',
    'routes',
    'configuration',
    'reserveIn',
    'reserveOut',
    'feeChargedNumerator',
    'feeDenominator',
    'reserveIn',
    'reserveOut',
    'feeChargedNumerator',
    'feeDenominator',
  ]);
  assert.equal(Object.isFrozen(input), false);
  assert.equal(Object.isFrozen(observedHop), false);
  assertDeepFrozen(result);
});

void test('rejects every caller-controlled route model defect before solver state exists', () => {
  const goodRoute = [hop(1n, 2n)];
  const invalidRequests: PathShadowPriceProposalRequest[] = [
    request([goodRoute, goodRoute], 0n),
    request([goodRoute], 2n),
    request([[], goodRoute], 2n),
    request([[hop(0n, 2n)], goodRoute], 2n),
    request([[hop(1n, 0n)], goodRoute], 2n),
    request([[hop(1n, 2n, -1n, 10n)], goodRoute], 2n),
    request([[hop(1n, 2n, 10n, 10n)], goodRoute], 2n),
    request([[hop(1n, 2n, 0n, 0n)], goodRoute], 2n),
  ];
  for (const invalidRequest of invalidRequests) {
    const result = preparePathShadowPriceProposal(invalidRequest);
    assert.deepEqual(result, {
      ok: false,
      error: {
        code: 'invalid-route-model',
        converged: false,
        completedOuterIterations: 0,
      },
    });
    assertDeepFrozen(result);
  }

  const throwingHop = Object.defineProperty({}, 'reserveIn', {
    get() {
      throw new Error('capture failed');
    },
  }) as PathShadowPriceResolvedHop;
  assert.equal(
    preparePathShadowPriceProposal(request([[throwingHop], goodRoute], 2n)).ok,
    false,
  );
});

void test('rejects forged configuration as internal misuse', () => {
  const forged = Object.freeze({
    outerIterations: 1,
    innerIterations: 1,
    convergenceTolerance: 1,
  }) as CapturedPathShadowPriceConfiguration;
  assert.throws(
    () => preparePathShadowPriceProposal(request([[hop(1n, 2n)], [hop(1n, 2n)]], 2n, forged)),
    TypeError,
  );
});

void test('classifies normalization overflow and underflow without approximate fallback', () => {
  const overflowingScale = hop(1n, 1n << 2_000n);
  const underflowingScale = hop(1n << 2_000n, 1n);
  for (const routeHop of [overflowingScale, underflowingScale]) {
    assert.deepEqual(
      preparePathShadowPriceProposal(request([[routeHop], [routeHop]], 2n)),
      {
        ok: false,
        error: {
          code: 'non-finite-normalization',
          converged: false,
          completedOuterIterations: 0,
        },
      },
    );
  }
});

void test('advances one persistent outer update per call and keeps ready/finalize distinct', () => {
  const proposal = request(
    [[hop(1n, 2n)], [hop(1n, 2n)]],
    2n,
    configuration(2, 8, 1),
  );
  const initial = prepared(proposal).state;
  const firstBranch = advancePathShadowPriceProposal(initial);
  const secondBranch = advancePathShadowPriceProposal(initial);
  assert.deepEqual(firstBranch, secondBranch);
  assert.notEqual(firstBranch, secondBranch);
  assert.equal(firstBranch.ok, true);
  assert.equal(secondBranch.ok, true);
  if (!firstBranch.ok || !secondBranch.ok) throw new Error('Expected branch success.');
  assert.equal(firstBranch.value.status, 'continue');
  assert.equal(secondBranch.value.status, 'continue');
  if (firstBranch.value.status !== 'continue' || secondBranch.value.status !== 'continue') {
    throw new Error('Expected intermediate iteration states.');
  }
  assert.notEqual(firstBranch.value.state, secondBranch.value.state);
  assert.deepEqual(initial, { completedOuterIterations: 0 });
  assert.deepEqual(firstBranch.value.state, { completedOuterIterations: 1 });

  const completed = advancePathShadowPriceProposal(firstBranch.value.state);
  assert.equal(completed.ok, true);
  if (!completed.ok || completed.value.status !== 'ready') {
    throw new Error('Expected a ready state.');
  }
  assert.deepEqual(completed.value.state, { completedOuterIterations: 2 });
  assert.throws(
    () => advancePathShadowPriceProposal(completed.value.state as unknown as PathShadowPriceIterationState),
    TypeError,
  );
  assert.throws(
    () => finalizePathShadowPriceProposal(initial as unknown as PathShadowPriceReadyState),
    TypeError,
  );

  const finalized = finalizePathShadowPriceProposal(completed.value.state);
  const repeated = finalizePathShadowPriceProposal(completed.value.state);
  assert.deepEqual(finalized, repeated);
  assert.notEqual(finalized, repeated);
  assertDeepFrozen(firstBranch);
  assertDeepFrozen(completed);
  assertDeepFrozen(finalized);
});

void test('reports an atomic non-finite update at the prior completed count', () => {
  const hugeInputScale = 1n << 1_000n;
  const value = prepared(
    request(
      [[hop(1n, 1n)], [hop(1n, 1n)]],
      hugeInputScale,
      configuration(2, 2, 1),
    ),
  );
  const first = advancePathShadowPriceProposal(value.state);
  assert.deepEqual(first, {
    ok: false,
    error: {
      code: 'non-finite-proposal',
      converged: false,
      completedOuterIterations: 0,
    },
  });
  assert.deepEqual(value.state, { completedOuterIterations: 0 });
  assert.deepEqual(advancePathShadowPriceProposal(value.state), first);
});

void test('rejects positive lambda halving that underflows to zero at completed count 53', () => {
  const value = prepared(
    request(
      [
        [hop(1n << 1_022n, 1n)],
        [hop(1n << 1_021n, 1n)],
      ],
      1n,
      configuration(64, 64, 2 ** -40),
    ),
  );
  let state = value.state;
  for (let completedOuterIterations = 1; completedOuterIterations <= 53; completedOuterIterations += 1) {
    const result = advancePathShadowPriceProposal(state);
    assert.equal(result.ok, true);
    if (!result.ok || result.value.status !== 'continue') {
      throw new Error('Expected another iteration state before lambda-halving underflow.');
    }
    assert.equal(result.value.state.completedOuterIterations, completedOuterIterations);
    state = result.value.state;
  }

  const failed = advancePathShadowPriceProposal(state);
  assert.deepEqual(failed, {
    ok: false,
    error: {
      code: 'non-finite-proposal',
      converged: false,
      completedOuterIterations: 53,
    },
  });
  assert.deepEqual(state, { completedOuterIterations: 53 });
  assert.deepEqual(advancePathShadowPriceProposal(state), failed);
  assertDeepFrozen(failed);
});

void test('finalizes the identical-pool golden into exact bases and no residual', () => {
  const completed = ready(request([[hop(1n, 2n)], [hop(1n, 2n)]], 2n));
  const result = finalizePathShadowPriceProposal(completed);
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error('Expected finalization to succeed.');
  assert.equal(result.value.converged, true);
  assert.equal(result.value.completedOuterIterations, 64);
  assert.equal(result.value.configuredInnerIterations, 64);
  assert.equal(result.value.reconstruction.nonauthorizingWeights.length, 2);
  assert.equal(
    float64Bits(result.value.reconstruction.nonauthorizingWeights[0] ?? 0),
    float64Bits(result.value.reconstruction.nonauthorizingWeights[1] ?? 1),
  );
  assert.equal(
    result.value.reconstruction.integerWeights[0],
    result.value.reconstruction.integerWeights[1],
  );
  assert.deepEqual(result.value.reconstruction.baseAllocations, [1n, 1n]);
  assert.equal(result.value.reconstruction.residualUnits, 0n);
  assertDeepFrozen(result);
});

void test('reports non-convergence only from the distinct final sample', () => {
  const completed = ready(
    request(
      [[hop(1n, 2n)], [hop(1n, 2n)]],
      2n,
      configuration(1, 1, 2 ** -1022),
    ),
  );
  assert.deepEqual(finalizePathShadowPriceProposal(completed), {
    ok: false,
    error: {
      code: 'non-convergence',
      converged: false,
      completedOuterIterations: 1,
    },
  });
});

void test('decodes IEEE weights exactly without gcd reduction and retains zero bases', () => {
  const result = reconstructPathShadowPriceBase(3n, [0, 1, 2]);
  assert.deepEqual(result, {
    ok: true,
    value: {
      nonauthorizingWeights: [0, 1, 2],
      integerWeights: [0n, 1n << 52n, 1n << 53n],
      baseAllocations: [0n, 1n, 2n],
      residualUnits: 0n,
    },
  });
  assertDeepFrozen(result);

  assert.deepEqual(reconstructPathShadowPriceBase(3n, [0.5, 0.5]), {
    ok: true,
    value: {
      nonauthorizingWeights: [0.5, 0.5],
      integerWeights: [1n << 52n, 1n << 52n],
      baseAllocations: [1n, 1n],
      residualUnits: 1n,
    },
  });
});

void test('reconstructs arbitrary-precision bases with an exact base-plus-residual identity', () => {
  const amountIn = 10n ** 80n;
  const result = reconstructPathShadowPriceBase(amountIn, [1, 2]);
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error('Expected huge reconstruction to succeed.');
  assert.deepEqual(result.value.integerWeights, [1n << 52n, 1n << 53n]);
  assert.equal(
    result.value.baseAllocations.reduce((sum, allocation) => sum + allocation, 0n) +
      result.value.residualUnits,
    amountIn,
  );
  assert.equal(result.value.residualUnits < 2n, true);
});

void test('applies invalid IEEE-pattern precedence before zero-total detection', () => {
  for (const invalidWeight of [
    -0,
    -1,
    Number.MIN_VALUE,
    -(2 ** -1022),
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    Number.NaN,
  ]) {
    assert.deepEqual(reconstructPathShadowPriceBase(1n, [0, invalidWeight]), {
      ok: false,
      error: { code: 'invalid-reconstruction' },
    });
  }
  assert.deepEqual(reconstructPathShadowPriceBase(1n, []), {
    ok: false,
    error: { code: 'zero-total-weight' },
  });
  assert.deepEqual(reconstructPathShadowPriceBase(1n, [0, 0]), {
    ok: false,
    error: { code: 'zero-total-weight' },
  });
  assert.deepEqual(reconstructPathShadowPriceBase(0n, [1]), {
    ok: false,
    error: { code: 'invalid-reconstruction' },
  });
  assert.equal(reconstructPathShadowPriceBase(1n, [2 ** -1022]).ok, true);
  assert.equal(reconstructPathShadowPriceBase(1n, [Number.MAX_VALUE]).ok, true);
});

void test('captures reconstruction weights without retaining or freezing caller aliases', () => {
  const callerWeights = [1, 2];
  const result = reconstructPathShadowPriceBase(3n, callerWeights);
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error('Expected reconstruction to succeed.');
  assert.notEqual(result.value.nonauthorizingWeights, callerWeights);
  callerWeights[0] = 4;
  assert.deepEqual(result.value.nonauthorizingWeights, [1, 2]);
  assert.equal(Object.isFrozen(callerWeights), false);
  assertDeepFrozen(result);
});
