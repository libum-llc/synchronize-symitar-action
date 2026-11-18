import { readFileSync } from 'fs';
import * as path from 'path';
const { load } = require('js-yaml');
const workflow = load(
  readFileSync(
    path.join(__dirname, '../../../.github/workflows/live-integration.yml'),
    'utf8',
  ),
);
const job = workflow.jobs.symitar;
const steps = job.steps as Array<{
  id?: string;
  uses?: string;
  run?: string;
  if?: string;
  'continue-on-error'?: boolean;
  with?: Record<string, string>;
  env?: Record<string, string>;
}>;
const actions = steps.filter((step) => step.uses === './');

describe('live connector coverage and authentication safety', () => {
  it('bounds credential-free preflight without selecting Windows WSL Bash', () => {
    const preflight = job.steps.find(
      (step: { run?: string }) =>
        step.run === 'node scripts/integration/preflight.js',
    );
    expect(preflight['timeout-minutes']).toBe(1);
    expect(preflight.shell).toBeUndefined();
  });
  it('runs on trusted branch pushes or dispatch, never fork/target PR events', () => {
    expect(Object.keys(workflow.on).sort()).toEqual([
      'push',
      'workflow_dispatch',
    ]);
    expect(workflow.on.push['branches-ignore']).toContain('main');
    expect(job.if).toContain('github.run_attempt == 1');
    expect(job.strategy).toBeUndefined();
    expect(workflow.concurrency['cancel-in-progress']).toBe(false);
  });
  it('tests the committed bundle through only the default connector', () => {
    for (const step of actions) {
      expect(step.with?.['ssh-host-key']).toBe(
        '${{ vars.SYMITAR_SSH_HOST_KEY }}',
      );
      expect(step.with).not.toHaveProperty('connection-type');
      expect(step.with).not.toHaveProperty('symitar-app-port');
      expect(step.with?.['api-key']).toBe('poweron-pipelines-live-test-only');
      expect(step.env?.NODE_OPTIONS).toBe(
        '--require ./scripts/integration/preload-license.js',
      );
      for (const key of [
        'ssh-password',
        'symitar-user-password',
        'symitar-hostname',
        'ssh-username',
        'sym-number',
        'symitar-user-number',
      ])
        expect(step.with?.[key]).toMatch(/^\$\{\{ secrets\./);
    }
    expect(steps.some((step) => step.run?.includes('pnpm build'))).toBe(false);
  });
  it('never runs a connecting step unconditionally after failure', () => {
    for (const step of steps.filter(
      (s) =>
        s.uses === './' ||
        /fixtures.js (check-absent|cleanup)/.test(s.run || ''),
    )) {
      expect(step.if).toBeUndefined();
    }
  });
  it('retains preview, push, no-op, filtered pull, and byte transfer coverage', () => {
    expect(actions.map((step) => step.id)).toEqual([
      'preview',
      'repeat_preview',
      'push',
      'noop',
      'pull_nomatch',
      'pull_preview',
      'pull',
    ]);
    expect(actions.filter((step) => step['continue-on-error'])).toEqual([]);
    expect(
      actions
        .filter((step) => step.with?.['dry-run'] === 'false')
        .map((step) => step.id),
    ).toEqual(['push', 'noop', 'pull']);
    for (const step of actions) {
      expect(step.with?.['directory-type']).toBe('helpFiles');
      expect(step.with?.['sync-mode']).not.toBe('mirror');
    }
    expect(actions.at(-1)?.with?.['pull-preserved-only']).toBe('true');
    expect(actions.at(-1)?.with?.['preserve-server-files']).toContain('\n');
    expect(
      steps.findIndex((step) => step.run?.endsWith('check-absent')),
    ).toBeLessThan(steps.indexOf(actions[0]));
    expect(
      steps.findIndex((step) => step.run?.endsWith('verify-local')),
    ).toBeLessThan(steps.findIndex((step) => step.run?.endsWith('cleanup')));
  });
});
