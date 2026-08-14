import * as childProcess from 'child_process';
import { tmpdir } from 'os';

import { SymitarHTTPs, SymitarSSH } from '@libum-llc/symitar';

import {
  InputError,
  SymNumberError,
  validateApiKey,
} from '@libum-llc/pipelines-core';

import {
  createHTTPsClient,
  createSSHClient,
  loadSynchronizeConfig,
  validateTaskApiKey,
  type SynchronizeActionConfig,
} from '../task-orchestration';

// Both mocks spread `requireActual` on purpose. `@libum-llc/pipelines-core`
// owns the error hierarchy these assertions dispatch on, and it imports
// `@libum-llc/symitar` itself for the sync-mode enums - so a bare factory mock
// would replace the very classes under test and make the suite vacuous rather
// than failing.
jest.mock('@libum-llc/symitar', () => ({
  ...jest.requireActual('@libum-llc/symitar'),
  SymitarHTTPs: jest.fn(),
  SymitarSSH: jest
    .fn()
    .mockImplementation(() => ({ isReady: Promise.resolve() })),
}));
jest.mock('@libum-llc/pipelines-core', () => ({
  ...jest.requireActual('@libum-llc/pipelines-core'),
  validateApiKey: jest.fn().mockResolvedValue(undefined),
}));
// Only `execFileSync`, which the commit-branch guard shells out through.
// `jest.spyOn` cannot be used here: Node marks `child_process`'s exports
// non-configurable, so redefining one throws.
jest.mock('child_process', () => ({
  ...jest.requireActual('child_process'),
  execFileSync: jest.fn(),
}));

const symitarSSHMock = SymitarSSH as unknown as jest.Mock;
const symitarHTTPsMock = SymitarHTTPs as unknown as jest.Mock;

const WORKSPACE = '/home/runner/work/repo/repo';

/**
 * The minimum set of `action.yml` inputs required to load a config.
 */
const BASE_INPUTS: Record<string, string> = {
  'api-key': 'test-api-key',
  'symitar-hostname': 'symitar.example.com',
  'ssh-username': 'testuser',
  'ssh-password': 'testpass',
  'symitar-user-number': '1234',
  'symitar-user-password': 'userpass',
  'sym-number': '627',
  'directory-type': 'powerOns',
  'sync-mode': 'push',
  'dry-run': 'true',
};

const setActionInputs = (inputs: Record<string, string>): void => {
  Object.entries(inputs).forEach(([name, value]) => {
    process.env[`INPUT_${name.toUpperCase()}`] = value;
  });
};

const clearActionInputs = (): void => {
  Object.keys(process.env).forEach((key) => {
    if (key.startsWith('INPUT_')) {
      delete process.env[key];
    }
  });
};

