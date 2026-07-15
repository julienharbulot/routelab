import type { ValidatedQuote } from './types.ts';

export function formatQuote(value: ValidatedQuote): string {
  const lines = [
    `${value.assetIn} ${value.amountIn.toString(10)} -> ${value.assetOut} ${value.amountOut.toString(10)}`,
    `strategy: ${value.requestedStrategy} / ${value.effort} (${value.planKind}, ${value.termination})`,
  ];
  value.routes.forEach((route, index) => {
    const path = route.hops
      .map((hop, hopIndex) => hopIndex === 0
        ? `${hop.assetIn} -[${hop.poolId}]-> ${hop.assetOut}`
        : `-[${hop.poolId}]-> ${hop.assetOut}`)
      .join(' ');
    lines.push(
      `route ${index + 1}: input ${route.allocation.toString(10)}, output ${route.amountOut.toString(10)}, ${path}`,
    );
  });
  lines.push(`snapshot: ${value.snapshotId} (${value.snapshotChecksum})`);
  return lines.join('\n');
}
