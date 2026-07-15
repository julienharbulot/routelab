import {
  availableParallelism,
  cpus,
  endianness,
  release,
  type
} from 'node:os';
import {
  arch,
  env,
  execArgv,
  platform,
  version,
  versions
} from 'node:process';

import {
  isVerifierEnvironmentFailure,
  ServiceFastVerifierEnvironmentError,
} from './failure.ts';

const REQUIRED_HOST = Object.freeze({
  nodeVersion: 'v24.18.0',
  v8Version: '13.6.233.17-node.50',
  uvVersion: '1.52.1',
  operatingSystemPlatform: 'linux',
  architecture: 'x64',
  byteOrder: 'LE',
  osType: 'Linux',
  osRelease: '6.18.33.2-microsoft-standard-WSL2',
  cpuModel: '13th Gen Intel(R) Core(TM) i9-13900H',
  logicalCpuCount: 20,
  logicalParallelism: 20,
});

export interface ServiceFastVerifierHostSnapshot {
  readonly nodeRuntime: string;
  readonly v8Runtime: string;
  readonly uvRuntime: string;
  readonly operatingSystemPlatform: string;
  readonly architecture: string;
  readonly byteOrder: string;
  readonly osType: string;
  readonly osRelease: string;
  readonly cpuModel: string | undefined;
  readonly logicalCpuCount: number;
  readonly logicalParallelism: number;
  readonly startupArguments: readonly string[];
  readonly runtimeOptions: string | undefined;
}

function environmentFailure(): never {
  throw new ServiceFastVerifierEnvironmentError();
}

function captureServiceFastVerifierHost(): ServiceFastVerifierHostSnapshot {
  const nodeOptions = env['NODE_OPTIONS'];
  const runtimeVersions = versions;
  const cpuValues = cpus();
  return Object.freeze({
    nodeRuntime: version,
    v8Runtime: runtimeVersions.v8,
    uvRuntime: runtimeVersions.uv,
    operatingSystemPlatform: platform,
    architecture: arch,
    byteOrder: endianness(),
    osType: type(),
    osRelease: release(),
    cpuModel: cpuValues[0]?.model,
    logicalCpuCount: cpuValues.length,
    logicalParallelism: availableParallelism(),
    startupArguments: Object.freeze([...execArgv]),
    runtimeOptions: nodeOptions,
  });
}

export function admitServiceFastVerifierHostSnapshot(
  snapshot: ServiceFastVerifierHostSnapshot,
): void {
  try {
    if (
      (snapshot.runtimeOptions !== undefined && snapshot.runtimeOptions !== '') ||
      snapshot.nodeRuntime !== REQUIRED_HOST.nodeVersion ||
      snapshot.v8Runtime !== REQUIRED_HOST.v8Version ||
      snapshot.uvRuntime !== REQUIRED_HOST.uvVersion ||
      snapshot.operatingSystemPlatform !== REQUIRED_HOST.operatingSystemPlatform ||
      snapshot.architecture !== REQUIRED_HOST.architecture ||
      snapshot.byteOrder !== REQUIRED_HOST.byteOrder ||
      snapshot.osType !== REQUIRED_HOST.osType ||
      snapshot.osRelease !== REQUIRED_HOST.osRelease ||
      snapshot.cpuModel !== REQUIRED_HOST.cpuModel ||
      snapshot.logicalCpuCount !== REQUIRED_HOST.logicalCpuCount ||
      snapshot.logicalParallelism !== REQUIRED_HOST.logicalParallelism ||
      snapshot.startupArguments.length !== 0
    ) {
      environmentFailure();
    }
    // The authenticated dispatcher starts this fixed child as the main process;
    // worker-thread reachability is excluded from the durable runtime graph.
  } catch (error) {
    if (isVerifierEnvironmentFailure(error)) throw error;
    environmentFailure();
  }
}

export function admitServiceFastVerifierHost(): void {
  admitServiceFastVerifierHostCapture(captureServiceFastVerifierHost);
}

export function admitServiceFastVerifierHostCapture(
  capture: () => ServiceFastVerifierHostSnapshot,
): void {
  try {
    admitServiceFastVerifierHostSnapshot(capture());
  } catch (error) {
    if (isVerifierEnvironmentFailure(error)) throw error;
    environmentFailure();
  }
}