describe('task-orchestration', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    clearActionInputs();
    process.env.GITHUB_REF = 'refs/heads/feature/test';
    process.env.GITHUB_REF_NAME = 'feature/test';
    process.env.GITHUB_WORKSPACE = WORKSPACE;
    delete process.env.RUNNER_TEMP;
    setActionInputs(BASE_INPUTS);

    // Suppress the repo config banner during tests
    jest.spyOn(console, 'info').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
    clearActionInputs();
    delete process.env.GITHUB_REF;
    delete process.env.GITHUB_REF_NAME;
    delete process.env.GITHUB_WORKSPACE;
    delete process.env.RUNNER_TEMP;
  });

  describe('loadSynchronizeConfig', () => {
    it('should load synchronize configuration from action inputs', () => {
      const config = loadSynchronizeConfig();

      expect(config.logPrefix).toBe('[Main]');
      expect(config.buildBranch).toBe('refs/heads/feature/test');
      expect(config.buildBranchName).toBe('feature/test');
      expect(config.apiKey).toBe('test-api-key');
      expect(config.symitarHostname).toBe('symitar.example.com');
      expect(config.sshUsername).toBe('testuser');
      expect(config.sshPassword).toBe('testpass');
      expect(config.sshPort).toBe(22);
      expect(config.symNumber).toBe(627);
      expect(config.symitarUserNumber).toBe('1234');
      expect(config.symitarUserPassword).toBe('userpass');
      expect(config.powerOnsDirectory).toBe('REPWRITERSPECS/');
      expect(config.syncMode).toBe('push');
      expect(config.syncMethod).toBe('sftp');
      expect(config.sftpConcurrency).toBe(4);
      expect(config.isDryRun).toBe(true);
      expect(config.skipValidation).toBe(false);
      expect(config.debug).toBe(false);
      expect(config.symitarAppPort).toBeUndefined();
      expect(config.preserveServerFiles).toEqual([]);
      expect(config.pullPreservedOnly).toBe(false);
      expect(config.commitPulledChanges).toBe(false);
      expect(config.createPullRequest).toBe(false);
      expect(config.commitMessage).toBe(
        'chore: sync server-managed Symitar files [skip ci]',
      );
      expect(config.gitUserName).toBe('libum-bot');
      expect(config.gitUserEmail).toBe('bot@libum.io');
      expect(config.githubToken).toBeUndefined();
    });

    it('should trim the api-key input', () => {
      setActionInputs({ 'api-key': '  test-api-key  ' });

      expect(loadSynchronizeConfig().apiKey).toBe('test-api-key');
    });

    it('should throw when a required input is missing', () => {
      delete process.env['INPUT_API-KEY'];

      expect(() => loadSynchronizeConfig()).toThrow(
        'Input required and not supplied: api-key',
      );
    });

    // The Azure extension synchronizes a downloaded build artifact staged
    // separately from the source checkout; on GitHub the checkout is the thing
    // being synchronized.
    describe('workspace paths', () => {
      it('should resolve all source paths from GITHUB_WORKSPACE', () => {
        const config = loadSynchronizeConfig();

        expect(config.sourcePath).toBe(WORKSPACE);
        expect(config.sourceAbsolutePath).toBe(WORKSPACE);
        expect(config.workspacePath).toBe(WORKSPACE);
      });

      it('should fall back to the process cwd when GITHUB_WORKSPACE is unset', () => {
        delete process.env.GITHUB_WORKSPACE;

        const config = loadSynchronizeConfig();

        expect(config.sourceAbsolutePath).toBe(process.cwd());
        expect(config.workspacePath).toBe(process.cwd());
      });

      // Core builds `${basePath}/${localDirectoryPath}`
      it('should strip a trailing separator from the workspace path', () => {
        process.env.GITHUB_WORKSPACE = `${WORKSPACE}/`;

        expect(loadSynchronizeConfig().sourceAbsolutePath).toBe(WORKSPACE);
      });
    });

    // Core never reads host environment variables, so the runner's scratch
    // location (it mkdtemps a transaction root there) is resolved here.
    describe('tempDirectory', () => {
      it('should use RUNNER_TEMP when the runner provides it', () => {
        process.env.RUNNER_TEMP = '/home/runner/work/_temp';

        expect(loadSynchronizeConfig().tempDirectory).toBe(
          '/home/runner/work/_temp',
        );
      });

      it('should fall back to the OS temp directory', () => {
        delete process.env.RUNNER_TEMP;

        expect(loadSynchronizeConfig().tempDirectory).toBe(tmpdir());
      });
    });

    describe('repoConfig', () => {
      it('should build a repo config with the pipelines directory defaults', () => {
        const config = loadSynchronizeConfig();

        expect(config.repoConfig).toEqual({
          inputs: {
            powerOnsDirectory: 'REPWRITERSPECS/',
            letterFilesDirectory: 'LETTERSPECS/',
            dataFilesDirectory: 'DATAFILES/',
            helpFilesDirectory: 'HELPFILES/',
          },
          branchSymNumbers: {},
          installPowerOns: [],
          validateIgnorePowerOns: [],
          preserveServerFiles: [],
        });
      });

      it.each([
        ['powerOns', 'powerOnsDirectory'],
        ['letterFiles', 'letterFilesDirectory'],
        ['dataFiles', 'dataFilesDirectory'],
        ['helpFiles', 'helpFilesDirectory'],
      ] as const)(
        'should apply local-directory-path to the %s directory field',
        (directoryType, configKey) => {
          setActionInputs({
            'directory-type': directoryType,
            'local-directory-path': 'CUSTOM/',
          });

          expect(loadSynchronizeConfig().repoConfig.inputs[configKey]).toBe(
            'CUSTOM/',
          );
        },
      );

      it('should leave the other directory fields at their defaults', () => {
        setActionInputs({
          'directory-type': 'letterFiles',
          'local-directory-path': 'CUSTOM/',
        });

        expect(loadSynchronizeConfig().repoConfig.inputs).toEqual({
          powerOnsDirectory: 'REPWRITERSPECS/',
          letterFilesDirectory: 'CUSTOM/',
          dataFilesDirectory: 'DATAFILES/',
          helpFilesDirectory: 'HELPFILES/',
        });
      });

      it('should ignore local-directory-path for an unknown directory-type', () => {
        setActionInputs({
          'directory-type': 'nonsense',
          'local-directory-path': 'CUSTOM/',
        });

        expect(loadSynchronizeConfig().repoConfig.inputs).toEqual({
          powerOnsDirectory: 'REPWRITERSPECS/',
          letterFilesDirectory: 'LETTERSPECS/',
          dataFilesDirectory: 'DATAFILES/',
          helpFilesDirectory: 'HELPFILES/',
        });
      });

      // The trailing slash the Azure extension guarantees through its zod
      // config schema has to be restored on the input instead: core validates
      // nothing about the shape of a directory path.
      it.each([
        ['no trailing slash', 'REPWRITERSPECS', 'REPWRITERSPECS/'],
        ['one trailing slash', 'REPWRITERSPECS/', 'REPWRITERSPECS/'],
        ['repeated trailing slashes', 'REPWRITERSPECS//', 'REPWRITERSPECS/'],
        ['a multi-segment path', 'SPECS/PO', 'SPECS/PO/'],
        ['a backslash-separated path', 'SPECS\\PO', 'SPECS/PO/'],
        ['surrounding whitespace', '  SPECS/PO  ', 'SPECS/PO/'],
      ])(
        'should normalize a local-directory-path with %s to exactly one trailing slash',
        (_description, input, expected) => {
          setActionInputs({ 'local-directory-path': input });

          const config = loadSynchronizeConfig();

          expect(config.repoConfig.inputs.powerOnsDirectory).toBe(expected);
          expect(config.powerOnsDirectory).toBe(expected);
        },
      );
    });

    it('should use the default SSH port when ssh-port is not provided', () => {
      expect(loadSynchronizeConfig().sshPort).toBe(22);
    });

    it('should use the ssh-port input when provided', () => {
      setActionInputs({ 'ssh-port': '2222' });

      expect(loadSynchronizeConfig().sshPort).toBe(2222);
    });

    it('should throw InputError for an invalid hostname', () => {
      setActionInputs({ 'symitar-hostname': 'invalid hostname!' });

      expect(() => loadSynchronizeConfig()).toThrow(InputError);
    });

    it('should throw InputError for an out-of-range ssh port', () => {
      setActionInputs({ 'ssh-port': '99999' });

      expect(() => loadSynchronizeConfig()).toThrow(InputError);
    });

    describe('boolean inputs', () => {
      it('should enable debug when the debug input is true', () => {
        setActionInputs({ debug: 'true' });

        expect(loadSynchronizeConfig().debug).toBe(true);
      });

      it('should default debug to false when the input is unset', () => {
        delete process.env.INPUT_DEBUG;

        expect(loadSynchronizeConfig().debug).toBe(false);
      });

      it.each([
        ['pull-preserved-only', 'pullPreservedOnly'],
        ['skip-validation', 'skipValidation'],
      ] as const)(
        'should default %s to false when unset',
        (_inputName, field) => {
          expect(loadSynchronizeConfig()[field]).toBe(false);
        },
      );

      it('should read skip-validation into skipValidation', () => {
        setActionInputs({ 'skip-validation': 'true' });

        expect(loadSynchronizeConfig().skipValidation).toBe(true);
      });

      it('should read pull-preserved-only into pullPreservedOnly', () => {
        setActionInputs({ 'pull-preserved-only': 'true' });

        expect(loadSynchronizeConfig().pullPreservedOnly).toBe(true);
      });

      it('should read dry-run into isDryRun', () => {
        setActionInputs({ 'dry-run': 'false' });

        expect(loadSynchronizeConfig().isDryRun).toBe(false);
      });

      // Failing closed: an empty dry-run must never be read as a live run
      it('should throw when dry-run is empty rather than defaulting to false', () => {
        setActionInputs({ 'dry-run': '' });

        expect(() => loadSynchronizeConfig()).toThrow(
          'Input required and not supplied: dry-run',
        );
      });

      it('should throw for a dry-run value that is not a boolean', () => {
        setActionInputs({ 'dry-run': 'yes' });

        expect(() => loadSynchronizeConfig()).toThrow(TypeError);
      });
    });

    describe('symNumber', () => {
      it('should resolve symNumber as a number', () => {
        const config = loadSynchronizeConfig();

        expect(config.symNumber).toBe(627);
        expect(typeof config.symNumber).toBe('number');
      });

      it('should not zero-pad a single digit sym number', () => {
        setActionInputs({ 'sym-number': '7' });

        const config = loadSynchronizeConfig();

        expect(config.symNumber).toBe(7);
        expect(typeof config.symNumber).toBe('number');
      });

      it('should normalize a zero-padded input to a number', () => {
        setActionInputs({ 'sym-number': '007' });

        expect(loadSynchronizeConfig().symNumber).toBe(7);
      });

      it('should throw SymNumberError for a non-numeric sym number', () => {
        setActionInputs({ 'sym-number': 'abc' });

        expect(() => loadSynchronizeConfig()).toThrow(SymNumberError);
      });

      // Number('') is 0, which isValidNumber accepts: a missing sym-number
      // must not be read as Sym 0
      it('should throw SymNumberError when sym-number is empty', () => {
        setActionInputs({ 'sym-number': '' });

        expect(() => loadSynchronizeConfig()).toThrow(SymNumberError);
      });

      it('should throw SymNumberError when sym-number is whitespace only', () => {
        setActionInputs({ 'sym-number': '   ' });

        expect(() => loadSynchronizeConfig()).toThrow(SymNumberError);
      });
    });

    describe('list inputs', () => {
      it('should parse a comma-delimited install-poweron-list input', () => {
        setActionInputs({ 'install-poweron-list': 'ONE.PO, TWO.PO' });

        expect(loadSynchronizeConfig().repoConfig.installPowerOns).toEqual([
          'ONE.PO',
          'TWO.PO',
        ]);
      });

      it('should parse a comma-delimited validate-ignore-list input', () => {
        setActionInputs({ 'validate-ignore-list': 'IGNORE.PO, OTHER.PO' });

        expect(
          loadSynchronizeConfig().repoConfig.validateIgnorePowerOns,
        ).toEqual(['IGNORE.PO', 'OTHER.PO']);
      });

      it('should parse a comma-delimited preserve-server-files input', () => {
        setActionInputs({ 'preserve-server-files': 'RD.*, PFR.*' });

        expect(loadSynchronizeConfig().preserveServerFiles).toEqual([
          'RD.*',
          'PFR.*',
        ]);
      });

      const parsedList = (inputName: string): string[] => {
        const config = loadSynchronizeConfig();
        return {
          'install-poweron-list': config.repoConfig.installPowerOns,
          'validate-ignore-list': config.repoConfig.validateIgnorePowerOns,
          'preserve-server-files': config.preserveServerFiles,
        }[inputName]!;
      };

      // Not comma-only. `action.yml` inputs are plain strings, the README has
      // documented the multi-line and YAML block-sequence forms since v1, and
      // narrowing this would silently collapse
      // `preserve-server-files: |\n  - RD.*\n  - PFR.*` into one pattern that
      // matches nothing - every preserved server file would start being
      // overwritten on the next push.
      it.each([
        ['install-poweron-list'],
        ['validate-ignore-list'],
        ['preserve-server-files'],
      ])('should split a newline-delimited %s value', (inputName) => {
        setActionInputs({ [inputName]: 'ONE.PO\nTWO.PO' });

        expect(parsedList(inputName)).toEqual(['ONE.PO', 'TWO.PO']);
      });

      it.each([
        ['install-poweron-list'],
        ['validate-ignore-list'],
        ['preserve-server-files'],
      ])('should parse a YAML block sequence in %s', (inputName) => {
        setActionInputs({ [inputName]: '- ONE.PO\n- TWO.PO\n' });

        expect(parsedList(inputName)).toEqual(['ONE.PO', 'TWO.PO']);
      });

      it('should strip a leading "- " YAML list marker', () => {
        setActionInputs({ 'install-poweron-list': '- ONE.PO, - TWO.PO' });

        expect(loadSynchronizeConfig().repoConfig.installPowerOns).toEqual([
          'ONE.PO',
          'TWO.PO',
        ]);
      });

      // The exact README example. Left as an explicit case because it is the
      // one that silently broke: a single unmatched pattern rather than two.
      it('should parse the preserve-server-files example from the README', () => {
        setActionInputs({ 'preserve-server-files': '- RD.*\n- PFR.*\n' });

        expect(loadSynchronizeConfig().preserveServerFiles).toEqual([
          'RD.*',
          'PFR.*',
        ]);
      });

      it('should default the list inputs to empty lists', () => {
        const config = loadSynchronizeConfig();

        expect(config.repoConfig.installPowerOns).toEqual([]);
        expect(config.repoConfig.validateIgnorePowerOns).toEqual([]);
        expect(config.preserveServerFiles).toEqual([]);
      });
    });

    describe('syncMode', () => {
      it.each([
        ['push', 'push'],
        ['pull', 'pull'],
        ['mirror', 'mirror'],
      ])('should map the %s input to the %s mode', (input, expected) => {
        setActionInputs({ 'sync-mode': input });

        expect(loadSynchronizeConfig().syncMode).toBe(expected);
      });

      it('should throw InputError for an invalid sync mode', () => {
        setActionInputs({ 'sync-mode': 'sideways' });

        expect(() => loadSynchronizeConfig()).toThrow(InputError);
        expect(() => loadSynchronizeConfig()).toThrow(
          /Must be one of: push, pull, mirror/,
        );
      });

      it('should throw when sync-mode is missing', () => {
        delete process.env['INPUT_SYNC-MODE'];

        expect(() => loadSynchronizeConfig()).toThrow(
          'Input required and not supplied: sync-mode',
        );
      });
    });

    describe('syncMethod', () => {
      it('should default to sftp', () => {
        expect(loadSynchronizeConfig().syncMethod).toBe('sftp');
      });

      it('should accept rsync', () => {
        setActionInputs({ 'sync-method': 'rsync' });

        expect(loadSynchronizeConfig().syncMethod).toBe('rsync');
      });

      it('should throw InputError for an invalid sync method', () => {
        setActionInputs({ 'sync-method': 'ftp' });

        expect(() => loadSynchronizeConfig()).toThrow(InputError);
        expect(() => loadSynchronizeConfig()).toThrow(
          /Must be 'sftp' or 'rsync'/,
        );
      });
    });

    // `action.yml` cannot express the two-option `pickList` that constrains
    // this input in the Azure extension's `task.json`, and core's runner treats
    // it as `'https' | 'ssh'`, branching `=== 'https' ? HTTPS : SSH`. Without
    // this validation a typo runs the SSH path silently against an
    // HTTPS-configured job.
    describe('connectionType', () => {
      it('should accept an unset input (action.yml defaults it to ssh)', () => {
        expect(() => loadSynchronizeConfig()).not.toThrow();
      });

      it.each([['https'], ['ssh']])('should accept %s', (connectionType) => {
        setActionInputs({ 'connection-type': connectionType });

        expect(() => loadSynchronizeConfig()).not.toThrow();
      });

      it('should throw InputError naming the valid values for a typo', () => {
        setActionInputs({ 'connection-type': 'htpps' });

        expect(() => loadSynchronizeConfig()).toThrow(InputError);
        expect(() => loadSynchronizeConfig()).toThrow(
          /Invalid connection type: 'htpps'\. Must be 'https' or 'ssh'/,
        );
      });

      it('should name the connectionType input on the thrown error', () => {
        setActionInputs({ 'connection-type': 'HTTPS' });

        expect(() => loadSynchronizeConfig()).toThrow(
          expect.objectContaining({ inputName: 'connectionType' }),
        );
      });

      // Core's runner calls SSH-only APIs in both branches
      it('should require the ssh credentials even for an https connection', () => {
        setActionInputs({ 'connection-type': 'https' });
        delete process.env['INPUT_SSH-PASSWORD'];

        expect(() => loadSynchronizeConfig()).toThrow(
          'Input required and not supplied: ssh-password',
        );
      });
    });

    describe('sftpConcurrency', () => {
      it('should default to 4', () => {
        expect(loadSynchronizeConfig().sftpConcurrency).toBe(4);
      });

      it('should read the sftp-concurrency input', () => {
        setActionInputs({ 'sftp-concurrency': '8' });

        expect(loadSynchronizeConfig().sftpConcurrency).toBe(8);
      });

      it.each([['0'], ['21'], ['abc']])(
        'should throw InputError for a concurrency of %s',
        (value) => {
          setActionInputs({ 'sftp-concurrency': value });

          expect(() => loadSynchronizeConfig()).toThrow(InputError);
        },
      );
    });

    describe('symitarAppPort', () => {
      it('should parse the symitar-app-port input', () => {
        setActionInputs({ 'symitar-app-port': '42627' });

        expect(loadSynchronizeConfig().symitarAppPort).toBe(42627);
      });

      it('should be undefined when not provided', () => {
        expect(loadSynchronizeConfig().symitarAppPort).toBeUndefined();
      });

      it('should throw InputError for an out-of-range port', () => {
        setActionInputs({ 'symitar-app-port': '99999' });

        expect(() => loadSynchronizeConfig()).toThrow(InputError);
      });
    });

    describe('commit inputs', () => {
      it('should read commit-pulled-changes on a pull', () => {
        setActionInputs({
          'sync-mode': 'pull',
          'commit-pulled-changes': 'true',
        });

        expect(loadSynchronizeConfig().commitPulledChanges).toBe(true);
      });

      it.each([['push'], ['mirror']])(
        'should throw InputError when commit-pulled-changes is used with %s',
        (syncMode) => {
          setActionInputs({
            'sync-mode': syncMode,
            'commit-pulled-changes': 'true',
          });

          expect(() => loadSynchronizeConfig()).toThrow(InputError);
          expect(() => loadSynchronizeConfig()).toThrow(
            /can only be used when syncMode is pull/,
          );
        },
      );

      it('should read the commit message, branch and git identity inputs', () => {
        setActionInputs({
          'commit-message': 'chore: custom',
          'commit-branch': 'sync/main',
          'git-user-name': 'someone',
          'git-user-email': 'someone@example.com',
        });

        const config = loadSynchronizeConfig();

        expect(config.commitMessage).toBe('chore: custom');
        expect(config.commitBranch).toBe('sync/main');
        expect(config.gitUserName).toBe('someone');
        expect(config.gitUserEmail).toBe('someone@example.com');
      });

      it('should default commitBranch to the checked-out branch', () => {
        expect(loadSynchronizeConfig().commitBranch).toBe('feature/test');
      });

      it('should fall back to the build branch name when GITHUB_REF_NAME is unset', () => {
        delete process.env.GITHUB_REF_NAME;

        expect(loadSynchronizeConfig().commitBranch).toBe('feature/test');
      });

      it('should leave commitBranch undefined when no branch is resolvable', () => {
        delete process.env.GITHUB_REF_NAME;
        delete process.env.GITHUB_REF;

        expect(loadSynchronizeConfig().commitBranch).toBeUndefined();
      });
    });

    // Core's `commitPulledChanges` runs `git push origin HEAD:<commitBranch>`
    // without ever comparing HEAD to commitBranch - on Azure the two cannot
    // diverge. On GitHub `actions/checkout` takes an arbitrary `ref`, so a
    // workflow that checks out `develop` and sets `commit-branch: main` would
    // silently move `main` to `develop`'s tree. The pre-v2 `git.ts` guarded
    // this and the README still documents the requirement.
    describe('commit-branch / checkout guard', () => {
      const liveCommitInputs = {
        'sync-mode': 'pull',
        'commit-pulled-changes': 'true',
        'dry-run': 'false',
      };

      const execFileSyncMock = childProcess.execFileSync as jest.Mock;

      const withHeadBranch = (branch: string): jest.Mock => {
        execFileSyncMock.mockReturnValue(`${branch}\n`);
        return execFileSyncMock;
      };

      it('should accept a checkout that matches commit-branch', () => {
        const execFileSync = withHeadBranch('main');
        setActionInputs({ ...liveCommitInputs, 'commit-branch': 'main' });

        expect(() => loadSynchronizeConfig()).not.toThrow();
        expect(execFileSync).toHaveBeenCalledWith(
          'git',
          ['rev-parse', '--abbrev-ref', 'HEAD'],
          { cwd: WORKSPACE, encoding: 'utf8' },
        );
      });

      it('should throw InputError when the checkout is a different branch', () => {
        withHeadBranch('develop');
        setActionInputs({ ...liveCommitInputs, 'commit-branch': 'main' });

        expect(() => loadSynchronizeConfig()).toThrow(InputError);
        expect(() => loadSynchronizeConfig()).toThrow(
          /commit-branch is "main" but the checked-out branch is "develop"/,
        );
      });

      it('should throw InputError on a detached HEAD', () => {
        withHeadBranch('HEAD');
        setActionInputs({ ...liveCommitInputs, 'commit-branch': 'main' });

        expect(() => loadSynchronizeConfig()).toThrow(/detached HEAD/);
      });

      it('should not run git on a dry run', () => {
        const execFileSync = withHeadBranch('develop');
        setActionInputs({
          ...liveCommitInputs,
          'dry-run': 'true',
          'commit-branch': 'main',
        });

        expect(() => loadSynchronizeConfig()).not.toThrow();
        expect(execFileSync).not.toHaveBeenCalled();
      });

      it('should not run git when commit-pulled-changes is off', () => {
        const execFileSync = withHeadBranch('develop');
        setActionInputs({ 'commit-branch': 'main' });

        expect(() => loadSynchronizeConfig()).not.toThrow();
        expect(execFileSync).not.toHaveBeenCalled();
      });

      // create-pull-request checks out pullRequestBranch itself with
      // `git checkout -B`, so HEAD is correct by construction.
      it('should not run git for a create-pull-request run', () => {
        const execFileSync = withHeadBranch('develop');
        setActionInputs({
          'sync-mode': 'pull',
          'dry-run': 'false',
          'create-pull-request': 'true',
          'github-token': 'ghp-test-token',
          'commit-branch': 'main',
        });

        expect(() => loadSynchronizeConfig()).not.toThrow();
        expect(execFileSync).not.toHaveBeenCalled();
      });
    });

    describe('pull request inputs', () => {
      it('should default the pull request fields', () => {
        const config = loadSynchronizeConfig();

        expect(config.createPullRequest).toBe(false);
        expect(config.pullRequestBranch).toBe('chore/symitar-pull');
        expect(config.pullRequestTargetBranch).toBe('feature/test');
        expect(config.pullRequestTitle).toBe(
          'chore: sync server-managed Symitar files',
        );
        expect(config.pullRequestDescription).toBe(
          'Auto-generated pull of server-managed Symitar files.',
        );
      });

      it('should read the pull request inputs', () => {
        setActionInputs({
          'pull-request-branch': 'chore/pulled',
          'pull-request-target-branch': 'main',
          'pull-request-title': 'chore: pulled',
          // The GitHub-native spelling of pipelines' pullRequestDescription
          'pull-request-body': 'Pulled by the action.',
        });

        const config = loadSynchronizeConfig();

        expect(config.pullRequestBranch).toBe('chore/pulled');
        expect(config.pullRequestTargetBranch).toBe('main');
        expect(config.pullRequestTitle).toBe('chore: pulled');
        expect(config.pullRequestDescription).toBe('Pulled by the action.');
      });

      it('should ignore a pull-request-description input', () => {
        setActionInputs({ 'pull-request-description': 'wrong name' });

        expect(loadSynchronizeConfig().pullRequestDescription).toBe(
          'Auto-generated pull of server-managed Symitar files.',
        );
      });

      it('should throw InputError when both commit and pull request are enabled', () => {
        setActionInputs({
          'sync-mode': 'pull',
          'commit-pulled-changes': 'true',
          'create-pull-request': 'true',
        });

        expect(() => loadSynchronizeConfig()).toThrow(/cannot both be enabled/);
      });

      it('should read create-pull-request on a pull', () => {
        setActionInputs({
          'sync-mode': 'pull',
          'create-pull-request': 'true',
          'github-token': 'ghp-test-token',
        });

        expect(loadSynchronizeConfig().createPullRequest).toBe(true);
      });

      it.each([['push'], ['mirror']])(
        'should throw InputError when create-pull-request is used with %s',
        (syncMode) => {
          setActionInputs({
            'sync-mode': syncMode,
            'create-pull-request': 'true',
            'github-token': 'ghp-test-token',
          });

          expect(() => loadSynchronizeConfig()).toThrow(InputError);
          expect(() => loadSynchronizeConfig()).toThrow(
            /can only be used when syncMode is pull/,
          );
        },
      );
    });

    // Core throws `InputError` when `createPullRequest` is on but no
    // `PullRequestPublisher` is supplied; the publisher is always supplied
    // here, so the failure that has to be made loud instead is a publisher
    // that has no usable credential. Refusing at load time means it happens
    // before the API key check and before Symitar is contacted at all - not
    // after a pull has already rewritten the workspace.
    describe('githubToken', () => {
      const pullRequestInputs = {
        'sync-mode': 'pull',
        'create-pull-request': 'true',
      };

      it('should read the github-token input', () => {
        setActionInputs({ ...pullRequestInputs, 'github-token': ' ghp-abc ' });

        expect(loadSynchronizeConfig().githubToken).toBe('ghp-abc');
      });

      it('should be undefined when the input is unset', () => {
        expect(loadSynchronizeConfig().githubToken).toBeUndefined();
      });

      it('should throw InputError when create-pull-request has no token', () => {
        setActionInputs(pullRequestInputs);

        expect(() => loadSynchronizeConfig()).toThrow(InputError);
        expect(() => loadSynchronizeConfig()).toThrow(
          /'github-token' input is required/,
        );
      });

      it('should throw InputError for a whitespace-only token', () => {
        setActionInputs({ ...pullRequestInputs, 'github-token': '   ' });

        expect(() => loadSynchronizeConfig()).toThrow(InputError);
      });

      // The runner does not export GITHUB_TOKEN into an action's environment,
      // so a fallback would only ever resolve to undefined and turn a loud
      // failure into a confusing one.
      it('should not fall back to the GITHUB_TOKEN environment variable', () => {
        process.env.GITHUB_TOKEN = 'ghp-from-env';
        setActionInputs(pullRequestInputs);

        expect(() => loadSynchronizeConfig()).toThrow(InputError);

        delete process.env.GITHUB_TOKEN;
      });

      it('should not require a token when create-pull-request is off', () => {
        expect(() => loadSynchronizeConfig()).not.toThrow();
      });
    });

    describe('branch refs', () => {
      it('should take buildBranch from GITHUB_REF unchanged', () => {
        process.env.GITHUB_REF = 'refs/heads/release/1.0';

        const config = loadSynchronizeConfig();

        expect(config.buildBranch).toBe('refs/heads/release/1.0');
        expect(config.buildBranchName).toBe('release/1.0');
      });

      it('should leave buildBranch empty when GITHUB_REF is unset', () => {
        delete process.env.GITHUB_REF;

        const config = loadSynchronizeConfig();

        expect(config.buildBranch).toBe('');
        expect(config.buildBranchName).toBe('');
      });
    });
  });

  describe('createSSHClient', () => {
    it('should construct a SymitarSSH client from the config', async () => {
      const config = loadSynchronizeConfig();

      await createSSHClient(config);

      expect(symitarSSHMock).toHaveBeenCalledTimes(1);
      expect(symitarSSHMock).toHaveBeenCalledWith(
        {
          host: 'symitar.example.com',
          port: 22,
          username: 'testuser',
          password: 'testpass',
        },
        'info',
      );
    });

    it('should use the debug log level when debug is enabled', async () => {
      setActionInputs({ debug: 'true' });

      await createSSHClient(loadSynchronizeConfig());

      expect(symitarSSHMock).toHaveBeenCalledWith(expect.anything(), 'debug');
    });
  });

  describe('createHTTPsClient', () => {
    const loadHTTPsConfig = (): SynchronizeActionConfig => {
      setActionInputs({
        'connection-type': 'https',
        'symitar-app-port': '42627',
      });
      return loadSynchronizeConfig();
    };

    it('should throw InputError when symitarAppPort is missing', () => {
      const config = loadSynchronizeConfig();

      expect(() => createHTTPsClient(config)).toThrow(InputError);
      expect(() => createHTTPsClient(config)).toThrow(
        'symitarAppPort is required when using HTTPS connection',
      );
    });

    // Core's runner always builds the SSH client first and hands it to the
    // HTTPS client, because it goes on to call SSH-only APIs
    // (getFileModificationTime, createInstallWorker, createUninstallWorker) on
    // that same instance.
    it('should attach the SSH client the runner constructs', async () => {
      const config = loadHTTPsConfig();

      const sshClient = await createSSHClient(config);
      createHTTPsClient(config, sshClient);

      expect(symitarSSHMock).toHaveBeenCalledTimes(1);
      expect(symitarHTTPsMock).toHaveBeenCalledWith(
        'https://symitar.example.com:42627',
        {
          symNumber: 627,
          symitarUserNumber: '1234',
          symitarUserPassword: 'userpass',
        },
        'info',
        { port: 22, username: 'testuser', password: 'testpass' },
        { sshClient },
      );
    });

    it('should pass no sshClient option when none is supplied', () => {
      createHTTPsClient(loadHTTPsConfig());

      expect(symitarHTTPsMock).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Object),
        'info',
        expect.any(Object),
        undefined,
      );
    });

    it('should pass the debug log level through to the HTTPS client', () => {
      setActionInputs({ debug: 'true' });

      createHTTPsClient(loadHTTPsConfig());

      expect(symitarHTTPsMock).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Object),
        'debug',
        expect.any(Object),
        undefined,
      );
    });
  });

  describe('validateTaskApiKey', () => {
    it('should delegate to validateApiKey', async () => {
      await validateTaskApiKey('test-api-key', 'symitar.example.com');

      expect(validateApiKey).toHaveBeenCalledWith(
        'test-api-key',
        'symitar.example.com',
      );
    });
  });
});
