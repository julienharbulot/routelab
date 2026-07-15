import { createHash } from 'node:crypto';

import { quote, type QuoteEffort, type QuoteStrategy, type ValidatedQuote } from '../../index.ts';
import { PUBLIC_EFFORTS, QUALITY_MODES } from './config.ts';
import { runReference } from './reference.ts';
import type {
  AggregateDimension,
  BenchmarkProfile,
  BenchmarkStrategy,
  ExactBenchmarkOutcome,
  ExactBenchmarkQuote,
  NumericalComparison,
  PortfolioCase,
  QualityAggregate,
  QualityRow,
  SerializedBenchmarkRoute,
} from './types.ts';

const ONE_MILLION = 1_000_000n;

function publicOutcome(
  input: PortfolioCase,
  strategy: QuoteStrategy,
  effort: QuoteEffort,
): ExactBenchmarkOutcome {
  const result = quote(input.context, input.request, {
    strategy,
    effort,
    includeDiagnostics: true,
  });
  if (!result.ok) {
    if (result.error.code === 'no-route') return Object.freeze({ outcome: 'no-route' });
    throw new Error(`${strategy}/${effort} failed for ${input.caseId}: ${result.error.code}.`);
  }
  return Object.freeze({ outcome: 'quote', value: fromPublicQuote(result.value) });
}

function numericWork(value: Readonly<Record<string, number>>, key: string): number {
  return value[key] ?? 0;
}

function fromPublicQuote(value: ValidatedQuote): ExactBenchmarkQuote {
  const work = value.diagnostics?.work ?? Object.freeze({});
  return Object.freeze({
    amountOut: value.amountOut,
    routes: Object.freeze(value.routes.map((route) => Object.freeze({
      allocation: route.allocation,
      amountOut: route.amountOut,
      hops: Object.freeze(route.hops.map(({ poolId, assetIn, assetOut }) => Object.freeze({
        poolId,
        assetIn,
        assetOut,
      }))),
    }))),
    termination: value.termination,
    work,
    numericalProposals: value.diagnostics?.numericalProposals ?? 0,
    numericalIterations: value.diagnostics?.numericalIterations ?? 0,
    numericalProposalFailures: numericWork(work, 'numericalProposalFailures'),
    numericalConverged: value.diagnostics?.numericalConverged ?? null,
    authorizationRejections: value.diagnostics?.authorizationRejections ?? 0,
    planFingerprint: value.planFingerprint,
  });
}

function serializedRoutes(value: ExactBenchmarkQuote): readonly SerializedBenchmarkRoute[] {
  return Object.freeze(value.routes.map((route) => Object.freeze({
    allocation: route.allocation.toString(10),
    amountOut: route.amountOut.toString(10),
    hops: route.hops,
  })));
}

function safePpm(numerator: bigint, denominator: bigint): number {
  if (numerator <= 0n || denominator <= 0n) return 0;
  const value = numerator * ONE_MILLION / denominator;
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error('Benchmark fixed-point metric exceeds the safe integer range.');
  }
  return Number(value);
}

function regretPpm(output: bigint, comparison: bigint): number {
  return output >= comparison ? 0 : safePpm(comparison - output, comparison);
}

function withinBps(output: bigint, comparison: bigint, threshold: number): boolean {
  return output >= comparison
    || (comparison - output) * 10_000n <= comparison * BigInt(threshold);
}

