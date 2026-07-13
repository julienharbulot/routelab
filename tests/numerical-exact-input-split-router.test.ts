import assert from 'node:assert/strict';
import test from 'node:test';

import {
  advancePathShadowPriceProposal,
  finalizePathShadowPriceProposal,
  preparePathShadowPriceProposal,
} from '../src/allocation/path-shadow-price/index.ts';
import type { ConstantProductPool, LiquiditySnapshot } from '../src/domain/index.ts';
import type { ExactInputSplitReplayResult } from '../src/replay/exact-input-split/index.ts';
import {
  routeExactInputSplitAnytime,
  type ExactInputSplitRuntimeRequest,
} from '../src/router/anytime-exact-input-split/index.ts';
import {
  routeExactInputSplitNumericalAnytime,
  routeExactInputSplitNumericalAnytimeWithAuthorizationReplay,
  routeExactInputSplitNumericalAnytimeWithProposalDriver,
  type NumericalExactInputSplitProposalDriver,
  type NumericalExactInputSplitRuntimeControl,
  type NumericalExactInputSplitRuntimeRequest,
  type NumericalExactInputSplitRuntimeWorkKind,
  type NumericalExactInputSplitWorkCaps,
} from '../src/router/numerical-exact-input-split/index.ts';
import {
  prepareRoutingContext,
  resolvePreparedPathShadowPriceRoutes,
  type PreparedRoutingContext,
} from '../src/runtime/prepared-routing-context/index.ts';
import { computeCanonicalSnapshotChecksum } from '../src/serialization/canonical-snapshot/index.ts';

function pool(
  poolId: string,
  reserveIn = 100n,
  reserveOut = 100n,
  assetIn = 'A',
  assetOut = 'C',
  feeChargedNumerator = 0n,
  feeDenominator = 1n,
): ConstantProductPool {
  return {
    poolId,
    asset0: assetIn,
    reserve0: reserveIn,
    asset1: assetOut,
    reserve1: reserveOut,
    feeChargedNumerator,
    feeDenominator,
  };
}

function snapshot(pools: readonly ConstantProductPool[]): LiquiditySnapshot {
  const value = {
    snapshotId: 'numerical-runtime',
    snapshotChecksum: 'pending',
    pools,
  };
  return { ...value, snapshotChecksum: computeCanonicalSnapshotChecksum(value) };
}

function prepare(value: LiquiditySnapshot): PreparedRoutingContext {
  const result = prepareRoutingContext(value);
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error('Expected context preparation to succeed.');
  return result.value;
}

function request(
  value: LiquiditySnapshot,
  overrides: Partial<NumericalExactInputSplitRuntimeRequest> = {},
): NumericalExactInputSplitRuntimeRequest {
  return {
    snapshotId: value.snapshotId,
    snapshotChecksum: value.snapshotChecksum,
    assetIn: 'A',
    assetOut: 'C',
    amountIn: 100n,
    maxHops: 1,
    maxRoutes: 2,
    greedyParts: 2,
    numerical: {
      outerIterations: 64,
      innerIterations: 64,
      convergenceTolerance: 2 ** -40,
    },
    ...overrides,
  };
}

const COMPLETE_CAPS: NumericalExactInputSplitWorkCaps = {
  maxPathExpansions: 1_000,
  maxBestSingleCandidateReplays: 1_000,
  maxCandidateSetExpansions: 1_000,
  maxEqualProposalReplays: 1_000,
  maxGreedyOptionReplays: 1_000,
  maxFinalAuthorizationReplays: 1_000,
  maxNumericalProposals: 1_000,
  maxNumericalIterations: 1_000,
  maxNumericalResidualReplays: 1_000,
  maxNumericalAuthorizationReplays: 1_000,
};

function control(
  overrides: Partial<NumericalExactInputSplitWorkCaps> = {},
): NumericalExactInputSplitRuntimeControl {
  return { workCaps: { ...COMPLETE_CAPS, ...overrides } };
}

function success(result: ReturnType<typeof routeExactInputSplitNumericalAnytime>) {
  assert.equal(result.status, 'success');
  if (result.status !== 'success') throw new Error('Expected success.');
  return result.plan;
}

