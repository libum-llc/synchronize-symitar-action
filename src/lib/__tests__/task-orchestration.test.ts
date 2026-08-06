import { SymitarHTTPs, SymitarSSH } from '@libum-llc/symitar';

import {
  createHTTPsClient,
  createSSHClient,
  getSyncTransport,
  loadSynchronizeConfig,
  validateTaskApiKey,
  DEFAULT_SYNC_COMPARE_MODE,
  type SyncMethod,
  type SynchronizeTaskConfig,
} from '../task-orchestration';
import { InputError, SymNumberError } from '../errors';
import { validateApiKey } from '../subscription';

// Mock dependencies
jest.mock('@libum-llc/symitar', () => ({
  SymitarHTTPs: jest.fn(),
  SymitarSSH: jest
    .fn()
    .mockImplementation(() => ({ isReady: Promise.resolve() })),
  SymitarSyncMode: { MIRROR: 'mirror', PUSH: 'push', PULL: 'pull' },
  SymitarSyncTransport: { SFTP: 'sftp', RSYNC: 'rsync' },
}));
jest.mock('../subscription', () => ({
  validateApiKey: jest.fn().mockResolvedValue(undefined),
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
      expect(config.azureDevOpsAccessToken).toBeUndefined();
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
      it('should resolve all artifact paths from GITHUB_WORKSPACE', () => {
        const config = loadSynchronizeConfig();

        expect(config.artifactPath).toBe(WORKSPACE);
        expect(config.artifactAbsolutePath).toBe(WORKSPACE);
        expect(config.repositoryPath).toBe(WORKSPACE);
      });

      it('should fall back to the process cwd when GITHUB_WORKSPACE is unset', () => {
        delete process.env.GITHUB_WORKSPACE;

        const config = loadSynchronizeConfig();

        expect(config.artifactAbsolutePath).toBe(process.cwd());
        expect(config.repositoryPath).toBe(process.cwd());
      });

      // The runner builds `${basePath}/${localDirectoryPath}`
      it('should strip a trailing separator from the workspace path', () => {
        process.env.GITHUB_WORKSPACE = `${WORKSPACE}/`;

        expect(loadSynchronizeConfig().artifactAbsolutePath).toBe(WORKSPACE);
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

      // Vendored code concatenates `${directory}${name}` with no separator, so
      // the trailing slash the Azure extension guarantees through its zod
      // config schema has to be restored on the input instead.
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

      // v2 breaking change: parsing is comma-only, matching pipelines
      it.each([
        ['install-poweron-list'],
        ['validate-ignore-list'],
        ['preserve-server-files'],
      ])('should NOT split a newline-delimited %s value', (inputName) => {
        setActionInputs({ [inputName]: 'ONE.PO\nTWO.PO' });

        const config = loadSynchronizeConfig();
        const parsed = {
          'install-poweron-list': config.repoConfig.installPowerOns,
          'validate-ignore-list': config.repoConfig.validateIgnorePowerOns,
          'preserve-server-files': config.preserveServerFiles,
        }[inputName];

        expect(parsed).toEqual(['ONE.PO\nTWO.PO']);
      });

      it('should NOT strip a leading "- " YAML list marker', () => {
        setActionInputs({ 'install-poweron-list': '- ONE.PO, - TWO.PO' });

        expect(loadSynchronizeConfig().repoConfig.installPowerOns).toEqual([
          '- ONE.PO',
          '- TWO.PO',
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
    // this input in the Azure extension's `task.json`, and the vendored runner
    // casts it straight to `'https' | 'ssh'` then branches
    // `if (=== 'https') ... else SSH`. Without this validation a typo runs the
    // SSH path silently against an HTTPS-configured job.
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

      // The runner calls SSH-only APIs in both branches
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

    // Pull request creation is wired separately; the config carries the
    // pipelines-shaped placeholders so the vendored runner compiles
    describe('pull request placeholders', () => {
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

  describe('DEFAULT_SYNC_COMPARE_MODE', () => {
    it('should be quick', () => {
      expect(DEFAULT_SYNC_COMPARE_MODE).toBe('quick');
    });
  });

  describe('getSyncTransport', () => {
    it('should map sftp to the SFTP transport', () => {
      expect(getSyncTransport('sftp')).toBe('sftp');
    });

    it('should map rsync to the RSYNC transport', () => {
      expect(getSyncTransport('rsync')).toBe('rsync');
    });

    it('should throw InputError for an unknown method', () => {
      expect(() => getSyncTransport('ftp' as SyncMethod)).toThrow(InputError);
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
    const loadHTTPsConfig = (): SynchronizeTaskConfig => {
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

    // The runner (SynchronizeDirectory/run.ts) always builds the SSH client
    // first and hands it to the HTTPS client, because it goes on to call
    // SSH-only APIs (getFileModificationTime, createInstallWorker,
    // createUninstallWorker) on that same instance.
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
