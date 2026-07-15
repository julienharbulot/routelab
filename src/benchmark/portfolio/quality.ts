import { quote, type QuoteEffort, type QuoteStrategy, type ValidatedQuote } from '../../index.ts';
import { PUBLIC_EFFORTS, PUBLIC_STRATEGIES } from './config.ts';
import { runReference } from './reference.ts';
import type {
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

function fromPublicQuote(value: ValidatedQuote): ExactBenchmarkQuote {
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
    work: value.work,
    numericalProposals: value.diagnostics?.numericalProposals ?? 0,
    numericalIterations: value.diagnostics?.numericalIterations ?? 0,
    numericalConverged: value.diagnostics?.numericalConverged ?? null,
    authorizationRejections: value.diagnostics?.authorizationRejections ?? 0,
    semanticFingerprint: value.semanticFingerprint,
  });
}

function routes(value: ExactBenchmarkQuote): readonly SerializedBenchmarkRoute[] {
  return Object.freeze(value.routes.map((route) => Object.freeze({
    allocation: route.allocation.toString(10),
    amountOut: route.amountOut.toString(10),
    hops: route.hops,
  })));
}

function regretBps(output: bigint, reference: bigint): number {
  if (reference === 0n || output >= reference) return 0;
  return Number(((reference - output) * 10_000n) / reference);
}

function row(
  input: PortfolioCase,
  strategy: BenchmarkStrategy,
  profile: BenchmarkProfile,
  outcome: ExactBenchmarkOutcome,
  bestSingle: bigint | null,
  reference: bigint | null,
): QualityRow {
  if (outcome.outcome === 'no-route') {
    return Object.freeze({
      caseId: input.caseId,
      strategy,
      profile,
      outcome: 'no-route',
      amountIn: input.request.amountIn.toString(10),
      amountOut: null,
      improvementOverBestSingle: null,
      regretBps: null,
      routeCount: 0,
      hopCount: 0,
      termination: 'no-route',
      work: Object.freeze({}),
      numericalProposals: 0,
      numericalIterations: 0,
      numericalConverged: null,
      authorizationRejections: 0,
      semanticFingerprint: null,
      routes: Object.freeze([]),
    });
  }
  const value = outcome.value;
  return Object.freeze({
    caseId: input.caseId,
    strategy,
    profile,
    outcome: 'quote',
    amountIn: input.request.amountIn.toString(10),
    amountOut: value.amountOut.toString(10),
    improvementOverBestSingle:
      bestSingle === null ? null : (value.amountOut - bestSingle).toString(10),
    regretBps: reference === null ? null : regretBps(value.amountOut, reference),
    routeCount: value.routes.length,
    hopCount: value.routes.reduce((sum, route) => sum + route.hops.length, 0),
    termination: value.termination,
    work: value.work,
    numericalProposals: value.numericalProposals,
    numericalIterations: value.numericalIterations,
    numericalConverged: value.numericalConverged,
    authorizationRejections: value.authorizationRejections,
    semanticFingerprint: value.semanticFingerprint,
    routes: routes(value),
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
    const reference = runReference(input);
    const best = publicOutcome(input, 'best-single', 'thorough');
    assertExpected(input, reference, 'reference');
    assertExpected(input, best, 'best-single/thorough');
    const referenceOutput = exactOutput(reference);
    const bestOutput = exactOutput(best);
    for (const profile of PUBLIC_EFFORTS) {
      for (const strategy of PUBLIC_STRATEGIES) {
        const outcome = publicOutcome(input, strategy, profile);
        assertExpected(input, outcome, `${strategy}/${profile}`);
        rows.push(row(input, strategy, profile, outcome, bestOutput, referenceOutput));
      }
    }
    rows.push(row(
      input,
      'numerical-reference',
      'reference',
      reference,
      bestOutput,
      referenceOutput,
    ));
  }
  return Object.freeze(rows);
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor((sorted.length - 1) / 2)] ?? null;
}

function workTotal(rowValue: QualityRow): number {
  return Object.values(rowValue.work).reduce((sum, value) => sum + value, 0);
}

export function aggregateQuality(rows: readonly QualityRow[]): readonly QualityAggregate[] {
  const keys = [...new Set(rows.map(({ strategy, profile }) => `${strategy}\0${profile}`))];
  return Object.freeze(keys.map((key) => {
    const [strategy, profile] = key.split('\0') as [BenchmarkStrategy, BenchmarkProfile];
    const selected = rows.filter((value) => value.strategy === strategy && value.profile === profile);
    const regret = selected.flatMap((value) => value.regretBps === null ? [] : [value.regretBps]);
    const authorizationRejections = selected.reduce(
      (sum, value) => sum + value.authorizationRejections,
      0,
    );
    const quoteCount = selected.filter(({ outcome }) => outcome === 'quote').length;
    return Object.freeze({
      strategy,
      profile,
      quoteCount,
      noRouteCount: selected.filter(({ outcome }) => outcome === 'no-route').length,
      medianRegretBps: median(regret),
      worstRegretBps: regret.length === 0 ? null : Math.max(...regret),
      splitImprovementCount: selected.filter((value) =>
        value.routeCount > 1 &&
        value.improvementOverBestSingle !== null &&
        BigInt(value.improvementOverBestSingle) > 0n
      ).length,
      authorizationRejections,
      authorizationRejectionRate: quoteCount === 0 ? 0 : authorizationRejections / quoteCount,
      totalWork: selected.reduce((sum, value) => sum + workTotal(value), 0),
    });
  }));
}

export function compareNumerical(rows: readonly QualityRow[]): readonly NumericalComparison[] {
  return Object.freeze(PUBLIC_EFFORTS.map((profile) => {
    let beatsGreedy = 0;
    let tiesGreedy = 0;
    let losesGreedy = 0;
    for (const numerical of rows.filter((value) =>
      value.strategy === 'numerical-split' && value.profile === profile && value.amountOut !== null
    )) {
      const greedy = rows.find((value) =>
        value.caseId === numerical.caseId &&
        value.strategy === 'greedy-split' &&
        value.profile === profile
      );
      if (greedy?.amountOut === null || greedy === undefined) continue;
      const comparison = BigInt(numerical.amountOut as string) - BigInt(greedy.amountOut);
      if (comparison > 0n) beatsGreedy += 1;
      else if (comparison < 0n) losesGreedy += 1;
      else tiesGreedy += 1;
    }
    return Object.freeze({ profile, beatsGreedy, tiesGreedy, losesGreedy });
  }));
}