function assertDeepFrozen(value: unknown, seen = new Set<object>()): void {
  if (
    (typeof value !== 'object' && typeof value !== 'function') ||
    value === null ||
    seen.has(value)
  ) {
    return;
  }
  seen.add(value);
  assert.equal(Object.isFrozen(value), true);
  for (const key of Reflect.ownKeys(value)) {
    assertDeepFrozen(Reflect.get(value, key), seen);
  }
}

function oldRequest(
  numerical: NumericalExactInputSplitRuntimeRequest,
): ExactInputSplitRuntimeRequest {
  return {
    snapshotId: numerical.snapshotId,
    snapshotChecksum: numerical.snapshotChecksum,
    assetIn: numerical.assetIn,
    assetOut: numerical.assetOut,
    amountIn: numerical.amountIn,
    maxHops: numerical.maxHops,
    maxRoutes: numerical.maxRoutes,
    greedyParts: numerical.greedyParts,
  };
}

const IDENTICAL_POOLS = [pool('left-ac'), pool('right-ac')];

void test('resolves only canonical pool-disjoint financial routes into a fresh frozen graph', () => {
  const value = snapshot([
    pool('a-ax', 10n, 20n, 'A', 'X', 1n, 10n),
    pool('a-xc', 30n, 40n, 'X', 'C'),
    pool('b-ac', 50n, 60n),
  ]);
  const context = prepare(value);
  const routes = [
    [
      { assetIn: 'A', poolId: 'a-ax', assetOut: 'X' },
      { assetIn: 'X', poolId: 'a-xc', assetOut: 'C' },
    ],
    [{ assetIn: 'A', poolId: 'b-ac', assetOut: 'C' }],
  ] as const;
  const result = resolvePreparedPathShadowPriceRoutes(context, routes);
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error('Expected resolution to succeed.');
  assert.deepEqual(result.value, [
    [
      {
        reserveIn: 10n,
        reserveOut: 20n,
        feeChargedNumerator: 1n,
        feeDenominator: 10n,
      },
      {
        reserveIn: 30n,
        reserveOut: 40n,
        feeChargedNumerator: 0n,
        feeDenominator: 1n,
      },
    ],
    [
      {
        reserveIn: 50n,
        reserveOut: 60n,
        feeChargedNumerator: 0n,
        feeDenominator: 1n,
      },
    ],
  ]);
  assert.notEqual(result.value, routes);
  assertDeepFrozen(result);

  assert.deepEqual(resolvePreparedPathShadowPriceRoutes(context, [...routes].reverse()), {
    ok: false,
  });
  assert.deepEqual(
    resolvePreparedPathShadowPriceRoutes(context, [routes[0], routes[0]]),
    { ok: false },
  );
  assert.throws(
    () =>
      resolvePreparedPathShadowPriceRoutes(
        Object.freeze({}) as PreparedRoutingContext,
        routes,
      ),
    TypeError,
  );
});

void test('reproduces the protected baseline before a not-better numerical proposal', () => {
  const value = snapshot(IDENTICAL_POOLS);
  const context = prepare(value);
  const input = request(value);
  const numerical = success(
    routeExactInputSplitNumericalAnytime(context, input, control()),
  );
  const baseline = routeExactInputSplitAnytime(context, oldRequest(input), {
    workCaps: {
      maxPathExpansions: COMPLETE_CAPS.maxPathExpansions,
      maxBestSingleCandidateReplays: COMPLETE_CAPS.maxBestSingleCandidateReplays,
      maxCandidateSetExpansions: COMPLETE_CAPS.maxCandidateSetExpansions,
      maxEqualProposalReplays: COMPLETE_CAPS.maxEqualProposalReplays,
      maxGreedyOptionReplays: COMPLETE_CAPS.maxGreedyOptionReplays,
      maxFinalAuthorizationReplays: COMPLETE_CAPS.maxFinalAuthorizationReplays,
    },
  });
  assert.equal(baseline.status, 'success');
  if (baseline.status !== 'success') throw new Error('Expected baseline success.');
  assert.deepEqual(numerical.receipt, baseline.plan.receipt);
  for (const field of Object.keys(baseline.plan.search.counters) as Array<
    keyof typeof baseline.plan.search.counters
  >) {
    assert.equal(numerical.search.counters[field], baseline.plan.search.counters[field]);
  }
  assert.deepEqual(numerical.search.numericalDiagnostics, [
    {
      candidateSetKey: '[[["A","left-ac","C"]],[["A","right-ac","C"]]]',
      routeKeys: [
        '[["A","left-ac","C"]]',
        '[["A","right-ac","C"]]',
      ],
      status: 'not-better',
      failureCode: null,
      converged: true,
      completedOuterIterations: 64,
      configuredInnerIterations: 64,
      residualUnits: 0n,
      counters: {
        numericalProposals: 1,
        numericalProposalFailures: 0,
        numericalIterations: 64,
        numericalResidualReplays: 1,
        numericalResidualReplayRejections: 0,
        numericalAuthorizationReplays: 0,
        numericalAuthorizationReplayRejections: 0,
      },
    },
  ]);
  assertDeepFrozen(numerical);
});

