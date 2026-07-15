import {
  advancePathShadowPriceProposal,
  finalizePathShadowPriceProposal,
  preparePathShadowPriceProposal,
  type PathShadowPriceIterationState,
  type PathShadowPriceReadyState,
} from '../../allocation/path-shadow-price/index.ts';
import type {
  ExactInputSplitReplayLegRequest,
  ExactInputSplitReplayReceipt,
} from '../../replay/exact-input-split/index.ts';
import {
  createPreparedSimplePathFrontier,
  expandPreparedSimplePathFrontier,
  hasPreparedSimplePathExpansion,
  materializePreparedSimplePaths,
  preparedDirectRoutes,
  replayPreparedExactInputSplit,
  resolvePreparedPathShadowPriceRoutes,
  type PreparedRoutingContext,
} from '../../runtime/prepared-routing-context/index.ts';
import {
  createSharedCandidateSetFrontier,
  expandSharedCandidateSetFrontier,
  hasSharedCandidateSetExpansion,
  materializeSharedCandidateSets,
} from '../../search/shared-route-discovery/index.ts';
import { isStrictlyBetterSplitReceipt } from '../shared/objective.ts';
import {
  boundary,
  captureReplayReceipt,
  compareProposals,
  createDiagnosticState,
  diagnostic,
  finish,
  freshCounters,
  fullReplayRequest,
  operationalResult,
  partialReplayRequest,
  positiveChunks,
  positiveLegs,
  proposalKey,
  receiptSemanticallyEquals,
  type SplitProposal,
} from './support.ts';
import { captureControl, captureRequest } from './validation.ts';
import type {
  NumericalExactInputSplitAuthorizationReplay,
  NumericalExactInputSplitDiagnostic,
  NumericalExactInputSplitProposalDriver,
  NumericalExactInputSplitRuntimeControl,
  NumericalExactInputSplitRuntimeRequest,
  NumericalExactInputSplitRuntimeResult,
} from './types.ts';

const REAL_PROPOSAL_DRIVER: NumericalExactInputSplitProposalDriver = Object.freeze({
  prepare: preparePathShadowPriceProposal,
  advance: advancePathShadowPriceProposal,
  finalize: finalizePathShadowPriceProposal,
});

