import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import {
  formatQuote,
  prepareSnapshot,
  quote,
  serializeQuote,
  type AssetDisplayMetadata,
  type QuoteEffort,
  type QuoteStrategy,
} from '../src/index.ts';

const USAGE = `Usage:
  pnpm quote -- --snapshot <path> --asset-in <id|symbol> --asset-out <id|symbol> --amount-in <base-unit-decimal> [options]
  pnpm quote -- --snapshot <path> --list-assets [--json]

Options:
  --strategy <best-single|greedy-split|numerical-split>  Default: greedy-split
  --effort <fast|balanced|thorough>                     Default: balanced
  --max-hops <1..8>                                    Default: 3
  --max-routes <1..4>                                  Default: 3
  --deadline-ms <0..60000>                             Relative monotonic wall-clock stop budget
  --metadata <path>                                    Dataset manifest; defaults beside snapshot
  --list-assets                                        List manifest asset symbols and exact IDs
  --raw                                                Show full IDs and base-unit integers
  --json                                               Emit one JSON object
  --help                                               Show this help`;

interface Arguments {
  snapshot: string;
  assetIn: string | undefined;
  assetOut: string | undefined;
  amountIn: bigint | undefined;
  strategy: QuoteStrategy;
  effort: QuoteEffort;
  maxHops: number | undefined;
  maxRoutes: number | undefined;
  deadlineMs: number | undefined;
  metadataPath: string | undefined;
  listAssets: boolean;
  raw: boolean;
  json: boolean;
}

interface AssetCatalog {
  readonly metadata: Readonly<Record<string, AssetDisplayMetadata>>;
  readonly aliases: ReadonlyMap<string, string>;
  readonly entries: readonly {
    readonly assetId: string;
    readonly symbol: string;
    readonly decimals: number;
  }[];
}