void test('records a zero-attributable stopped identity when proposal capacity is absent', () => {
  const value = snapshot(IDENTICAL_POOLS);
  let callbacks = 0;
  const result = routeExactInputSplitNumericalAnytime(prepare(value), request(value), {
    workCaps: { ...COMPLETE_CAPS, maxNumericalProposals: 0 },
    shouldInterrupt() {
      callbacks += 1;
      return false;
    },
  });
  const plan = success(result);
  assert.equal(plan.search.termination, 'work-limit');
  assert.equal(callbacks > 0, true);
  const stopped = plan.search.numericalDiagnostics.at(-1);
  assert.equal(stopped?.status, 'stopped');
  assert.equal(stopped?.failureCode, null);
  assert.deepEqual(stopped?.counters, {
    numericalProposals: 0,
    numericalProposalFailures: 0,
    numericalIterations: 0,
    numericalResidualReplays: 0,
    numericalResidualReplayRejections: 0,
    numericalAuthorizationReplays: 0,
    numericalAuthorizationReplayRejections: 0,
  });
});

void test('closes the numerical stage independently at each additive cap', () => {
  const tieValue = snapshot([pool('a-ac', 4n, 9n), pool('b-ac', 1n, 9n)]);
  const cases: ReadonlyArray<{
    field: keyof NumericalExactInputSplitWorkCaps;
    value: LiquiditySnapshot;
    input: NumericalExactInputSplitRuntimeRequest;
    expected: Partial<{
      proposals: number;
      iterations: number;
      residual: number;
      authorization: number;
    }>;
  }> = [
    {
      field: 'maxNumericalProposals',
      value: tieValue,
      input: request(tieValue, { amountIn: 3n, greedyParts: 1 }),
      expected: { proposals: 0 },
    },
    {
      field: 'maxNumericalIterations',
      value: tieValue,
      input: request(tieValue, { amountIn: 3n, greedyParts: 1 }),
      expected: { proposals: 1, iterations: 0 },
    },
    {
      field: 'maxNumericalResidualReplays',
      value: tieValue,
      input: request(tieValue, { amountIn: 3n, greedyParts: 1 }),
      expected: { proposals: 1, iterations: 64, residual: 0 },
    },
    {
      field: 'maxNumericalAuthorizationReplays',
      value: tieValue,
      input: request(tieValue, { amountIn: 3n, greedyParts: 1 }),
      expected: { proposals: 1, iterations: 64, residual: 2, authorization: 0 },
    },
  ];
  for (const fixture of cases) {
    const plan = success(
      routeExactInputSplitNumericalAnytime(
        prepare(fixture.value),
        fixture.input,
        control({ [fixture.field]: 0 }),
      ),
    );
    assert.equal(plan.search.termination, 'work-limit', fixture.field);
    const stopped = plan.search.numericalDiagnostics.at(-1);
    assert.equal(stopped?.status, 'stopped', fixture.field);
    if (fixture.expected.proposals !== undefined) {
      assert.equal(stopped?.counters.numericalProposals, fixture.expected.proposals);
    }
    if (fixture.expected.iterations !== undefined) {
      assert.equal(stopped?.counters.numericalIterations, fixture.expected.iterations);
    }
    if (fixture.expected.residual !== undefined) {
      assert.equal(stopped?.counters.numericalResidualReplays, fixture.expected.residual);
    }
    if (fixture.expected.authorization !== undefined) {
      assert.equal(
        stopped?.counters.numericalAuthorizationReplays,
        fixture.expected.authorization,
      );
    }
  }
});