function runNumericalRuntime(
  context: PreparedRoutingContext,
  sourceRequest: NumericalExactInputSplitRuntimeRequest,
  sourceControl: NumericalExactInputSplitRuntimeControl,
  authorizationReplay: NumericalExactInputSplitAuthorizationReplay,
  proposalDriver: NumericalExactInputSplitProposalDriver,
): NumericalExactInputSplitRuntimeResult {
  const capturedRequest = captureRequest(context, sourceRequest);
  if ('status' in capturedRequest) return capturedRequest;
  const capturedControl = captureControl(sourceControl);
  if ('status' in capturedControl) return capturedControl;

  const counters = freshCounters();
  const diagnostics: NumericalExactInputSplitDiagnostic[] = [];
  let incumbent: ExactInputSplitReplayReceipt | undefined;
  let hadCandidate = false;
  let workLimited = false;
  const priorClock: { value: bigint | undefined } = { value: undefined };
  const proposals = new Map<string, SplitProposal>();

  const directRoutes = preparedDirectRoutes(
    context,
    capturedRequest.assetIn,
    capturedRequest.assetOut,
  );
  for (const route of directRoutes) {
    hadCandidate = true;
    counters.directCandidates += 1;
    counters.directCandidateReplays += 1;
    const replay = replayPreparedExactInputSplit(
      context,
      fullReplayRequest(capturedRequest, [
        Object.freeze({ allocation: capturedRequest.amountIn, route }),
      ]),
    );
    if (!replay.ok) counters.directCandidateRejections += 1;
    else if (
      incumbent === undefined ||
      isStrictlyBetterSplitReceipt(replay.value, incumbent)
    ) {
      incumbent = replay.value;
    }
  }

  const collectProposal = (
    receipt: ExactInputSplitReplayReceipt,
    legs: readonly ExactInputSplitReplayLegRequest[],
  ): void => {
    const key = proposalKey(legs);
    if (!proposals.has(key)) {
      proposals.set(key, Object.freeze({ key, receipt, legs }));
    }
  };

  const pathFrontier = createPreparedSimplePathFrontier(context, capturedRequest);
  while (hasPreparedSimplePathExpansion(pathFrontier)) {
    const stop = boundary(
      'path-expansion',
      capturedControl,
      counters,
      incumbent,
      priorClock,
    );
    if (stop.outcome === 'cap') {
      workLimited = true;
      break;
    }
    if (stop.outcome !== 'execute') {
      return operationalResult(stop, counters, incumbent, hadCandidate, diagnostics);
    }
    expandPreparedSimplePathFrontier(pathFrontier);
    counters.pathExpansions += 1;
  }
  const paths = materializePreparedSimplePaths(pathFrontier);
  hadCandidate ||= paths.length > 0;

  for (const route of paths) {
    const stop = boundary(
      'best-single-candidate-replay',
      capturedControl,
      counters,
      incumbent,
      priorClock,
    );
    if (stop.outcome === 'cap') {
      workLimited = true;
      break;
    }
    if (stop.outcome !== 'execute') {
      return operationalResult(stop, counters, incumbent, hadCandidate, diagnostics);
    }
    counters.bestSingleCandidateReplays += 1;
    const legs = Object.freeze([
      Object.freeze({ allocation: capturedRequest.amountIn, route }),
    ]);
    const replay = replayPreparedExactInputSplit(
      context,
      fullReplayRequest(capturedRequest, legs),
    );
    if (!replay.ok) counters.bestSingleCandidateRejections += 1;
    else if (
      incumbent === undefined ||
      isStrictlyBetterSplitReceipt(replay.value, incumbent)
    ) {
      incumbent = replay.value;
    }
  }

  const setFrontier = createSharedCandidateSetFrontier(paths, capturedRequest.maxRoutes);
  while (hasSharedCandidateSetExpansion(setFrontier)) {
    const stop = boundary(
      'candidate-set-expansion',
      capturedControl,
      counters,
      incumbent,
      priorClock,
    );
    if (stop.outcome === 'cap') {
      workLimited = true;
      break;
    }
    if (stop.outcome !== 'execute') {
      return operationalResult(stop, counters, incumbent, hadCandidate, diagnostics);
    }
    expandSharedCandidateSetFrontier(setFrontier);
    counters.candidateSetExpansions += 1;
  }
  const candidateSets = materializeSharedCandidateSets(setFrontier);

  for (const { routes } of candidateSets) {
    const cardinality = BigInt(routes.length);
    const base = capturedRequest.amountIn / cardinality;
    if (base === 0n) continue;
    const remainder = capturedRequest.amountIn % cardinality;
    const legs = Object.freeze(
      routes.map((route, index) =>
        Object.freeze({
          allocation: base + (BigInt(index) < remainder ? 1n : 0n),
          route,
        }),
      ),
    );
    const stop = boundary(
      'equal-proposal-replay',
      capturedControl,
      counters,
      incumbent,
      priorClock,
    );
    if (stop.outcome === 'cap') {
      workLimited = true;
      break;
    }
    if (stop.outcome !== 'execute') {
      return operationalResult(stop, counters, incumbent, hadCandidate, diagnostics);
    }
    counters.equalProposalReplays += 1;
    const replay = replayPreparedExactInputSplit(
      context,
      fullReplayRequest(capturedRequest, legs),
    );
    if (!replay.ok) counters.equalProposalRejections += 1;
    else collectProposal(replay.value, legs);
  }

  candidateSets: for (const { routes } of candidateSets) {
    const allocations = routes.map(() => 0n);
    let allocated = 0n;
    let finalProposal: ExactInputSplitReplayReceipt | undefined;
    for (const chunk of positiveChunks(
      capturedRequest.amountIn,
      capturedRequest.greedyParts,
    )) {
      let winningIndex: number | undefined;
      let winningOutput: bigint | undefined;
      let winningReceipt: ExactInputSplitReplayReceipt | undefined;
      for (let routeIndex = 0; routeIndex < routes.length; routeIndex += 1) {
        const stop = boundary(
          'greedy-option-replay',
          capturedControl,
          counters,
          incumbent,
          priorClock,
        );
        if (stop.outcome === 'cap') {
          workLimited = true;
          break candidateSets;
        }
        if (stop.outcome !== 'execute') {
          return operationalResult(stop, counters, incumbent, hadCandidate, diagnostics);
        }
        const optionAllocations = [...allocations];
        optionAllocations[routeIndex] = optionAllocations[routeIndex]! + chunk;
        counters.greedyOptionReplays += 1;
        const replay = replayPreparedExactInputSplit(
          context,
          partialReplayRequest(
            capturedRequest,
            positiveLegs(routes, optionAllocations),
          ),
        );
        if (!replay.ok) {
          counters.greedyOptionRejections += 1;
          continue;
        }
        if (winningOutput === undefined || replay.value.amountOut > winningOutput) {
          winningIndex = routeIndex;
          winningOutput = replay.value.amountOut;
          winningReceipt = replay.value;
        }
      }
      if (winningIndex === undefined) continue candidateSets;
      allocations[winningIndex] = allocations[winningIndex]! + chunk;
      allocated += chunk;
      finalProposal = winningReceipt;
    }
    if (allocated !== capturedRequest.amountIn || finalProposal === undefined) continue;
    const legs = positiveLegs(routes, allocations);
    collectProposal(finalProposal, legs);
  }

  const orderedProposals = [...proposals.values()].sort(compareProposals);
  for (const proposal of orderedProposals) {
    if (
      incumbent !== undefined &&
      !isStrictlyBetterSplitReceipt(proposal.receipt, incumbent)
    ) {
      continue;
    }
    const stop = boundary(
      'final-authorization-replay',
      capturedControl,
      counters,
      incumbent,
      priorClock,
    );
    if (stop.outcome === 'cap') {
      workLimited = true;
      break;
    }
    if (stop.outcome !== 'execute') {
      return operationalResult(stop, counters, incumbent, hadCandidate, diagnostics);
    }
    counters.finalAuthorizationReplays += 1;
    const replay = replayPreparedExactInputSplit(
      context,
      fullReplayRequest(capturedRequest, proposal.legs),
    );
    if (!replay.ok) counters.finalAuthorizationRejections += 1;
    else if (
      incumbent === undefined ||
      isStrictlyBetterSplitReceipt(replay.value, incumbent)
    ) {
      incumbent = replay.value;
    }
  }

  if (incumbent === undefined) {
    return finish(
      counters,
      workLimited ? 'work-limit' : 'complete',
      incumbent,
      hadCandidate,
      diagnostics,
    );
  }

  for (const { routes } of candidateSets) {
    const candidate = createDiagnosticState(routes);
    const proposalStop = boundary(
      'numerical-proposal',
      capturedControl,
      counters,
      incumbent,
      priorClock,
    );
    if (proposalStop.outcome === 'cap') {
      diagnostics.push(
        diagnostic(
          candidate,
          capturedRequest.numerical.innerIterations,
          'stopped',
          null,
        ),
      );
      return finish(counters, 'work-limit', incumbent, hadCandidate, diagnostics);
    }
    if (proposalStop.outcome !== 'execute') {
      diagnostics.push(
        diagnostic(
          candidate,
          capturedRequest.numerical.innerIterations,
          'stopped',
          null,
        ),
      );
      return operationalResult(
        proposalStop,
        counters,
        incumbent,
        hadCandidate,
        diagnostics,
      );
    }
    counters.numericalProposals += 1;
    candidate.counters.numericalProposals += 1;

    const resolution = resolvePreparedPathShadowPriceRoutes(context, routes);
    if (!resolution.ok) {
      counters.numericalProposalFailures += 1;
      candidate.counters.numericalProposalFailures += 1;
      diagnostics.push(
        diagnostic(
          candidate,
          capturedRequest.numerical.innerIterations,
          'failed',
          'invalid-route-model',
        ),
      );
      continue;
    }

    const prepared = proposalDriver.prepare(
      Object.freeze({
        amountIn: capturedRequest.amountIn,
        routes: resolution.value,
        configuration: capturedRequest.numerical,
      }),
    );
    if (!prepared.ok) {
      counters.numericalProposalFailures += 1;
      candidate.counters.numericalProposalFailures += 1;
      candidate.converged = prepared.error.converged;
      candidate.completedOuterIterations = prepared.error.completedOuterIterations;
      diagnostics.push(
        diagnostic(
          candidate,
          capturedRequest.numerical.innerIterations,
          'failed',
          prepared.error.code,
        ),
      );
      continue;
    }

    let iterationState: PathShadowPriceIterationState = prepared.value.state;
    let readyState: PathShadowPriceReadyState | undefined;
    let coreFailed = false;
    while (readyState === undefined) {
      const iterationStop = boundary(
        'numerical-iteration',
        capturedControl,
        counters,
        incumbent,
        priorClock,
      );
      if (iterationStop.outcome === 'cap') {
        diagnostics.push(
          diagnostic(
            candidate,
            capturedRequest.numerical.innerIterations,
            'stopped',
            null,
          ),
        );
        return finish(counters, 'work-limit', incumbent, hadCandidate, diagnostics);
      }
      if (iterationStop.outcome !== 'execute') {
        diagnostics.push(
          diagnostic(
            candidate,
            capturedRequest.numerical.innerIterations,
            'stopped',
            null,
          ),
        );
        return operationalResult(
          iterationStop,
          counters,
          incumbent,
          hadCandidate,
          diagnostics,
        );
      }
      counters.numericalIterations += 1;
      candidate.counters.numericalIterations += 1;
      const advanced = proposalDriver.advance(iterationState);
      if (!advanced.ok) {
        counters.numericalProposalFailures += 1;
        candidate.counters.numericalProposalFailures += 1;
        candidate.converged = advanced.error.converged;
        candidate.completedOuterIterations = advanced.error.completedOuterIterations;
        diagnostics.push(
          diagnostic(
            candidate,
            capturedRequest.numerical.innerIterations,
            'failed',
            advanced.error.code,
          ),
        );
        coreFailed = true;
        break;
      }
      candidate.completedOuterIterations = advanced.value.state.completedOuterIterations;
      if (advanced.value.status === 'ready') readyState = advanced.value.state;
      else iterationState = advanced.value.state;
    }
    if (coreFailed || readyState === undefined) continue;

    const finalized = proposalDriver.finalize(readyState);
    if (!finalized.ok) {
      counters.numericalProposalFailures += 1;
      candidate.counters.numericalProposalFailures += 1;
      candidate.converged = finalized.error.converged;
      candidate.completedOuterIterations = finalized.error.completedOuterIterations;
      diagnostics.push(
        diagnostic(
          candidate,
          capturedRequest.numerical.innerIterations,
          'failed',
          finalized.error.code,
        ),
      );
      continue;
    }
    candidate.converged = true;
    candidate.completedOuterIterations = finalized.value.completedOuterIterations;
    candidate.residualUnits = finalized.value.reconstruction.residualUnits;

    const allocations = [...finalized.value.reconstruction.baseAllocations];
    const residualUnits = finalized.value.reconstruction.residualUnits;
    let score: ExactInputSplitReplayReceipt | undefined;
    let residualFailed = false;

    if (residualUnits === 0n) {
      const residualStop = boundary(
        'numerical-residual-replay',
        capturedControl,
        counters,
        incumbent,
        priorClock,
      );
      if (residualStop.outcome === 'cap') {
        diagnostics.push(
          diagnostic(
            candidate,
            capturedRequest.numerical.innerIterations,
            'stopped',
            null,
          ),
        );
        return finish(counters, 'work-limit', incumbent, hadCandidate, diagnostics);
      }
      if (residualStop.outcome !== 'execute') {
        diagnostics.push(
          diagnostic(
            candidate,
            capturedRequest.numerical.innerIterations,
            'stopped',
            null,
          ),
        );
        return operationalResult(
          residualStop,
          counters,
          incumbent,
          hadCandidate,
          diagnostics,
        );
      }
      counters.numericalResidualReplays += 1;
      candidate.counters.numericalResidualReplays += 1;
      const replay = replayPreparedExactInputSplit(
        context,
        fullReplayRequest(capturedRequest, positiveLegs(routes, allocations)),
      );
      if (!replay.ok) {
        counters.numericalResidualReplayRejections += 1;
        candidate.counters.numericalResidualReplayRejections += 1;
        residualFailed = true;
      } else {
        score = replay.value;
      }
    } else {
      for (let unit = 0n; unit < residualUnits; unit += 1n) {
        let winningIndex: number | undefined;
        let winningReceipt: ExactInputSplitReplayReceipt | undefined;
        for (let routeIndex = 0; routeIndex < routes.length; routeIndex += 1) {
          const residualStop = boundary(
            'numerical-residual-replay',
            capturedControl,
            counters,
            incumbent,
            priorClock,
          );
          if (residualStop.outcome === 'cap') {
            diagnostics.push(
              diagnostic(
                candidate,
                capturedRequest.numerical.innerIterations,
                'stopped',
                null,
              ),
            );
            return finish(counters, 'work-limit', incumbent, hadCandidate, diagnostics);
          }
          if (residualStop.outcome !== 'execute') {
            diagnostics.push(
              diagnostic(
                candidate,
                capturedRequest.numerical.innerIterations,
                'stopped',
                null,
              ),
            );
            return operationalResult(
              residualStop,
              counters,
              incumbent,
              hadCandidate,
              diagnostics,
            );
          }
          const optionAllocations = [...allocations];
          optionAllocations[routeIndex] = optionAllocations[routeIndex]! + 1n;
          counters.numericalResidualReplays += 1;
          candidate.counters.numericalResidualReplays += 1;
          const replay = replayPreparedExactInputSplit(
            context,
            partialReplayRequest(
              capturedRequest,
              positiveLegs(routes, optionAllocations),
            ),
          );
          if (!replay.ok) {
            counters.numericalResidualReplayRejections += 1;
            candidate.counters.numericalResidualReplayRejections += 1;
            continue;
          }
          if (
            winningReceipt === undefined ||
            isStrictlyBetterSplitReceipt(replay.value, winningReceipt)
          ) {
            winningIndex = routeIndex;
            winningReceipt = replay.value;
          }
        }
        if (winningIndex === undefined || winningReceipt === undefined) {
          residualFailed = true;
          break;
        }
        allocations[winningIndex] = allocations[winningIndex]! + 1n;
        score = winningReceipt;
      }
    }

    if (residualFailed || score === undefined) {
      diagnostics.push(
        diagnostic(
          candidate,
          capturedRequest.numerical.innerIterations,
          'failed',
          'residual-options-exhausted',
        ),
      );
      continue;
    }

    if (!isStrictlyBetterSplitReceipt(score, incumbent)) {
      diagnostics.push(
        diagnostic(
          candidate,
          capturedRequest.numerical.innerIterations,
          'not-better',
          null,
        ),
      );
      continue;
    }

    const authorizationStop = boundary(
      'numerical-authorization-replay',
      capturedControl,
      counters,
      incumbent,
      priorClock,
    );
    if (authorizationStop.outcome === 'cap') {
      diagnostics.push(
        diagnostic(
          candidate,
          capturedRequest.numerical.innerIterations,
          'stopped',
          null,
        ),
      );
      return finish(counters, 'work-limit', incumbent, hadCandidate, diagnostics);
    }
    if (authorizationStop.outcome !== 'execute') {
      diagnostics.push(
        diagnostic(
          candidate,
          capturedRequest.numerical.innerIterations,
          'stopped',
          null,
        ),
      );
      return operationalResult(
        authorizationStop,
        counters,
        incumbent,
        hadCandidate,
        diagnostics,
      );
    }
    counters.numericalAuthorizationReplays += 1;
    candidate.counters.numericalAuthorizationReplays += 1;
    const authorization = authorizationReplay(
      context,
      fullReplayRequest(capturedRequest, positiveLegs(routes, allocations)),
    );
    if (!authorization.ok) {
      counters.numericalAuthorizationReplayRejections += 1;
      candidate.counters.numericalAuthorizationReplayRejections += 1;
      diagnostics.push(
        diagnostic(
          candidate,
          capturedRequest.numerical.innerIterations,
          'failed',
          'authorization-replay-rejected',
        ),
      );
      continue;
    }
    const capturedAuthorization = captureReplayReceipt(authorization.value);
    if (
      capturedAuthorization === undefined ||
      !receiptSemanticallyEquals(capturedAuthorization, score) ||
      !isStrictlyBetterSplitReceipt(capturedAuthorization, incumbent)
    ) {
      counters.numericalAuthorizationReplayRejections += 1;
      candidate.counters.numericalAuthorizationReplayRejections += 1;
      diagnostics.push(
        diagnostic(
          candidate,
          capturedRequest.numerical.innerIterations,
          'failed',
          'authorization-result-mismatch',
        ),
      );
      continue;
    }
    incumbent = capturedAuthorization;
    diagnostics.push(
      diagnostic(
        candidate,
        capturedRequest.numerical.innerIterations,
        'improved',
        null,
      ),
    );
  }

  return finish(
    counters,
    workLimited ? 'work-limit' : 'complete',
    incumbent,
    hadCandidate,
    diagnostics,
  );
}

