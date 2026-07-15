import type {
  SerializedQuote,
  SerializedQuoteRoute,
  ValidatedQuote,
} from './types.ts';

export function serializeQuote(value: ValidatedQuote): SerializedQuote {
  const routes = Object.freeze(value.routes.map((route): SerializedQuoteRoute => Object.freeze({
    allocation: route.allocation.toString(10),
    amountOut: route.amountOut.toString(10),
    hops: Object.freeze(route.hops.map((hop) => Object.freeze({
      poolId: hop.poolId,
      assetIn: hop.assetIn,
      assetOut: hop.assetOut,
      amountIn: hop.amountIn.toString(10),
      amountOut: hop.amountOut.toString(10),
    }))),
  })));
  return Object.freeze({
    schemaVersion: 'routelab.quote.v1',
    snapshotId: value.snapshotId,
    snapshotChecksum: value.snapshotChecksum,
    assetIn: value.assetIn,
    assetOut: value.assetOut,
    amountIn: value.amountIn.toString(10),
    amountOut: value.amountOut.toString(10),
    routes,
    requestedStrategy: value.requestedStrategy,
    effort: value.effort,
    planKind: value.planKind,
    ...(value.numericalImprovementSelected === undefined
      ? {}
      : { numericalImprovementSelected: value.numericalImprovementSelected }),
    termination: value.termination,
    planFingerprint: value.planFingerprint,
    timing: Object.freeze({ ...value.timing }),
    ...(value.diagnostics === undefined
      ? {}
      : {
          diagnostics: Object.freeze({
            ...value.diagnostics,
            work: Object.freeze({ ...value.diagnostics.work }),
          }),
        }),
  });
}