void test('interrupts before each additive work kind without charging the pending unit', () => {
  const value = snapshot([pool('a-ac', 4n, 9n), pool('b-ac', 1n, 9n)]);
  const kinds: readonly NumericalExactInputSplitRuntimeWorkKind[] = [
    'numerical-proposal',
    'numerical-iteration',
    'numerical-residual-replay',
    'numerical-authorization-replay',
  ];
  for (const target of kinds) {
    let checkpointCounters: unknown;
    const plan = success(
      routeExactInputSplitNumericalAnytime(
        prepare(value),
        request(value, { amountIn: 3n, greedyParts: 1 }),
        {
          workCaps: COMPLETE_CAPS,
          shouldInterrupt(checkpoint) {
            if (checkpoint.nextWorkKind !== target) return false;
            checkpointCounters = checkpoint.counters;
            return true;
          },
        },
      ),
    );
    assert.equal(plan.search.termination, 'interrupted', target);
    assert.deepEqual(plan.search.counters, checkpointCounters, target);
    assert.equal(plan.search.numericalDiagnostics.at(-1)?.status, 'stopped', target);
    assert.deepEqual(plan.receipt.legs.map(({ allocation }) => allocation), [2n, 1n]);
  }
});

void test('applies callback-before-deadline precedence at every additive work kind', () => {
  const value = snapshot([pool('a-ac', 4n, 9n), pool('b-ac', 1n, 9n)]);
  const kinds: readonly NumericalExactInputSplitRuntimeWorkKind[] = [
    'numerical-proposal',
    'numerical-iteration',
    'numerical-residual-replay',
    'numerical-authorization-replay',
  ];
  for (const target of kinds) {
    let pendingKind: NumericalExactInputSplitRuntimeWorkKind | undefined;
    const plan = success(
      routeExactInputSplitNumericalAnytime(
        prepare(value),
        request(value, { amountIn: 3n, greedyParts: 1 }),
        {
          workCaps: COMPLETE_CAPS,
          shouldInterrupt(checkpoint) {
            pendingKind = checkpoint.nextWorkKind;
            return false;
          },
          deadline: {
            deadlineNanoseconds: 5n,
            nowNanoseconds() {
              return pendingKind === target ? 5n : 0n;
            },
          },
        },
      ),
    );
    assert.equal(plan.search.termination, 'deadline', target);
    assert.equal(plan.search.numericalDiagnostics.at(-1)?.status, 'stopped', target);
    assert.deepEqual(plan.receipt.legs.map(({ allocation }) => allocation), [2n, 1n]);
  }

  let targetReached = false;
  const controlError = routeExactInputSplitNumericalAnytime(
    prepare(value),
    request(value, { amountIn: 3n, greedyParts: 1 }),
    {
      workCaps: COMPLETE_CAPS,
      shouldInterrupt(checkpoint) {
        if (checkpoint.nextWorkKind !== 'numerical-residual-replay') return false;
        targetReached = true;
        throw new Error('forced');
      },
      deadline: {
        deadlineNanoseconds: 100n,
        nowNanoseconds() {
          if (targetReached) throw new Error('must not sample after callback failure');
          return 0n;
        },
      },
    },
  );
  assert.equal(controlError.status, 'control-error');
  assert.equal(targetReached, true);
});

void test('improves the allocation-vector tie only after distinct numerical authorization', () => {
  const value = snapshot([pool('a-ac', 4n, 9n), pool('b-ac', 1n, 9n)]);
  const observed: NumericalExactInputSplitRuntimeWorkKind[] = [];
  const plan = success(
    routeExactInputSplitNumericalAnytime(
      prepare(value),
      request(value, { amountIn: 3n, greedyParts: 1 }),
      {
        workCaps: COMPLETE_CAPS,
        shouldInterrupt(checkpoint) {
          observed.push(checkpoint.nextWorkKind);
          assertDeepFrozen(checkpoint);
          return false;
        },
      },
    ),
  );
  assert.deepEqual(plan.receipt.legs.map(({ allocation }) => allocation), [1n, 2n]);
  assert.equal(plan.receipt.amountOut, 7n);
  assert.equal(plan.search.numericalDiagnostics[0]?.status, 'improved');
  assert.ok(observed.includes('numerical-proposal'));
  assert.ok(observed.includes('numerical-iteration'));
  assert.ok(observed.includes('numerical-residual-replay'));
  assert.ok(observed.includes('numerical-authorization-replay'));
  assert.equal(plan.search.counters.numericalAuthorizationReplays, 1);
});