export function routeExactInputSplitNumericalAnytime(
  context: PreparedRoutingContext,
  request: NumericalExactInputSplitRuntimeRequest,
  control: NumericalExactInputSplitRuntimeControl,
): NumericalExactInputSplitRuntimeResult {
  return runNumericalRuntime(
    context,
    request,
    control,
    replayPreparedExactInputSplit,
    REAL_PROPOSAL_DRIVER,
  );
}

/** @internal */
export function routeExactInputSplitNumericalAnytimeWithAuthorizationReplay(
  context: PreparedRoutingContext,
  request: NumericalExactInputSplitRuntimeRequest,
  control: NumericalExactInputSplitRuntimeControl,
  authorizationReplay: NumericalExactInputSplitAuthorizationReplay,
): NumericalExactInputSplitRuntimeResult {
  return runNumericalRuntime(
    context,
    request,
    control,
    authorizationReplay,
    REAL_PROPOSAL_DRIVER,
  );
}

/** @internal */
export function routeExactInputSplitNumericalAnytimeWithProposalDriver(
  context: PreparedRoutingContext,
  request: NumericalExactInputSplitRuntimeRequest,
  control: NumericalExactInputSplitRuntimeControl,
  proposalDriver: NumericalExactInputSplitProposalDriver,
): NumericalExactInputSplitRuntimeResult {
  return runNumericalRuntime(
    context,
    request,
    control,
    replayPreparedExactInputSplit,
    proposalDriver,
  );
}