function integerArgument(
  fields: ReadonlyMap<string, string>,
  flag: string,
  minimum: number,
  maximum: number,
): number | undefined {
  const source = fields.get(flag);
  if (source === undefined) return undefined;
  if (!/^(?:0|[1-9][0-9]*)$/u.test(source)) {
    throw new Error(`${flag.slice(2)} must be a canonical nonnegative integer.`);
  }
  const value = Number(source);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${flag.slice(2)} must be an integer from ${minimum} through ${maximum}.`);
  }
  return value;
}

function parseArguments(values: readonly string[]): Arguments | 'help' {
  if (values.length === 1 && values[0] === '--help') return 'help';
  const fields = new Map<string, string>();
  let json = false;
  let raw = false;
  let listAssets = false;
  for (let index = 0; index < values.length; index += 1) {
    const flag = values[index];
    if (flag === '--json' || flag === '--raw' || flag === '--list-assets') {
      if (flag === '--json') json = true;
      if (flag === '--raw') raw = true;
      if (flag === '--list-assets') listAssets = true;
      continue;
    }
    if (![
      '--snapshot',
      '--asset-in',
      '--asset-out',
      '--amount-in',
      '--strategy',
      '--effort',
      '--deadline-ms',
      '--max-hops',
      '--max-routes',
      '--metadata',
    ].includes(flag ?? '')) {
      throw new Error(`Unknown argument: ${flag ?? ''}`);
    }
    const value = values[index + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`Missing value for ${flag}.`);
    if (fields.has(flag!)) throw new Error(`Duplicate argument: ${flag}.`);
    fields.set(flag!, value);
    index += 1;
  }
  const snapshot = fields.get('--snapshot');
  if (snapshot === undefined) throw new Error('snapshot is required.');
  const assetIn = fields.get('--asset-in');
  const assetOut = fields.get('--asset-out');
  const amount = fields.get('--amount-in');
  if (!listAssets && (assetIn === undefined || assetOut === undefined || amount === undefined)) {
    throw new Error('asset-in, asset-out, and amount-in are required unless --list-assets is used.');
  }
  if (amount !== undefined && !/^(?:0|[1-9][0-9]*)$/u.test(amount)) {
    throw new Error('amount-in must be a canonical unsigned decimal string.');
  }
  const strategy = fields.get('--strategy') ?? 'greedy-split';
  if (!['best-single', 'greedy-split', 'numerical-split'].includes(strategy)) {
    throw new Error('strategy must be best-single, greedy-split, or numerical-split.');
  }
  const effort = fields.get('--effort') ?? 'balanced';
  if (!['fast', 'balanced', 'thorough'].includes(effort)) {
    throw new Error('effort must be fast, balanced, or thorough.');
  }
  return {
    snapshot,
    assetIn,
    assetOut,
    amountIn: amount === undefined ? undefined : BigInt(amount),
    strategy: strategy as QuoteStrategy,
    effort: effort as QuoteEffort,
    maxHops: integerArgument(fields, '--max-hops', 1, 8),
    maxRoutes: integerArgument(fields, '--max-routes', 1, 4),
    deadlineMs: integerArgument(fields, '--deadline-ms', 0, 60_000),
    metadataPath: fields.get('--metadata'),
    listAssets,
    raw,
    json,
  };
}

function fail(message: string): never {
  process.stderr.write(`RouteLab quote error: ${message}\n${USAGE}\n`);
  process.exit(1);
}

function record(input: unknown): Record<string, unknown> | undefined {
  return typeof input === 'object' && input !== null && !Array.isArray(input)
    ? input as Record<string, unknown>
    : undefined;
}

async function assetCatalog(snapshotPath: string, explicitPath: string | undefined): Promise<AssetCatalog> {
  const path = explicitPath ?? join(dirname(snapshotPath), 'manifest.json');
  let manifest: unknown;
  try {
    manifest = JSON.parse(await readFile(path, 'utf8')) as unknown;
  } catch (error) {
    const code = record(error)?.['code'];
    if (explicitPath === undefined && code === 'ENOENT') {
      return Object.freeze({
        metadata: Object.freeze({}),
        aliases: Object.freeze(new Map()),
        entries: Object.freeze([]),
      });
    }
    throw new Error(`Could not read valid asset metadata from ${path}.`, { cause: error });
  }
  const selectedTokens = record(manifest)?.['selectedTokens'];
  if (!Array.isArray(selectedTokens)) throw new Error(`Asset metadata in ${path} has no selectedTokens array.`);
  const metadata: Record<string, AssetDisplayMetadata> = Object.create(null) as Record<string, AssetDisplayMetadata>;
  const aliases = new Map<string, string>();
  const entries: Array<{ readonly assetId: string; readonly symbol: string; readonly decimals: number }> = [];
  for (const source of selectedTokens) {
    const token = record(source);
    const assetId = token?.['address'];
    const symbol = token?.['symbol'];
    const decimals = token?.['decimals'];
    if (
      typeof assetId !== 'string' || assetId.length === 0 ||
      typeof symbol !== 'string' || symbol.length === 0 ||
      !Number.isSafeInteger(decimals) || (decimals as number) < 0 || (decimals as number) > 255 ||
      metadata[assetId] !== undefined || aliases.has(symbol.toLowerCase())
    ) {
      throw new Error(`Asset metadata in ${path} contains an invalid or duplicate token.`);
    }
    const display = Object.freeze({ symbol, decimals: decimals as number });
    metadata[assetId] = display;
    aliases.set(symbol.toLowerCase(), assetId);
    entries.push(Object.freeze({ assetId, symbol, decimals: decimals as number }));
  }
  return Object.freeze({
    metadata: Object.freeze(metadata),
    aliases: Object.freeze(aliases),
    entries: Object.freeze(entries),
  });
}

function resolvedAsset(value: string, catalog: AssetCatalog): string {
  return catalog.metadata[value] === undefined
    ? catalog.aliases.get(value.toLowerCase()) ?? value
    : value;
}

let input: Arguments | 'help';
try {
  const values = process.argv.slice(2);
  input = parseArguments(values[0] === '--' ? values.slice(1) : values);
} catch (error) {
  fail(error instanceof Error ? error.message : 'Invalid arguments.');
}
if (input === 'help') {
  process.stdout.write(`${USAGE}\n`);
  process.exit(0);
}

let rawSnapshot: unknown;
let catalog: AssetCatalog;
try {
  rawSnapshot = JSON.parse(await readFile(input.snapshot, 'utf8')) as unknown;
  catalog = await assetCatalog(input.snapshot, input.metadataPath);
} catch (error) {
  fail(error instanceof Error ? error.message : `Could not read valid JSON from ${input.snapshot}.`);
}
const prepared = prepareSnapshot(rawSnapshot);
if (!prepared.ok) fail(`Snapshot preparation failed: ${prepared.error.code}.`);

if (input.listAssets) {
  if (input.json) {
    process.stdout.write(`${JSON.stringify({ snapshotId: prepared.value.snapshotId, assets: catalog.entries })}\n`);
  } else if (catalog.entries.length === 0) {
    process.stdout.write('No adjacent asset metadata was found. Use exact snapshot asset IDs.\n');
  } else {
    process.stdout.write(`${catalog.entries
      .map(({ symbol, decimals, assetId }) => `${symbol.padEnd(6)} decimals=${decimals.toString().padEnd(2)} ${assetId}`)
      .join('\n')}\n`);
  }
  process.exit(0);
}

if (input.assetIn === undefined || input.assetOut === undefined || input.amountIn === undefined) {
  fail('asset-in, asset-out, and amount-in are required.');
}
const request = {
  snapshotId: prepared.value.snapshotId,
  assetIn: resolvedAsset(input.assetIn, catalog),
  assetOut: resolvedAsset(input.assetOut, catalog),
  amountIn: input.amountIn,
  ...(input.maxHops === undefined ? {} : { maxHops: input.maxHops }),
  ...(input.maxRoutes === undefined ? {} : { maxRoutes: input.maxRoutes }),
};
const options = {
  strategy: input.strategy,
  effort: input.effort,
  ...(input.deadlineMs === undefined ? {} : { deadlineMs: input.deadlineMs }),
};
const result = quote(prepared.value, request, options);
if (!result.ok) fail(`${result.error.code}: ${result.error.message}`);
const bestSingleResult = input.strategy === 'best-single'
  ? result
  : quote(prepared.value, request, { strategy: 'best-single', effort: input.effort });
const bestSingle = bestSingleResult.ok ? bestSingleResult.value.amountOut : undefined;
const improvement = bestSingle === undefined ? undefined : result.value.amountOut - bestSingle;

if (input.json) {
  process.stdout.write(`${JSON.stringify({
    ...serializeQuote(result.value),
    bestSingleAmountOut: bestSingle?.toString(10) ?? null,
    improvementOverBestSingle: improvement?.toString(10) ?? null,
    exactValidation: 'passed-fresh-exact-replay',
  })}\n`);
} else {
  process.stdout.write(`${[
    'RouteLab exact-input quote',
    formatQuote(result.value, {
      assetMetadata: catalog.metadata,
      ...(bestSingle === undefined ? {} : { bestSingleAmountOut: bestSingle }),
      raw: input.raw,
    }),
    `elapsed: ${result.value.timing.elapsedMicros} microseconds`,
    'exact validation: passed by fresh exact replay',
    `plan fingerprint: ${result.value.planFingerprint}`,
  ].join('\n')}\n`);
}