void test('forces proposal-driver failures without weakening real replay authorization', () => {
  const value = snapshot(IDENTICAL_POOLS);
  const realFailure: NumericalExactInputSplitProposalDriver = {
    prepare() {
      return {
        ok: false,
        error: {
          code: 'invalid-route-model',
          converged: false,
          completedOuterIterations: 0,
        },
      };
    },
    advance() {
      throw new Error('advance must not run');
    },
    finalize() {
      throw new Error('finalize must not run');
    },
  };
  const plan = success(
    routeExactInputSplitNumericalAnytimeWithProposalDriver(
      prepare(value),
      request(value),
      control(),
      realFailure,
    ),
  );
  assert.equal(plan.receipt.amountOut, 66n);
  assert.equal(plan.search.numericalDiagnostics[0]?.failureCode, 'invalid-route-model');
  assert.equal(plan.search.counters.numericalProposalFailures, 1);
});

void test('maps unreachable reconstruction failures through only the proposal driver seam', () => {
  const value = snapshot(IDENTICAL_POOLS);
  for (const code of ['zero-total-weight', 'invalid-reconstruction'] as const) {
    const driver: NumericalExactInputSplitProposalDriver = {
      prepare: preparePathShadowPriceProposal,
      advance: advancePathShadowPriceProposal,
      finalize(state) {
        const actual = finalizePathShadowPriceProposal(state);
        assert.equal(actual.ok, true);
        return {
          ok: false,
          error: {
            code,
            converged: true,
            completedOuterIterations: state.completedOuterIterations,
          },
        };
      },
    };
    const plan = success(
      routeExactInputSplitNumericalAnytimeWithProposalDriver(
        prepare(value),
        request(value),
        control(),
        driver,
      ),
    );
    assert.equal(plan.search.numericalDiagnostics[0]?.failureCode, code);
    assert.equal(plan.search.numericalDiagnostics[0]?.converged, true);
    assert.equal(plan.search.counters.numericalProposalFailures, 1);
    assert.equal(plan.receipt.amountOut, 66n);
  }
});

void test('maps naturally reachable normalization, proposal, and convergence failures', () => {
  const nonconvergentValue = snapshot([
    pool('a-ac', 4n, 9n),
    pool('b-ac', 1n, 9n),
  ]);
  const nonconvergent = success(
    routeExactInputSplitNumericalAnytime(
      prepare(nonconvergentValue),
      request(nonconvergentValue, {
        amountIn: 3n,
        greedyParts: 1,
        numerical: {
          outerIterations: 1,
          innerIterations: 1,
          convergenceTolerance: 2 ** -1022,
        },
      }),
      control(),
    ),
  );
  assert.equal(
    nonconvergent.search.numericalDiagnostics[0]?.failureCode,
    'non-convergence',
  );
  assert.equal(nonconvergent.search.numericalDiagnostics[0]?.completedOuterIterations, 1);

  const normalizationValue = snapshot([
    pool('a-ac', 100n, 100n),
    pool('b-ac', 100n, 100n),
    pool('z-ac', 1n << 1_100n, 1n),
  ]);
  const normalization = success(
    routeExactInputSplitNumericalAnytime(
      prepare(normalizationValue),
      request(normalizationValue, {
        numerical: {
          outerIterations: 4,
          innerIterations: 4,
          convergenceTolerance: 1,
        },
      }),
      control(),
    ),
  );
  assert.equal(
    normalization.search.numericalDiagnostics.filter(
      ({ failureCode }) => failureCode === 'non-finite-normalization',
    ).length,
    2,
  );

  const proposalValue = snapshot([
    pool('a-ac', 1n, 2n),
    pool('b-ac', 1n << 1_021n, 1n),
    pool('c-ac', 1n << 1_022n, 1n),
  ]);
  const proposal = success(
    routeExactInputSplitNumericalAnytime(
      prepare(proposalValue),
      request(proposalValue, { amountIn: 1n, greedyParts: 1 }),
      control({ maxNumericalIterations: 1_000 }),
    ),
  );
  const underflow = proposal.search.numericalDiagnostics.find(
    ({ failureCode }) => failureCode === 'non-finite-proposal',
  );
  assert.equal(underflow?.completedOuterIterations, 53);
  assert.equal(underflow?.counters.numericalIterations, 54);
  assert.equal(proposal.receipt.amountOut, 1n);
});

