import { readFile } from 'node:fs/promises';

import {
  formatQuote,
  prepareSnapshot,
  quote,
  serializeQuote,
  type QuoteEffort,
  type QuoteStrategy,
} from '../src/index.ts';

const USAGE = `Usage: pnpm quote -- --snapshot <path> --asset-in <id> --asset-out <id> --amount-in <decimal> [options]

Options:
  --strategy <best-single|greedy-split|numerical-split>  Default: greedy-split
  --effort <fast|balanced|thorough>                     Default: balanced
  --deadline-ms <integer>                              Relative compute deadline
  --json                                               Emit one JSON object
  --help                                               Show this help`;

interface Arguments {
  snapshot: string;
  assetIn: string;
  assetOut: string;
  amountIn: bigint;
  strategy: QuoteStrategy;
  effort: QuoteEffort;
  deadlineMs: number | undefined;
  json: boolean;
}

function parseArguments(values: readonly string[]): Arguments | 'help' {
  if (values.length === 1 && values[0] === '--help') return 'help';
  const fields = new Map<string, string>();
  let json = false;
  for (let index = 0; index < values.length; index += 1) {
    const flag = values[index];
    if (flag === '--json') {
      json = true;
      continue;
    }
    if (!['--snapshot', '--asset-in', '--asset-out', '--amount-in', '--strategy', '--effort', '--deadline-ms'].includes(flag ?? '')) {
      throw new Error(`Unknown argument: ${flag ?? ''}`);
    }
    const value = values[index + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`Missing value for ${flag}.`);
    if (fields.has(flag!)) throw new Error(`Duplicate argument: ${flag}.`);
    fields.set(flag!, value);
    index += 1;
  }
  const snapshot = fields.get('--snapshot');
  const assetIn = fields.get('--asset-in');
  const assetOut = fields.get('--asset-out');
  const amount = fields.get('--amount-in');
  if (snapshot === undefined || assetIn === undefined || assetOut === undefined || amount === undefined) {
    throw new Error('snapshot, asset-in, asset-out, and amount-in are required.');
  }
  if (!/^(?:0|[1-9][0-9]*)$/u.test(amount)) {
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
  const deadline = fields.get('--deadline-ms');
  if (deadline !== undefined && !/^(?:0|[1-9][0-9]*)$/u.test(deadline)) {
    throw new Error('deadline-ms must be a nonnegative integer.');
  }
  return {
    snapshot,
    assetIn,
    assetOut,
    amountIn: BigInt(amount),
    strategy: strategy as QuoteStrategy,
    effort: effort as QuoteEffort,
    deadlineMs: deadline === undefined ? undefined : Number(deadline),
    json,
  };
}

function fail(message: string): never {
  process.stderr.write(`RouteLab quote error: ${message}\n${USAGE}\n`);
  process.exit(1);
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
try {
  rawSnapshot = JSON.parse(await readFile(input.snapshot, 'utf8')) as unknown;
} catch {
  fail(`Could not read valid JSON from ${input.snapshot}.`);
}
const prepared = prepareSnapshot(rawSnapshot);
if (!prepared.ok) fail(`Snapshot preparation failed: ${prepared.error.code}.`);
const request = {
  snapshotId: prepared.value.snapshotId,
  assetIn: input.assetIn,
  assetOut: input.assetOut,
  amountIn: input.amountIn,
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
    formatQuote(result.value),
    `best single: ${bestSingle?.toString(10) ?? 'unavailable'}`,
    `improvement over best single: ${improvement?.toString(10) ?? 'unavailable'}`,
    `fallback used: ${result.value.fallbackUsed ? 'yes' : 'no'}`,
    `elapsed: ${result.value.timing.elapsedMicros} microseconds`,
    'exact validation: passed by fresh exact replay',
    `semantic fingerprint: ${result.value.semanticFingerprint}`,
  ].join('\n')}\n`);
}