function row(
  input: PortfolioCase,
  strategy: BenchmarkStrategy,
  profile: BenchmarkProfile,
  outcome: ExactBenchmarkOutcome,
  bestSingle: bigint | null,
  reference: bigint | null,
  comparison: bigint | null,
): QualityRow {
  if (outcome.outcome === 'no-route') {
    return Object.freeze({
      caseId: input.caseId,
      amountBucket: input.amountBucket,
      topology: input.topology,
      strategy,
      profile,
      outcome: 'no-route',
      amountIn: input.request.amountIn.toString(10),
      amountOut: null,
      referenceAmountOut: reference?.toString(10) ?? null,
      comparisonAmountOut: comparison?.toString(10) ?? null,
      exactReplayPassed: false,
      exactReferenceEquality: reference === null,
      regretPpm: null,
      within1Bps: false,
      within10Bps: false,
      within100Bps: false,
      improvementOverBestSinglePpm: null,
      bestSingleImproved: false,
      splitSelected: false,
      splitImproved: false,
      routeCount: 0,
      hopCount: 0,
      termination: 'no-route',
      work: Object.freeze({}),
      numericalProposals: 0,
      numericalIterations: 0,
      numericalProposalFailures: 0,
      numericalConverged: null,
      authorizationRejections: 0,
      referenceBeaten: false,
      planFingerprint: null,
      routes: Object.freeze([]),
    });
  }
  if (comparison === null) throw new Error(`Missing comparison output for ${input.caseId}.`);
  const value = outcome.value;
  const improved = bestSingle !== null && value.amountOut > bestSingle;
  const splitSelected = value.routes.length > 1;
  return Object.freeze({
    caseId: input.caseId,
    amountBucket: input.amountBucket,
    topology: input.topology,
    strategy,
    profile,
    outcome: 'quote',
    amountIn: input.request.amountIn.toString(10),
    amountOut: value.amountOut.toString(10),
    referenceAmountOut: reference?.toString(10) ?? null,
    comparisonAmountOut: comparison.toString(10),
    exactReplayPassed: true,
    exactReferenceEquality: reference !== null && value.amountOut === reference,
    regretPpm: regretPpm(value.amountOut, comparison),
    within1Bps: withinBps(value.amountOut, comparison, 1),
    within10Bps: withinBps(value.amountOut, comparison, 10),
    within100Bps: withinBps(value.amountOut, comparison, 100),
    improvementOverBestSinglePpm: bestSingle === null
      ? null
      : safePpm(value.amountOut - bestSingle, bestSingle),
    bestSingleImproved: improved,
    splitSelected,
    splitImproved: splitSelected && improved,
    routeCount: value.routes.length,
    hopCount: value.routes.reduce((sum, route) => sum + route.hops.length, 0),
    termination: value.termination,
    work: value.work,
    numericalProposals: value.numericalProposals,
    numericalIterations: value.numericalIterations,
    numericalProposalFailures: value.numericalProposalFailures,
    numericalConverged: value.numericalConverged,
    authorizationRejections: value.authorizationRejections,
    referenceBeaten: reference !== null && value.amountOut > reference,
    planFingerprint: value.planFingerprint,
    routes: serializedRoutes(value),
  });
}

function exactOutput(outcome: ExactBenchmarkOutcome): bigint | null {
  return outcome.outcome === 'quote' ? outcome.value.amountOut : null;
}

function assertExpected(input: PortfolioCase, outcome: ExactBenchmarkOutcome, label: string): void {
  if (outcome.outcome !== input.expectedOutcome) {
    throw new Error(`${label} returned ${outcome.outcome} for ${input.caseId}.`);
  }
}

export function runQuality(cases: readonly PortfolioCase[]): readonly QualityRow[] {
  const rows: QualityRow[] = [];
  for (const input of cases) {
    const outcomes = new Map<string, ExactBenchmarkOutcome>();
    for (const mode of QUALITY_MODES) {
      const outcome = mode.strategy === 'bounded-reference'
        ? runReference(input)
        : publicOutcome(input, mode.strategy, mode.profile as QuoteEffort);
      assertExpected(input, outcome, `${mode.strategy}/${mode.profile}`);
      outcomes.set(`${mode.strategy}\0${mode.profile}`, outcome);
    }
    const bestOutcome = outcomes.get('best-single\0fast');
    const referenceOutcome = outcomes.get('bounded-reference\0reference');
    if (bestOutcome === undefined || referenceOutcome === undefined) {
      throw new Error(`Benchmark modes are incomplete for ${input.caseId}.`);
    }
    const outputs = [...outcomes.values()].flatMap((outcome) => {
      const output = exactOutput(outcome);
      return output === null ? [] : [output];
    });
    const comparison = outputs.reduce<bigint | null>(
      (maximum, output) => maximum === null || output > maximum ? output : maximum,
      null,
    );
    const bestSingle = exactOutput(bestOutcome);
    const reference = exactOutput(referenceOutcome);
    for (const mode of QUALITY_MODES) {
      const outcome = outcomes.get(`${mode.strategy}\0${mode.profile}`);
      if (outcome === undefined) throw new Error('Benchmark mode result disappeared.');
      rows.push(row(
        input,
        mode.strategy,
        mode.profile,
        outcome,
        bestSingle,
        reference,
        comparison,
      ));
    }
  }
  return Object.freeze(rows);
}