void test('counts each rejected residual option and classifies full exhaustion once', () => {
  const value = snapshot([pool('a-ac', 2n, 2n), pool('b-ac', 2n, 2n)]);
  const plan = success(
    routeExactInputSplitNumericalAnytime(
      prepare(value),
      request(value, { amountIn: 3n, greedyParts: 3 }),
      control(),
    ),
  );
  const failure = plan.search.numericalDiagnostics[0];
  assert.equal(failure?.failureCode, 'residual-options-exhausted');
  assert.equal(failure?.residualUnits, 1n);
  assert.equal(failure?.counters.numericalProposalFailures, 0);
  assert.equal(failure?.counters.numericalResidualReplays, 2);
  assert.equal(failure?.counters.numericalResidualReplayRejections, 2);
  assert.equal(plan.search.counters.numericalResidualReplayRejections, 2);
  assert.equal(plan.receipt.amountOut, 1n);
});

void test('classifies authorization rejection and mismatch while preserving the baseline', () => {
  const value = snapshot([pool('a-ac', 4n, 9n), pool('b-ac', 1n, 9n)]);
  const input = request(value, { amountIn: 3n, greedyParts: 1 });
  const rejected = success(
    routeExactInputSplitNumericalAnytimeWithAuthorizationReplay(
      prepare(value),
      input,
      control(),
      (): ExactInputSplitReplayResult => ({
        ok: false,
        error: {
          code: 'empty-legs',
          message: 'forced',
          legIndex: null,
          causeCode: null,
        },
      }),
    ),
  );
  assert.deepEqual(rejected.receipt.legs.map(({ allocation }) => allocation), [2n, 1n]);
  assert.equal(
    rejected.search.numericalDiagnostics[0]?.failureCode,
    'authorization-replay-rejected',
  );
  assert.equal(rejected.search.counters.numericalAuthorizationReplayRejections, 1);

  const mismatch = success(
    routeExactInputSplitNumericalAnytimeWithAuthorizationReplay(
      prepare(value),
      input,
      control(),
      (context, replayRequest) => {
        const actual = routeExactInputSplitNumericalAnytime(
          context,
          input,
          { workCaps: { ...COMPLETE_CAPS, maxNumericalProposals: 0 } },
        );
        assert.equal(actual.status, 'success');
        if (actual.status !== 'success') throw new Error('Expected nested success.');
        return {
          ok: true,
          value: Object.freeze({
            ...actual.plan.receipt,
            amountIn: replayRequest.amountIn,
          }),
        };
      },
    ),
  );
  assert.equal(
    mismatch.search.numericalDiagnostics[0]?.failureCode,
    'authorization-result-mismatch',
  );
  assert.deepEqual(mismatch.receipt.legs.map(({ allocation }) => allocation), [2n, 1n]);
});

void test('keeps arbitrary-precision reconstruction exact and returns no caller aliases', () => {
  const value = snapshot([
    pool('left-ac', 10n ** 90n, 10n ** 90n),
    pool('right-ac', 10n ** 90n, 10n ** 90n),
  ]);
  const amountIn = 10n ** 80n + 1n;
  const numerical = {
    outerIterations: 64,
    innerIterations: 64,
    convergenceTolerance: 2 ** -40,
  };
  const plan = success(
    routeExactInputSplitNumericalAnytime(
      prepare(value),
      request(value, { amountIn, numerical }),
      control(),
    ),
  );
  const allocated = plan.receipt.legs.reduce(
    (sum, leg) => sum + leg.allocation,
    0n,
  );
  assert.equal(allocated, amountIn);
  assert.notEqual(plan.search.numericalDiagnostics[0]?.routeKeys, numerical);
  assertDeepFrozen(plan);
});

