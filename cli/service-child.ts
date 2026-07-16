import { readFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';

import {
  closeQuoteHttpService,
  createQuoteHttpService,
} from '../src/service/index.ts';
import { createWorkerQuoteExecutor } from '../src/service/worker-pool.ts';

interface Command {
  readonly type: 'command';
  readonly id: number;
  readonly command: 'reset-metrics' | 'read-metrics' | 'shutdown';
}

function isCommand(value: unknown): value is Command {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return record['type'] === 'command'
    && Number.isSafeInteger(record['id'])
    && (record['command'] === 'reset-metrics'
      || record['command'] === 'read-metrics'
      || record['command'] === 'shutdown');
}

function send(value: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    if (process.send === undefined) {
      reject(new Error('Service child requires a parent IPC channel.'));
      return;
    }
    process.send(value, (error) => error === null ? resolve() : reject(error));
  });
}

const raw = JSON.parse(await readFile(
  'datasets/ethereum-mainnet/uniswap-v2/block-19000000/core12-v1/snapshot.json',
  'utf8',
)) as unknown;
const args = process.argv.slice(2);
const modeIndex = args.indexOf('--mode');
const mode = modeIndex === -1 ? 'same-thread' : args[modeIndex + 1];
if (mode !== 'same-thread' && mode !== 'worker') {
  throw new Error('Service child mode must be same-thread or worker.');
}
const executor = mode === 'worker' ? await createWorkerQuoteExecutor([raw]) : undefined;
const service = createQuoteHttpService(
  [raw],
  (line) => process.stdout.write(`${line}\n`),
  executor,
);
await new Promise<void>((resolve, reject) => {
  service.server.once('error', reject);
  service.server.listen(0, '127.0.0.1', () => {
    service.server.off('error', reject);
    resolve();
  });
});
const address = service.server.address() as AddressInfo;
await send(Object.freeze({
  type: 'ready',
  port: address.port,
  pid: process.pid,
  snapshotCount: service.snapshots.length,
  mode,
}));

let stopping = false;
const stop = async (): Promise<void> => {
  if (stopping) return;
  stopping = true;
  await closeQuoteHttpService(service);
};

process.on('message', (message: unknown) => {
  if (!isCommand(message)) return;
  void (async () => {
    try {
      if (message.command === 'reset-metrics') {
        service.resetMetrics();
        await send({ type: 'response', id: message.id, ok: true, value: null });
        return;
      }
      if (message.command === 'read-metrics') {
        await send({
          type: 'response',
          id: message.id,
          ok: true,
          value: service.readMetrics(),
        });
        return;
      }
      await stop();
      await send({ type: 'response', id: message.id, ok: true, value: null });
      process.disconnect();
    } catch (error) {
      await send({
        type: 'response',
        id: message.id,
        ok: false,
        error: error instanceof Error ? error.message : 'service-child-failure',
      }).catch(() => undefined);
      process.exitCode = 1;
    }
  })();
});

const signalStop = (): void => {
  void stop().finally(() => {
    if (process.connected) process.disconnect();
  });
};
process.once('SIGINT', signalStop);
process.once('SIGTERM', signalStop);