function percentile(values: readonly number[], fraction: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)] ?? null;
}

function ratePpm(numerator: number, denominator: number): number | null {
  if (denominator === 0) return null;
  return Number(BigInt(numerator) * ONE_MILLION / BigInt(denominator));
}

export function workTotal(rowValue: QualityRow): number {
  return Object.values(rowValue.work).reduce((sum, value) => sum + value, 0);
}

interface Group {
  readonly dimension: AggregateDimension;
  readonly group: string;
  readonly select: (rowValue: QualityRow) => boolean;
}

const GROUPS: readonly Group[] = Object.freeze([
  Object.freeze({ dimension: 'overall', group: 'all', select: () => true }),
  ...['max-reserve-1-in-100000', 'max-reserve-1-in-10000', 'max-reserve-1-in-1000'].map(
    (group) => Object.freeze({
      dimension: 'amountBucket' as const,
      group,
      select: (value: QualityRow) => value.amountBucket === group,
    }),
  ),
  ...['direct-edge-present', 'direct-edge-absent-common-neighbor-present'].map(
    (group) => Object.freeze({
      dimension: 'topology' as const,
      group,
      select: (value: QualityRow) => value.topology === group,
    }),
  ),
]);

export function aggregateQuality(rows: readonly QualityRow[]): readonly QualityAggregate[] {
  const aggregates: QualityAggregate[] = [];
  for (const mode of QUALITY_MODES) {
    const modeRows = rows.filter((value) =>
      value.strategy === mode.strategy && value.profile === mode.profile
    );
    for (const group of GROUPS) {
      const selected = modeRows.filter(group.select);
      const quotes = selected.filter((value) => value.outcome === 'quote');
      const regret = quotes.flatMap((value) => value.regretPpm === null ? [] : [value.regretPpm]);
      const improvement = quotes.flatMap((value) =>
        value.improvementOverBestSinglePpm === null || !value.bestSingleImproved
          ? []
          : [value.improvementOverBestSinglePpm]
      );
      const work = quotes.map(workTotal);
      const numerical = quotes.filter((value) => value.numericalConverged !== null);
      aggregates.push(Object.freeze({
        dimension: group.dimension,
        group: group.group,
        strategy: mode.strategy,
        profile: mode.profile,
        requestCount: selected.length,
        quoteCount: quotes.length,
        noRouteCount: selected.length - quotes.length,
        exactReplaySuccessCount: quotes.filter((value) => value.exactReplayPassed).length,
        exactReferenceEqualityCount: quotes.filter((value) => value.exactReferenceEquality).length,
        regretP50Ppm: percentile(regret, 0.50),
        regretP90Ppm: percentile(regret, 0.90),
        regretP95Ppm: percentile(regret, 0.95),
        worstRegretPpm: regret.length === 0 ? null : Math.max(...regret),
        withinExactRatePpm: ratePpm(
          quotes.filter((value) => value.amountOut === value.comparisonAmountOut).length,
          quotes.length,
        ),
        within1BpsRatePpm: ratePpm(quotes.filter((value) => value.within1Bps).length, quotes.length),
        within10BpsRatePpm: ratePpm(quotes.filter((value) => value.within10Bps).length, quotes.length),
        within100BpsRatePpm: ratePpm(quotes.filter((value) => value.within100Bps).length, quotes.length),
        bestSingleImprovementRatePpm: ratePpm(
          quotes.filter((value) => value.bestSingleImproved).length,
          quotes.length,
        ),
        splitSelectedRatePpm: ratePpm(
          quotes.filter((value) => value.splitSelected).length,
          quotes.length,
        ),
        splitImprovementRatePpm: ratePpm(
          quotes.filter((value) => value.splitImproved).length,
          quotes.length,
        ),
        medianImprovementPpm: percentile(improvement, 0.50),
        maximumImprovementPpm: improvement.length === 0 ? null : Math.max(...improvement),
        workP50: percentile(work, 0.50),
        workP95: percentile(work, 0.95),
        authorizationRejectionCount: quotes.reduce(
          (sum, value) => sum + value.authorizationRejections,
          0,
        ),
        numericalProposalFailureCount: quotes.reduce(
          (sum, value) => sum + value.numericalProposalFailures,
          0,
        ),
        numericalRequestCount: numerical.length,
        numericalConvergedCount: numerical.filter((value) => value.numericalConverged).length,
        numericalConvergenceRatePpm: ratePpm(
          numerical.filter((value) => value.numericalConverged).length,
          numerical.length,
        ),
        referenceBeatenCount: quotes.filter((value) => value.referenceBeaten).length,
      }));
    }
  }
  return Object.freeze(aggregates);
}

