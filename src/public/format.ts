import type {
  AssetDisplayMetadata,
  FormatQuoteOptions,
  ValidatedQuote,
} from './types.ts';

function validMetadata(value: AssetDisplayMetadata | undefined): value is AssetDisplayMetadata {
  return value !== undefined &&
    typeof value.symbol === 'string' &&
    value.symbol.length > 0 &&
    Number.isSafeInteger(value.decimals) &&
    value.decimals >= 0 &&
    value.decimals <= 255;
}

function atomicUnits(value: bigint, decimals: number): string {
  const negative = value < 0n;
  const digits = (negative ? -value : value).toString(10);
  if (decimals === 0) return `${negative ? '-' : ''}${digits}`;
  const padded = digits.padStart(decimals + 1, '0');
  const whole = padded.slice(0, -decimals);
  const fractional = padded.slice(-decimals).replace(/0+$/u, '');
  return `${negative ? '-' : ''}${whole}${fractional.length === 0 ? '' : `.${fractional}`}`;
}

function abbreviate(value: string, raw: boolean): string {
  if (raw || value.length <= 18) return value;
  if (value.startsWith('sha256:')) return `${value.slice(0, 15)}…${value.slice(-6)}`;
  return `${value.slice(0, 8)}…${value.slice(-6)}`;
}

function assetLabel(
  assetId: string,
  metadata: Readonly<Record<string, AssetDisplayMetadata>> | undefined,
  raw: boolean,
): string {
  const display = metadata?.[assetId];
  return !raw && validMetadata(display) ? display.symbol : abbreviate(assetId, raw);
}

function amountLabel(
  value: bigint,
  assetId: string,
  metadata: Readonly<Record<string, AssetDisplayMetadata>> | undefined,
  raw: boolean,
): string {
  const display = metadata?.[assetId];
  const amount = !raw && validMetadata(display)
    ? atomicUnits(value, display.decimals)
    : value.toString(10);
  return `${assetLabel(assetId, metadata, raw)} ${amount}`;
}

function formatBasisPoints(value: bigint): string {
  const negative = value < 0n;
  const magnitude = negative ? -value : value;
  const whole = magnitude / 100n;
  const fraction = (magnitude % 100n).toString(10).padStart(2, '0');
  return `${negative ? '-' : ''}${whole.toString(10)}.${fraction}%`;
}

export function formatQuote(value: ValidatedQuote, options: FormatQuoteOptions = {}): string {
  const raw = options.raw ?? false;
  const metadata = options.assetMetadata;
  const lines = [
    `${amountLabel(value.amountIn, value.assetIn, metadata, raw)} -> ${amountLabel(value.amountOut, value.assetOut, metadata, raw)}`,
    `strategy: ${value.requestedStrategy} / ${value.effort} (${value.planKind}, ${value.termination})`,
  ];
  value.routes.forEach((route, index) => {
    const allocationBps = value.amountIn === 0n
      ? 0n
      : (route.allocation * 10_000n) / value.amountIn;
    const path = route.hops
      .map((hop, hopIndex) => hopIndex === 0
        ? `${assetLabel(hop.assetIn, metadata, raw)} -[${abbreviate(hop.poolId, raw)}]-> ${assetLabel(hop.assetOut, metadata, raw)}`
        : `-[${abbreviate(hop.poolId, raw)}]-> ${assetLabel(hop.assetOut, metadata, raw)}`)
      .join(' ');
    lines.push(
      `route ${index + 1}: input ${amountLabel(route.allocation, value.assetIn, metadata, raw)} (${formatBasisPoints(allocationBps)}), output ${amountLabel(route.amountOut, value.assetOut, metadata, raw)}, ${path}`,
    );
  });
  if (options.bestSingleAmountOut !== undefined) {
    const improvement = value.amountOut - options.bestSingleAmountOut;
    const improvementBps = options.bestSingleAmountOut === 0n
      ? undefined
      : (improvement * 10_000n) / options.bestSingleAmountOut;
    lines.push(`best single: ${amountLabel(options.bestSingleAmountOut, value.assetOut, metadata, raw)}`);
    lines.push(
      `improvement: ${amountLabel(improvement, value.assetOut, metadata, raw)}${improvementBps === undefined ? '' : ` (${formatBasisPoints(improvementBps)})`}`,
    );
  }
  if (value.numericalImprovementSelected !== undefined) {
    lines.push(`numerical improvement selected: ${value.numericalImprovementSelected ? 'yes' : 'no'}`);
  }
  lines.push(
    `snapshot: ${value.snapshotId} (${abbreviate(value.snapshotChecksum, raw)})`,
  );
  return lines.join('\n');
}
