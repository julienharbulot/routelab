import { fork, type ChildProcess } from 'node:child_process';
import path from 'node:path';

import type { ServiceMetrics } from './types.ts';

interface ReadyMessage {
  readonly type: 'ready';
  readonly port: number;
  readonly pid: number;
  readonly snapshotCount: number;
  readonly mode: ServiceProcessMode;
}

interface ResponseMessage {
  readonly type: 'response';
  readonly id: number;
  readonly ok: boolean;
  readonly value?: unknown;
  readonly error?: string;
}

interface Pending {
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: Error) => void;
}

export interface QuoteServiceProcess {
  readonly endpoint: string;
  readonly pid: number;
  readonly snapshotCount: number;
  readonly mode: ServiceProcessMode;
  readonly logs: readonly string[];
  readonly resetMetrics: () => Promise<void>;
  readonly readMetrics: () => Promise<ServiceMetrics>;
  readonly shutdown: () => Promise<void>;
}

export type ServiceProcessMode = 'same-thread' | 'worker';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function ready(value: unknown): ReadyMessage | undefined {
  if (!isRecord(value)) return undefined;
  if (
    value['type'] !== 'ready'
    || !Number.isSafeInteger(value['port'])
    || !Number.isSafeInteger(value['pid'])
    || !Number.isSafeInteger(value['snapshotCount'])
    || (value['mode'] !== 'same-thread' && value['mode'] !== 'worker')
  ) return undefined;
  return value as unknown as ReadyMessage;
}

function response(value: unknown): ResponseMessage | undefined {
  if (!isRecord(value)) return undefined;
  if (
    value['type'] !== 'response'
    || !Number.isSafeInteger(value['id'])
    || typeof value['ok'] !== 'boolean'
  ) return undefined;
  return value as unknown as ResponseMessage;
}

function splitLines(buffer: string, chunk: Buffer | string, target: string[]): string {
  const combined = buffer + chunk.toString();
  const lines = combined.split('\n');
  const remainder = lines.pop() ?? '';
  target.push(...lines.filter((line) => line.length > 0));
  return remainder;
}

export async function startQuoteServiceProcess(
  root = process.cwd(),
  mode: ServiceProcessMode = 'same-thread',
): Promise<QuoteServiceProcess> {
  const child = fork(path.join(root, 'cli', 'service-child.ts'), ['--mode', mode], {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  const logs: string[] = [];
  let stdoutRemainder = '';
  let stderr = '';
  child.stdout?.on('data', (chunk: Buffer | string) => {
    stdoutRemainder = splitLines(stdoutRemainder, chunk, logs);
  });
  child.stderr?.on('data', (chunk: Buffer | string) => {
    stderr += chunk.toString();
  });
  const pending = new Map<number, Pending>();
  let nextCommand = 0;
  let exited = false;
  child.once('exit', (code, signal) => {
    exited = true;
    const message = `Quote service child exited (${code ?? 'null'}/${signal ?? 'none'}): ${stderr.trim()}`;
    for (const value of pending.values()) value.reject(new Error(message));
    pending.clear();
  });

  const readyMessage = await new Promise<ReadyMessage>((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`Quote service child did not become ready: ${stderr.trim()}`));
    }, 10_000);
    const onMessage = (message: unknown): void => {
      const parsed = ready(message);
      if (parsed === undefined) return;
      clearTimeout(timer);
      child.off('message', onMessage);
      resolve(parsed);
    };
    child.on('message', onMessage);
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('exit', (code, signal) => {
      clearTimeout(timer);
      reject(new Error(
        `Quote service child exited before readiness (${code ?? 'null'}/${signal ?? 'none'}): ${stderr.trim()}`,
      ));
    });
  });

  child.on('message', (message: unknown) => {
    const parsed = response(message);
    if (parsed === undefined) return;
    const waiting = pending.get(parsed.id);
    if (waiting === undefined) return;
    pending.delete(parsed.id);
    if (parsed.ok) waiting.resolve(parsed.value);
    else waiting.reject(new Error(parsed.error ?? 'Quote service child command failed.'));
  });

  const command = (name: 'reset-metrics' | 'read-metrics' | 'shutdown'): Promise<unknown> => {
    if (exited || !child.connected) {
      return Promise.reject(new Error('Quote service child is not connected.'));
    }
    nextCommand += 1;
    const id = nextCommand;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      child.send({ type: 'command', id, command: name }, (error) => {
        if (error === null) return;
        pending.delete(id);
        reject(error);
      });
    });
  };

  const shutdown = async (): Promise<void> => {
    if (exited) return;
    await command('shutdown');
    await waitForExit(child);
  };
  return Object.freeze({
    endpoint: `http://127.0.0.1:${readyMessage.port}/v1/quote`,
    pid: readyMessage.pid,
    snapshotCount: readyMessage.snapshotCount,
    mode: readyMessage.mode,
    get logs(): readonly string[] {
      return Object.freeze([...logs]);
    },
    resetMetrics: async () => {
      await command('reset-metrics');
    },
    readMetrics: async () => command('read-metrics') as Promise<ServiceMetrics>,
    shutdown,
  });
}

function waitForExit(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error('Quote service child did not stop within 10 seconds.'));
    }, 10_000);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}