function rowFor(
  rows: readonly QualityRow[],
  caseId: string,
  strategy: BenchmarkStrategy,
  profile: BenchmarkProfile,
): QualityRow {
  const found = rows.find((value) =>
    value.caseId === caseId && value.strategy === strategy && value.profile === profile
  );
  if (found === undefined) throw new Error(`Missing ${caseId}/${strategy}/${profile}.`);
  return found;
}

export function compareNumerical(rows: readonly QualityRow[]): readonly NumericalComparison[] {
  const comparisons: NumericalComparison[] = [];
  for (const profile of PUBLIC_EFFORTS) {
    const numericalRows = rows.filter((value) =>
      value.strategy === 'numerical-split' && value.profile === profile
    );
    for (const group of GROUPS) {
      const selected = numericalRows.filter(group.select);
      let beatsGreedy = 0;
      let tiesGreedy = 0;
      let losesGreedy = 0;
      let totalAdditionalWork = 0;
      const improvements: number[] = [];
      for (const numerical of selected) {
        const greedy = rowFor(rows, numerical.caseId, 'greedy-split', profile);
        totalAdditionalWork += workTotal(numerical) - workTotal(greedy);
        if (numerical.amountOut === null || greedy.amountOut === null) {
          if (numerical.amountOut === greedy.amountOut) tiesGreedy += 1;
          else if (numerical.amountOut === null) losesGreedy += 1;
          else beatsGreedy += 1;
          continue;
        }
        const numericalOutput = BigInt(numerical.amountOut);
        const greedyOutput = BigInt(greedy.amountOut);
        if (numericalOutput > greedyOutput) {
          beatsGreedy += 1;
          improvements.push(safePpm(numericalOutput - greedyOutput, greedyOutput));
        } else if (numericalOutput < greedyOutput) {
          losesGreedy += 1;
        } else {
          tiesGreedy += 1;
        }
      }
      comparisons.push(Object.freeze({
        dimension: group.dimension,
        group: group.group,
        profile,
        requestCount: selected.length,
        beatsGreedy,
        tiesGreedy,
        losesGreedy,
        medianPositiveImprovementPpm: percentile(improvements, 0.50),
        maximumPositiveImprovementPpm: improvements.length === 0
          ? null
          : Math.max(...improvements),
        totalAdditionalWork,
      }));
    }
  }
  return Object.freeze(comparisons);
}

export function canonicalDigest(value: unknown): string {
  return `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
}
