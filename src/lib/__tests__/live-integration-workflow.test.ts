import { readFileSync } from 'fs';
import * as path from 'path';

import { load } from 'js-yaml';

// Keep live coverage manual, single-attempt and read-only. Failure and legacy
// selector cases belong in the offline suite, never in console login loops.
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
  const job = workflow.jobs['symitar'];

  return job.steps.filter((step) => step.uses === './');
};

/** Directory types whose remote directory is not REPWRITERSPECS. */
const NON_POWERON_DIRECTORY_TYPES = ['letterFiles', 'dataFiles', 'helpFiles'];

describe('live-integration workflow safety invariants', () => {
  it('invokes the action exactly once with no retry step', () => {
    expect(actionSteps()).toHaveLength(1);
  });

  it('runs every scenario as a dry run', () => {
    for (const step of actionSteps()) {
      expect([step.name, step.with?.['dry-run']]).toEqual([step.name, 'true']);
    }
  });

  it('limits the live preview to non-PowerOn directories', () => {
    for (const step of actionSteps()) {
      expect(NON_POWERON_DIRECTORY_TYPES).toContain(
        step.with?.['directory-type'],
      );
    }
  });

  it('declares every directory-type it uses as a known type', () => {
    const known = [...NON_POWERON_DIRECTORY_TYPES, 'powerOns'];

    for (const step of actionSteps()) {
      expect(known).toContain(step.with?.['directory-type']);
    }
  });

  it('requires manual dispatch and never runs on pull requests or pushes', () => {
    const workflow = load(workflowSource()) as { on: Record<string, unknown> };
    expect(Object.keys(workflow.on)).toEqual(['workflow_dispatch']);
  });

  it('supplies explicit host trust and omits legacy selectors', () => {
    for (const step of actionSteps()) {
      expect(step.with?.['ssh-host-key']).toBe(
        '${{ vars.SYMITAR_SSH_HOST_KEY }}',
      );
      expect(step.with).not.toHaveProperty('connection-type');
      expect(step.with).not.toHaveProperty('symitar-app-port');
    }
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
