import { readFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';

import {
  closeQuoteHttpService,
  createQuoteHttpService,
} from '../src/service/index.ts';
import { createWorkerQuoteExecutor } from '../src/service/worker-pool.ts';

const args = process.argv.slice(2).filter((value) => value !== '--');
const smoke = args.includes('--smoke');
const modeIndex = args.indexOf('--mode');
const mode = modeIndex === -1 ? 'worker' : args[modeIndex + 1];
if (mode !== 'same-thread' && mode !== 'worker') {
  throw new Error('--mode must be same-thread or worker.');
}
const portIndex = args.indexOf('--port');
const rawPort = portIndex === -1 ? (smoke ? '0' : '8787') : args[portIndex + 1];
if (rawPort === undefined || !/^(?:0|[1-9][0-9]*)$/u.test(rawPort)) {
  throw new Error('--port must be an integer from 0 through 65535.');
}
const port = Number(rawPort);
if (!Number.isSafeInteger(port) || port < 0 || port > 65_535) {
  throw new Error('--port must be an integer from 0 through 65535.');
}

const raw = JSON.parse(await readFile(
  'datasets/ethereum-mainnet/uniswap-v2/block-19000000/core12-v1/snapshot.json',
  'utf8',
)) as unknown;
const logs: string[] = [];
const executor = mode === 'worker' ? await createWorkerQuoteExecutor([raw]) : undefined;
const service = createQuoteHttpService([raw], smoke
  ? (line) => logs.push(line)
  : (line) => process.stdout.write(`${line}\n`), executor);
await new Promise<void>((resolve, reject) => {
  service.server.once('error', reject);
  service.server.listen(port, '127.0.0.1', () => {
    service.server.off('error', reject);
    resolve();
  });
});
const address = service.server.address() as AddressInfo;

if (smoke) {
  const base = `http://127.0.0.1:${address.port}`;
  const health = await fetch(`${base}/health`);
  const snapshots = await fetch(`${base}/v1/snapshots`);
  const quote = await fetch(`${base}/v1/quote`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      snapshotId: service.snapshots[0]?.snapshotId,
      assetIn: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
      assetOut: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
      amountIn: '1000000000000000000',
      strategy: 'best-single',
      effort: 'fast',
      maxHops: 2,
      maxRoutes: 2,
    }),
  });
  await closeQuoteHttpService(service);
  if (!health.ok || !snapshots.ok || !quote.ok || logs.length !== 3) {
    throw new Error('Quote service smoke check failed.');
  }
  process.stdout.write(
    `quote service smoke passed on loopback in ${mode} mode (${logs.length} structured completions)\n`,
  );
} else {
  process.stdout.write(
    `RouteLab quote service listening on http://127.0.0.1:${address.port} in ${mode} mode\n`,
  );
  let stopping = false;
  const stop = (signal: string): void => {
    if (stopping) return;
    stopping = true;
    void closeQuoteHttpService(service).then(() => {
      process.stdout.write(`RouteLab quote service stopped after ${signal}\n`);
    }).catch(() => {
      process.stderr.write('RouteLab quote service shutdown failed\n');
      process.exitCode = 1;
    });
  };
  process.once('SIGINT', () => stop('SIGINT'));
  process.once('SIGTERM', () => stop('SIGTERM'));
}
