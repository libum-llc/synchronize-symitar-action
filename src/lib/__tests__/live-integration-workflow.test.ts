import { readFileSync } from 'fs';
import * as path from 'path';

import { load } from 'js-yaml';

/**
 * Guards the safety invariants of `.github/workflows/live-integration.yml`.
 *
 * That workflow cannot be run from CI - it needs the self-hosted runner with
 * network access to SYM 627 - so the only thing standing between a plausible
 * edit and unattended writes to a live credit-union core is review. These tests
 * make the two load-bearing properties machine-checked instead.
 *
 * The important one is not `dry-run`. In `@libum-llc/symitar@1.12.0`,
 * `dist/shared/sync-orchestrator.js` computes
 *
 *     shouldValidate = hasPowerOnOptions
 *                   && syncMode !== PULL
 *                   && !options.powerOn?.skipValidation
 *
 * with **no `isDryRun` term**, and evaluates it *before* `operations.executeSync`
 * - which is where the dry-run short-circuit actually lives. PowerOn validation
 * uploads each changed file into REPWRITERSPECS under a temp name, compiles it
 * and unlinks it, so a dry-run push of `powerOns` writes to the host.
 * `hasPowerOnOptions` is false only because every scenario targets a directory
 * other than REPWRITERSPECS.
 */

const WORKFLOW_PATH = path.join(
  __dirname,
  '..',
  '..',
  '..',
  '.github',
  'workflows',
  'live-integration.yml',
);

interface WorkflowStep {
  name?: string;
  uses?: string;
  with?: Record<string, string>;
}

const workflowSource = (): string => readFileSync(WORKFLOW_PATH, 'utf8');

const actionSteps = (): WorkflowStep[] => {
  const workflow = load(workflowSource()) as {
    jobs: Record<string, { steps: WorkflowStep[]; if?: string }>;
  };
  const job = workflow.jobs['synchronize-symitar'];

  return job.steps.filter((step) => step.uses === './');
};

/** Directory types whose remote directory is not REPWRITERSPECS. */
const NON_POWERON_DIRECTORY_TYPES = ['letterFiles', 'dataFiles', 'helpFiles'];

describe('live-integration workflow safety invariants', () => {
  it('invokes the action at least once (guards against a vacuous suite)', () => {
    expect(actionSteps().length).toBeGreaterThan(0);
  });

  it('runs every scenario as a dry run', () => {
    for (const step of actionSteps()) {
      expect([step.name, step.with?.['dry-run']]).toEqual([step.name, 'true']);
    }
  });

  // The real guard. `dry-run: true` is necessary but NOT sufficient: PowerOn
  // validation ignores it entirely. A `powerOns` scenario is only read-only if
  // it also pulls (validation is skipped for PULL) or sets skip-validation.
  it('never pushes or mirrors powerOns, because validation ignores dry-run', () => {
    const offenders = actionSteps().filter((step) => {
      const inputs = step.with ?? {};
      if (NON_POWERON_DIRECTORY_TYPES.includes(inputs['directory-type'])) {
        return false;
      }
      if (inputs['sync-mode'] === 'pull') return false;
      if (inputs['skip-validation'] === 'true') return false;
      return true;
    });

    expect(offenders.map((step) => step.name ?? '(unnamed step)')).toEqual([]);
  });

  it('declares every directory-type it uses as a known type', () => {
    const known = [...NON_POWERON_DIRECTORY_TYPES, 'powerOns'];

    for (const step of actionSteps()) {
      expect(known).toContain(step.with?.['directory-type']);
    }
  });

  // A fork's pull request must never reach the self-hosted runner. Checked here
  // rather than only in review because the trigger is `pull_request` on a public
  // repository.
  it('keeps the fork guard and never uses pull_request_target as a trigger', () => {
    const source = workflowSource();
    const workflow = load(source) as {
      on: Record<string, unknown>;
      jobs: Record<string, { if?: string }>;
    };

    expect(workflow.jobs['synchronize-symitar'].if).toContain(
      'github.event.pull_request.head.repo.full_name == github.repository',
    );
    expect(Object.keys(workflow.on)).not.toContain('pull_request_target');

    // Not a bare grep: the phrase legitimately appears in the security comment
    // warning against it. Only non-comment lines count.
    const nonCommentUses = source
      .split('\n')
      .filter(
        (line) =>
          line.includes('pull_request_target') && !line.trim().startsWith('#'),
      );
    expect(nonCommentUses).toEqual([]);
  });

  it('never inlines a credential-shaped value', () => {
    for (const step of actionSteps()) {
      for (const [name, value] of Object.entries(step.with ?? {})) {
        if (/password|api-key|token/.test(name)) {
          expect(value).toMatch(/^\$\{\{\s*secrets\./);
        }
      }
    }
  });
});
