import { readFile } from 'node:fs/promises';

import {
  createAnytimeSinglePathMeasurementReport,
  parseAnytimeSinglePathMeasurementInput,
} from '../src/benchmark/anytime-single-path/index.ts';

const DEFAULT_INPUT = 'fixtures/m4/anytime-single-path-input.v1.json';
const DEFAULT_WARMUP_COUNT = 10;
const DEFAULT_SAMPLE_COUNT = 30;
const USAGE =
  'Usage: pnpm measure:anytime [--input <file>] [--warmups <count>] [--samples <count>]';

interface Arguments {
  readonly input: string;
  readonly warmupCount: number;
  readonly sampleCount: number;
}

function parseCount(value: string | undefined, allowZero: boolean): number | undefined {
  if (value === undefined || !/^(?:0|[1-9][0-9]*)$/u.test(value)) return undefined;
  const count = Number(value);
  if (!Number.isSafeInteger(count) || count < (allowZero ? 0 : 1)) return undefined;
  return count;
}

function parseArguments(values: readonly string[]): Arguments | 'help' | undefined {
  if (values.length === 1 && values[0] === '--help') return 'help';
  let input = DEFAULT_INPUT;
  let warmupCount = DEFAULT_WARMUP_COUNT;
  let sampleCount = DEFAULT_SAMPLE_COUNT;
  const seen = new Set<string>();

  for (let index = 0; index < values.length; index += 2) {
    const flag = values[index];
    const value = values[index + 1];
    if (flag === undefined || value === undefined || seen.has(flag)) return undefined;
    seen.add(flag);
    if (flag === '--input' && value.length > 0 && !value.startsWith('--')) {
      input = value;
      continue;
    }
    if (flag === '--warmups') {
      const parsed = parseCount(value, true);
      if (parsed === undefined) return undefined;
      warmupCount = parsed;
      continue;
    }
    if (flag === '--samples') {
      const parsed = parseCount(value, false);
      if (parsed === undefined) return undefined;
      sampleCount = parsed;
      continue;
    }
    return undefined;
  }
  return Object.freeze({ input, warmupCount, sampleCount });
}

const arguments_ = parseArguments(process.argv.slice(2));
if (arguments_ === 'help') {
  process.stdout.write(`${USAGE}\n`);
} else if (arguments_ === undefined) {
  process.stderr.write(`${USAGE}\n`);
  process.exitCode = 1;
} else {
  let source: string;
  try {
    source = await readFile(arguments_.input, 'utf8');
  } catch {
    process.stderr.write('anytime measurement failed: input-read-failed\n');
    process.exitCode = 1;
    source = '';
  }

  if (source.length > 0) {
    const parsed = parseAnytimeSinglePathMeasurementInput(source);
    if (!parsed.ok) {
      process.stderr.write(`anytime measurement failed: ${parsed.error.code}\n`);
      process.exitCode = 1;
    } else {
      const value = createAnytimeSinglePathMeasurementReport(
        parsed.value,
        {
          warmupCount: arguments_.warmupCount,
          sampleCount: arguments_.sampleCount,
        },
        { nowNanoseconds: () => process.hrtime.bigint() },
        {
          nodeVersion: process.version,
          platform: process.platform,
          arch: process.arch,
        },
      );
      process.stdout.write(`${value.canonicalJson}\n`);
    }
  }
}