void test('captures request and ten caps in order before work and rejects invalid additive fields', () => {
  const value = snapshot(IDENTICAL_POOLS);
  const seen: string[] = [];
  const source = request(value);
  const proxied = new Proxy(source, {
    get(target, property, receiver) {
      seen.push(String(property));
      const captured: unknown = Reflect.get(target, property, receiver);
      return captured;
    },
  });
  const caps = new Proxy(
    { ...COMPLETE_CAPS, maxNumericalIterations: -1 },
    {
      get(target, property, receiver) {
        seen.push(`cap:${String(property)}`);
        const captured: unknown = Reflect.get(target, property, receiver);
        return captured;
      },
    },
  );
  const result = routeExactInputSplitNumericalAnytime(prepare(value), proxied, {
    workCaps: caps,
  });
  assert.deepEqual(result, {
    status: 'invalid-control',
    error: {
      code: 'invalid-work-cap',
      field: 'workCaps.maxNumericalIterations',
    },
  });
  assert.deepEqual(seen.slice(0, 9), [
    'snapshotId',
    'snapshotChecksum',
    'assetIn',
    'assetOut',
    'amountIn',
    'maxHops',
    'maxRoutes',
    'greedyParts',
    'numerical',
  ]);
  assert.deepEqual(seen.filter((item) => item.startsWith('cap:')), [
    'cap:maxPathExpansions',
    'cap:maxBestSingleCandidateReplays',
    'cap:maxCandidateSetExpansions',
    'cap:maxEqualProposalReplays',
    'cap:maxGreedyOptionReplays',
    'cap:maxFinalAuthorizationReplays',
    'cap:maxNumericalProposals',
    'cap:maxNumericalIterations',
  ]);
});

void test('retains inherited request precedence over captured numerical failures', () => {
  const value = snapshot(IDENTICAL_POOLS);
  const accessed: string[] = [];
  const numerical = {
    get outerIterations(): number {
      accessed.push('outerIterations');
      throw new Error('forced');
    },
    get innerIterations(): number {
      accessed.push('innerIterations');
      return 1;
    },
    get convergenceTolerance(): number {
      accessed.push('convergenceTolerance');
      return 1;
    },
  };
  const inherited = routeExactInputSplitNumericalAnytime(
    prepare(value),
    request(value, { snapshotChecksum: 'wrong', numerical }),
    control(),
  );
  assert.deepEqual(inherited, {
    status: 'invalid-request',
    error: { code: 'snapshot-identity-mismatch', field: 'snapshotIdentity' },
  });
  assert.deepEqual(accessed, [
    'outerIterations',
    'innerIterations',
    'convergenceTolerance',
  ]);

  const numericalFailure = routeExactInputSplitNumericalAnytime(
    prepare(value),
    request(value, { numerical }),
    control(),
  );
  assert.deepEqual(numericalFailure, {
    status: 'invalid-request',
    error: {
      code: 'invalid-outer-iterations',
      field: 'numerical.outerIterations',
    },
  });
});

void test('captures numerical configuration before reentrant controls can mutate caller state', () => {
  const value = snapshot(IDENTICAL_POOLS);
  const numerical = {
    outerIterations: 4,
    innerIterations: 8,
    convergenceTolerance: 1,
  };
  let nested = false;
  const context = prepare(value);
  const input = request(value, { numerical });
  const plan = success(
    routeExactInputSplitNumericalAnytime(context, input, {
      workCaps: COMPLETE_CAPS,
      shouldInterrupt() {
        numerical.outerIterations = 1;
        numerical.innerIterations = 1;
        if (!nested) {
          nested = true;
          const nestedResult = routeExactInputSplitNumericalAnytime(
            context,
            request(value),
            control({ maxNumericalProposals: 0 }),
          );
          assert.equal(nestedResult.status, 'success');
        }
        return false;
      },
    }),
  );
  assert.equal(plan.search.numericalDiagnostics[0]?.completedOuterIterations, 4);
  assert.equal(plan.search.numericalDiagnostics[0]?.configuredInnerIterations, 8);
  assert.equal(nested, true);
});

void test('does no numerical work and emits no diagnostics without an exact baseline', () => {
  const value = snapshot([
    pool('ax', 100n, 100n, 'A', 'X'),
    pool('xc', 100n, 100n, 'X', 'C'),
  ]);
  const result = routeExactInputSplitNumericalAnytime(
    prepare(value),
    request(value, { maxHops: 2 }),
    control({ maxPathExpansions: 0 }),
  );
  assert.equal(result.status, 'no-plan');
  if (result.status !== 'no-plan') throw new Error('Expected no plan.');
  assert.equal(result.reason, 'work-limit');
  assert.equal(result.search.counters.numericalProposals, 0);
  assert.deepEqual(result.search.numericalDiagnostics, []);
  assertDeepFrozen(result);
});
