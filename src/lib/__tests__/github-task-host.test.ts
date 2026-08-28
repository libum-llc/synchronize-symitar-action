import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { createGitHubTaskHost } from '../github-task-host';

/**
 * These tests deliberately do NOT mock `@actions/core`.
 *
 * The claim under test is that `TaskHost.setOutput` produces a real *step
 * output* - something a later workflow step can read as
 * `steps.<id>.outputs.files-deployed` - and not an environment variable. A
 * mocked `@actions/core` could only prove that some function was called; it
 * could not tell `setOutput` from `exportVariable`, which is exactly the
 * confusion that fails silently. So the real toolkit runs against real
 * `GITHUB_OUTPUT` / `GITHUB_ENV` files and the assertions read what it wrote.
 *
 * `@actions/core` writes outputs to `$GITHUB_OUTPUT` as a heredoc record
 * (`name<<delimiter\nvalue\ndelimiter`) and environment variables to
 * `$GITHUB_ENV` in the same shape. The runner reads the first as step outputs
 * and the second as env. If `setOutput` were implemented with
 * `core.exportVariable`, the value would land in the env file instead and
 * `steps.<id>.outputs.*` would be empty - the assertions below fail in both
 * directions for exactly that reason.
 */

/**
 * Every name core's SynchronizeDirectory runner passes to `task.setOutput`,
 * paired with the `action.yml` output it has to land on.
 *
 * Sourced by reading `@libum-llc/pipelines-core`'s own compiled runner below,
 * so this table cannot silently fall behind a core release that publishes a
 * new output.
 */
const CORE_OUTPUT_MAPPING: Array<[coreName: string, actionName: string]> = [
  ['filesDeployed', 'files-deployed'],
  ['filesDeleted', 'files-deleted'],
  ['filesInstalled', 'files-installed'],
  ['filesUninstalled', 'files-uninstalled'],
  ['outliersCount', 'outliers-count'],
  ['outlierFiles', 'outlier-files'],
  ['pullRequestId', 'pull-request-id'],
  ['pullRequestUrl', 'pull-request-url'],
];

/**
 * Reads the output names core's compiled SynchronizeDirectory runner actually
 * publishes, straight out of the installed package.
 *
 * This resolves a path inside core's `dist/`, which production code must never
 * do - but it reads the file as *text* rather than importing it, and the point
 * is precisely to catch a core release that changed what it publishes. A test
 * that asserted against a hand-copied list would go stale silently.
 */
const readCoreOutputNames = (): string[] => {
  const runner = fs.readFileSync(
    require.resolve('@libum-llc/pipelines-core/dist/tasks/synchronize-directory.js'),
    'utf8',
  );

  return [...runner.matchAll(/setOutput\(\s*['"]([A-Za-z]+)['"]/g)].map(
    (match) => match[1],
  );
};

/** The `outputs:` names `action.yml` declares. */
const readDeclaredActionOutputs = (): string[] => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', '..', '..', 'action.yml'),
    'utf8',
  );
  const outputsBlock = source.split(/^outputs:$/m)[1].split(/^runs:$/m)[0];

  return [...outputsBlock.matchAll(/^ {2}([a-z0-9-]+):$/gm)].map(
    (match) => match[1],
  );
};

describe('createGitHubTaskHost', () => {
  const originalEnv = { ...process.env };
  let scratch: string;
  let outputFile: string;
  let envFile: string;

  beforeEach(() => {
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-task-host-'));
    outputFile = path.join(scratch, 'github_output');
    envFile = path.join(scratch, 'github_env');
    fs.writeFileSync(outputFile, '');
    fs.writeFileSync(envFile, '');
    process.env.GITHUB_OUTPUT = outputFile;
    process.env.GITHUB_ENV = envFile;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    fs.rmSync(scratch, { recursive: true, force: true });
  });

  describe('setOutput', () => {
    it('writes a real step output, not an environment variable', () => {
      createGitHubTaskHost().setOutput('filesDeployed', '7');

      const outputs = fs.readFileSync(outputFile, 'utf8');
      const envs = fs.readFileSync(envFile, 'utf8');

      // The step-output file carries the value...
      expect(outputs).toContain('files-deployed');
      expect(outputs).toMatch(/^files-deployed<<.+$/m);
      expect(outputs).toMatch(/^7$/m);
      // ...and the environment file is untouched. This is the assertion that
      // distinguishes core.setOutput from core.exportVariable.
      expect(envs).toBe('');
      expect(envs).not.toContain('files-deployed');
    });

    it.each(CORE_OUTPUT_MAPPING)(
      'publishes core output %s under the action.yml name %s',
      (coreName, actionName) => {
        createGitHubTaskHost().setOutput(coreName, '0');

        expect(fs.readFileSync(outputFile, 'utf8')).toMatch(
          new RegExp(`^${actionName}<<`, 'm'),
        );
      },
    );

    // The three-way tie-up: what core publishes, what this adapter renames it
    // to, and what action.yml declares. A core release that adds an output, or
    // an action.yml that drops one, breaks this rather than silently
    // publishing an output no consumer can read.
    it('covers exactly the outputs core publishes, and each is declared in action.yml', () => {
      const published = readCoreOutputNames();
      const declared = readDeclaredActionOutputs();

      // Guards against either reader silently matching nothing.
      expect(published).toContain('filesDeployed');
      expect(declared).toContain('files-deployed');

      expect(new Set(published)).toEqual(
        new Set(CORE_OUTPUT_MAPPING.map(([coreName]) => coreName)),
      );
      CORE_OUTPUT_MAPPING.forEach(([, actionName]) => {
        expect(declared).toContain(actionName);
      });
    });
  });

  describe('getInput', () => {
    it('reads an action.yml input under its kebab-case name', () => {
      process.env['INPUT_CONNECTION-TYPE'] = 'ssh';

      expect(createGitHubTaskHost().getInput('connectionType')).toBe('ssh');
    });

    it('reads an overridden input name', () => {
      process.env['INPUT_DRY-RUN'] = 'true';

      expect(createGitHubTaskHost().getInput('isDryRun')).toBe('true');
    });

    it('throws when a required input is missing', () => {
      expect(() =>
        createGitHubTaskHost().getInput('symitarHostname', true),
      ).toThrow(/symitar-hostname/);
    });

    it('returns an empty string for an absent optional input', () => {
      expect(createGitHubTaskHost().getInput('localDirectoryPath')).toBe('');
    });
  });

  describe('log channels', () => {
    it.each([
      ['warning', '::warning::'],
      ['error', '::error::'],
      ['debug', '::debug::'],
      ['info', 'something happened'],
    ] as const)('emits %s on stdout', (channel, marker) => {
      process.env.RUNNER_DEBUG = '1';
      const write = jest
        .spyOn(process.stdout, 'write')
        .mockImplementation(() => true);

      createGitHubTaskHost()[channel]('something happened');

      expect(write.mock.calls.flat().join('')).toContain(marker);
      write.mockRestore();
    });

    it('registers a secret with the runner mask', () => {
      const write = jest
        .spyOn(process.stdout, 'write')
        .mockImplementation(() => true);

      createGitHubTaskHost().setSecret('super-secret');

      expect(write.mock.calls.flat().join('')).toContain(
        '::add-mask::super-secret',
      );
      write.mockRestore();
    });
  });
});
