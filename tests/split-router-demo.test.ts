import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const DEMO = fileURLToPath(new URL('../cli/demo.ts', import.meta.url));

void test('demo executes the verified composed fixture and prints exact deterministic evidence', () => {
  const first = spawnSync(process.execPath, [DEMO], { cwd: ROOT, encoding: 'utf8' });
  const second = spawnSync(process.execPath, [DEMO], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(first.status, 0);
  assert.equal(first.stderr, '');
  assert.equal(second.stdout, first.stdout);
  const report = JSON.parse(first.stdout) as Record<string, unknown> & {
    runs: {
      full: {
        termination: string;
        counters: Record<string, number>;
        workCaps: Record<string, number>;
      };
      restricted: {
        termination: string;
        counters: Record<string, number>;
        workCaps: Record<string, number>;
      };
    };
    limitations: readonly string[];
  };
  assert.equal(report['exactInput'], '100');
  assert.equal(report['bestSingleOutput'], '50');
  assert.equal(report['mandatoryFallbackOutput'], '50');
  assert.deepEqual(report['splitAllocations'], ['50', '50']);
  assert.equal(report['splitOutput'], '66');
  assert.equal(report['exactImprovement'], '16');
  assert.equal(report.runs.full.termination, 'complete');
  assert.deepEqual(report.runs.full.counters, {
    directCandidates: 2,
    directCandidateReplays: 2,
    directCandidateRejections: 0,
    pathExpansions: 2,
    bestSingleCandidateReplays: 2,
    bestSingleCandidateRejections: 0,
    candidateSetExpansions: 2,
    equalProposalReplays: 1,
    equalProposalRejections: 0,
    greedyOptionReplays: 4,
    greedyOptionRejections: 0,
    finalAuthorizationReplays: 1,
    finalAuthorizationRejections: 0,
  });
  assert.deepEqual(report.runs.full.workCaps, {
    maxPathExpansions: 100,
    maxBestSingleCandidateReplays: 100,
    maxCandidateSetExpansions: 100,
    maxEqualProposalReplays: 100,
    maxGreedyOptionReplays: 100,
    maxFinalAuthorizationReplays: 100,
  });
  assert.equal(report.runs.restricted.termination, 'work-limit');
  assert.deepEqual(report.runs.restricted.counters, {
    directCandidates: 2,
    directCandidateReplays: 2,
    directCandidateRejections: 0,
    pathExpansions: 0,
    bestSingleCandidateReplays: 0,
    bestSingleCandidateRejections: 0,
    candidateSetExpansions: 0,
    equalProposalReplays: 0,
    equalProposalRejections: 0,
    greedyOptionReplays: 0,
    greedyOptionRejections: 0,
    finalAuthorizationReplays: 0,
    finalAuthorizationRejections: 0,
  });
  assert.deepEqual(report.runs.restricted.workCaps, {
    maxPathExpansions: 0,
    maxBestSingleCandidateReplays: 0,
    maxCandidateSetExpansions: 0,
    maxEqualProposalReplays: 0,
    maxGreedyOptionReplays: 0,
    maxFinalAuthorizationReplays: 0,
  });
  assert.deepEqual(report.limitations, [
    'fixed offline fixture evidence only',
    'no performance or throughput conclusion',
    'no unrestricted global-optimality claim',
    'no live service, transaction, custody, or protocol execution',
  ]);
});
