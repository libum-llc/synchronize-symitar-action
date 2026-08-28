import * as core from '@actions/core';

import {
  runSynchronizeDirectoryTask,
  AuthenticationError,
  ConfigError,
  ConnectionError,
  InputError,
  PowerOnError,
  SymNumberError,
  ValidationError,
} from '@libum-llc/pipelines-core';

import { run } from '../src/main';
import { createSynchronizeDependencies } from '../src/synchronize/dependencies';
import { version } from '../package.json';

jest.mock('@actions/core');

// Only the task runner is stubbed. The error classes are the real ones from
// `@libum-llc/pipelines-core`, because every assertion below turns on
// `main.ts`'s `instanceof` dispatch - replacing them with fakes would make the
// whole error-mapping suite vacuous.
jest.mock('@libum-llc/pipelines-core', () => ({
  ...jest.requireActual('@libum-llc/pipelines-core'),
  runSynchronizeDirectoryTask: jest.fn(),
}));

// `main.ts` must hand the runner the object this factory builds, not some
// other value. Mocking the module to a distinctive marker lets the
// "dependencies passed" assertion below catch a regression - a plain
// deep-equality check against a real dependencies object would not, and
// building a real one would need a full set of action inputs.
jest.mock('../src/synchronize/dependencies', () => {
  const dependencies = { __brand: 'synchronizeDependencies' };
  return {
    createSynchronizeDependencies: jest.fn(() => dependencies),
  };
});

const mockRunSynchronizeDirectoryTask =
  runSynchronizeDirectoryTask as jest.MockedFunction<
    typeof runSynchronizeDirectoryTask
  >;
const mockCreateDependencies =
  createSynchronizeDependencies as jest.MockedFunction<
    typeof createSynchronizeDependencies
  >;
const mockGetInput = core.getInput as jest.MockedFunction<typeof core.getInput>;
const mockSetSecret = core.setSecret as jest.MockedFunction<
  typeof core.setSecret
>;
const mockSetFailed = core.setFailed as jest.MockedFunction<
  typeof core.setFailed
>;
const mockInfo = core.info as jest.MockedFunction<typeof core.info>;
const mockError = core.error as jest.MockedFunction<typeof core.error>;
const mockDebug = core.debug as jest.MockedFunction<typeof core.debug>;
const mockWarning = core.warning as jest.MockedFunction<typeof core.warning>;
const mockNotice = core.notice as jest.MockedFunction<typeof core.notice>;

/**
 * Every `@actions/core` channel that puts text in front of a human.
 *
 * `setFailed` matters most and is the easiest to forget: it is the single most
 * prominent piece of text in the job UI, and `main.ts` interpolates error
 * content into it on every branch. A leak assertion that only inspects
 * `info` + `error` would pass while the key sat in the failure annotation.
 * `debug` is included because GitHub archives step-debug logs the same way it
 * archives everything else - a secret written there is still a secret written
 * to a public repository's logs.
 */
const LOG_CHANNELS = [
  mockInfo,
  mockError,
  mockSetFailed,
  mockDebug,
  mockWarning,
  mockNotice,
];

/** Everything `main.ts` handed to any of those channels, as one blob. */
const allLoggedText = (): string =>
  LOG_CHANNELS.flatMap((channel) => channel.mock.calls.flat())
    .map((argument) =>
      argument instanceof Error ? argument.stack || argument.message : argument,
    )
    .join('\n');

const INPUT_VALUES: Record<string, string> = {
  'api-key': 'test-api-key-1234567890',
  'symitar-user-password': 'test-symitar-user-password',
  'ssh-password': 'test-ssh-password',
  'github-token': 'ghp-test-token-abcdef',
};

const SUCCESS = 'Successfully synchronized PowerOns for Sym 627';

describe('main', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetInput.mockImplementation((name: string) => INPUT_VALUES[name] ?? '');
  });

  describe('secret masking', () => {
    it('masks every credential input before any logging', async () => {
      mockRunSynchronizeDirectoryTask.mockResolvedValue(SUCCESS);

      await run();

      expect(mockSetSecret).toHaveBeenCalledWith(INPUT_VALUES['api-key']);
      expect(mockSetSecret).toHaveBeenCalledWith(
        INPUT_VALUES['symitar-user-password'],
      );
      expect(mockSetSecret).toHaveBeenCalledWith(INPUT_VALUES['ssh-password']);
      expect(mockSetSecret).toHaveBeenCalledWith(INPUT_VALUES['github-token']);
      expect(mockSetSecret).toHaveBeenCalledTimes(4);

      // Every setSecret call must precede every call to *any* log channel -
      // not just info/error - using jest's global invocation-order counter.
      const lastSetSecretOrder = Math.max(
        ...mockSetSecret.mock.invocationCallOrder,
      );
      const logOrders = LOG_CHANNELS.flatMap(
        (channel) => channel.mock.invocationCallOrder,
      );
      expect(logOrders.every((order) => order > lastSetSecretOrder)).toBe(true);
    });

    it('logs the startup banner with the package version', async () => {
      mockRunSynchronizeDirectoryTask.mockResolvedValue(SUCCESS);

      await run();

      expect(mockInfo).toHaveBeenCalledWith(
        expect.stringContaining(`v${version}`),
      );
    });

    it('does not register an empty mask for an absent secret input', async () => {
      mockGetInput.mockImplementation((name: string) =>
        name === 'github-token' ? '' : (INPUT_VALUES[name] ?? ''),
      );
      mockRunSynchronizeDirectoryTask.mockResolvedValue(SUCCESS);

      await run();

      expect(mockSetSecret).not.toHaveBeenCalledWith('');
      expect(mockSetSecret).toHaveBeenCalledTimes(3);
    });
  });

  describe('dependencies wiring', () => {
    it('passes the constructed dependencies to runSynchronizeDirectoryTask', async () => {
      mockRunSynchronizeDirectoryTask.mockResolvedValue(SUCCESS);

      await run();

      expect(mockRunSynchronizeDirectoryTask).toHaveBeenCalledTimes(1);
      expect(mockRunSynchronizeDirectoryTask.mock.calls[0][0]).toBe(
        mockCreateDependencies.mock.results[0].value,
      );
    });

    // Config loading happens inside the factory, so an input error surfaces
    // through the same handler as a runner failure rather than escaping `run`.
    it('maps a failure thrown while building dependencies onto setFailed', async () => {
      mockCreateDependencies.mockImplementationOnce(() => {
        throw new InputError("Invalid sync mode: 'sideways'", 'syncMode');
      });

      await expect(run()).resolves.toBeUndefined();

      expect(mockSetFailed).toHaveBeenCalledWith(
        "Invalid sync mode: 'sideways'",
      );
      expect(mockRunSynchronizeDirectoryTask).not.toHaveBeenCalled();
    });
  });

  describe('success path', () => {
    it('does not call setFailed and logs the result message', async () => {
      mockRunSynchronizeDirectoryTask.mockResolvedValue(SUCCESS);

      await run();

      expect(mockSetFailed).not.toHaveBeenCalled();
      expect(mockInfo).toHaveBeenCalledWith(expect.stringContaining(SUCCESS));
    });
  });

  describe('error mapping', () => {
    it('maps AuthenticationError to a masked, host-qualified failure', async () => {
      const error = new AuthenticationError(
        'No active subscription found',
        'sk-abcdefghijklmnop',
        'symitar.example.com',
      );
      mockRunSynchronizeDirectoryTask.mockRejectedValue(error);

      await run();

      expect(mockSetFailed).toHaveBeenCalledWith(
        'API key validation failed: No active subscription found',
      );
      expect(mockError).toHaveBeenCalledWith(
        expect.stringContaining('symitar.example.com'),
      );
      expect(allLoggedText()).not.toContain('sk-abcdefghijklmnop');
    });

    it('never logs any portion of the API key on any channel, including the pre-truncated prefix', async () => {
      // Regression test: `AuthenticationError.apiKeyPrefix` is the first 8
      // characters of the raw key plus '...'. `core.setSecret()` only masks
      // the *full* secret string, so logging `apiKeyPrefix` directly leaks
      // real key material into a public repository's logs.
      const apiKey = 'sk-abcdefghijklmnop';
      const error = new AuthenticationError(
        'No active subscription found',
        apiKey,
        'symitar.example.com',
      );
      // Sanity-check the fixture actually exercises the leak this test guards
      // against - if core's class ever stops truncating, this fails loudly.
      expect(error.apiKeyPrefix).toBe('sk-abcde...');

      mockRunSynchronizeDirectoryTask.mockRejectedValue(error);

      await run();

      const logged = allLoggedText();

      // Guard against a vacuous pass: main.ts must actually have logged
      // something on the channels being searched.
      expect(logged).toContain('No active subscription found');

      expect(logged).not.toContain(apiKey);
      expect(logged).not.toContain(error.apiKeyPrefix);
      // The prefix without its trailing '...' is the actual leaked material.
      expect(logged).not.toContain(error.apiKeyPrefix!.replace(/\.\.\.$/, ''));
    });

    it('maps ConnectionError to a host:port-qualified failure', async () => {
      const error = new ConnectionError(
        'Connection timeout after retries',
        'license.libum.io',
        443,
        true,
        new Error('ECONNREFUSED'),
      );
      mockRunSynchronizeDirectoryTask.mockRejectedValue(error);

      await run();

      expect(mockSetFailed).toHaveBeenCalledWith(
        'Failed to connect to license server: Connection timeout after retries',
      );
      expect(mockError).toHaveBeenCalledWith(
        expect.stringContaining('license.libum.io:443'),
      );
      expect(mockError).toHaveBeenCalledWith(
        expect.stringContaining('ECONNREFUSED'),
      );
    });

    it('maps InputError to a setFailed using the error message', async () => {
      const error = new InputError(
        "The 'github-token' input is required when 'create-pull-request' is enabled",
        'githubToken',
      );
      mockRunSynchronizeDirectoryTask.mockRejectedValue(error);

      await run();

      expect(mockSetFailed).toHaveBeenCalledWith(error.message);
      expect(mockError).toHaveBeenCalledWith(
        expect.stringContaining('githubToken'),
      );
    });

    it('maps SymNumberError to a setFailed using the error message', async () => {
      const error = new SymNumberError(
        'No valid symNumber found for build branch (main)',
        'main',
      );
      mockRunSynchronizeDirectoryTask.mockRejectedValue(error);

      await run();

      expect(mockSetFailed).toHaveBeenCalledWith(error.message);
      expect(mockError).toHaveBeenCalledWith(expect.stringContaining('main'));
    });

    it('maps ValidationError to per-file error annotations and a plain setFailed message', async () => {
      const error = new ValidationError('Found 2 invalid PowerOns', [
        { name: 'FILE1.PO', errors: 'Line 1: Syntax error' },
        { name: 'FILE2.PO', errors: 'Missing variable' },
      ]);
      mockRunSynchronizeDirectoryTask.mockRejectedValue(error);

      await run();

      expect(mockSetFailed).toHaveBeenCalledWith('Found 2 invalid PowerOns');
      const allErrorLines = mockError.mock.calls.flat().join('\n');
      expect(allErrorLines).toContain('FILE1.PO');
      expect(allErrorLines).toContain('Line 1: Syntax error');
      expect(allErrorLines).toContain('FILE2.PO');
      expect(allErrorLines).toContain('Missing variable');
      // Must not use Azure Pipelines' ##[error] log command formatting.
      expect(allErrorLines).not.toContain('##[error]');
    });

    it('maps ConfigError to a setFailed carrying its context', async () => {
      const error = new ConfigError('Config failed to load', {
        localDirectoryPath: '../escape',
      });
      mockRunSynchronizeDirectoryTask.mockRejectedValue(error);

      await run();

      expect(mockSetFailed).toHaveBeenCalledWith('Config failed to load');
      expect(mockError.mock.calls.flat().join('\n')).toContain('../escape');
    });

    it('maps a bare PowerOnError to setFailed using the error message', async () => {
      const error = new PowerOnError('Rollback operations failed');
      mockRunSynchronizeDirectoryTask.mockRejectedValue(error);

      await run();

      expect(mockSetFailed).toHaveBeenCalledWith('Rollback operations failed');
    });

    it('maps a plain Error to setFailed using the error message', async () => {
      mockRunSynchronizeDirectoryTask.mockRejectedValue(
        new Error('Unexpected failure'),
      );

      await run();

      expect(mockSetFailed).toHaveBeenCalledWith('Unexpected failure');
    });

    it('maps a non-Error throw to setFailed using its string representation', async () => {
      mockRunSynchronizeDirectoryTask.mockRejectedValue('a raw string failure');

      await run();

      expect(mockSetFailed).toHaveBeenCalledWith('a raw string failure');
    });
  });
});

describe('failure reporting cannot fail silently', () => {
  // Reachable, not theoretical: PowerOnError.context is a
  // Record<string, unknown> populated by callers, and handleError's
  // `JSON.stringify(error.context)` runs *before* its core.setFailed - on the
  // ConfigError branch as well as the PowerOnError one. A circular context
  // therefore threw out of the reporting path with the exit code still unset,
  // and a genuine synchronization failure reported as a pass.
  const circularContext = (): Record<string, unknown> => {
    const context: Record<string, unknown> = { directory: 'HELPFILES' };
    context.self = context;
    return context;
  };

  let originalExitCode: typeof process.exitCode;

  beforeEach(() => {
    originalExitCode = process.exitCode;
    process.exitCode = undefined;
  });

  afterEach(() => {
    process.exitCode = originalExitCode;
  });

  it.each([
    ['ConfigError', () => new ConfigError('Bad config', circularContext())],
    ['PowerOnError', () => new PowerOnError('Sync failed', circularContext())],
  ])('does not reject when handleError throws on a %s', async (_name, make) => {
    mockRunSynchronizeDirectoryTask.mockRejectedValue(make());

    await expect(run()).resolves.toBeUndefined();
  });

  it('records the failure when handleError itself throws', async () => {
    mockRunSynchronizeDirectoryTask.mockRejectedValue(
      new PowerOnError('Sync failed', circularContext()),
    );

    await run();

    expect(process.exitCode).toBe(1);
    expect(mockSetFailed).toHaveBeenCalledWith(
      expect.stringContaining('Failed while reporting an error'),
    );
    // The original failure must survive into the message, not be swallowed by
    // the reporting failure that replaced it.
    expect(mockSetFailed).toHaveBeenCalledWith(
      expect.stringContaining('Sync failed'),
    );
  });
});

describe('resolveExitCode', () => {
  // Guards the fix for a live-observed hang: the action logged success and
  // then sat on the runner for 14 minutes until the job timeout killed it,
  // because a lingering Symitar client handle kept Node's event loop alive.
  // The entry point now force-exits, and must carry core.setFailed's exit
  // code through rather than always reporting success.
  it('defaults to 0 when nothing set an exit code', () => {
    const { resolveExitCode } = require('../src/main');
    expect(resolveExitCode(undefined)).toBe(0);
  });

  it('preserves a failure code set by core.setFailed', () => {
    const { resolveExitCode } = require('../src/main');
    expect(resolveExitCode(1)).toBe(1);
  });

  it('treats a non-numeric exit code as success', () => {
    const { resolveExitCode } = require('../src/main');
    expect(resolveExitCode('oops' as unknown as number)).toBe(0);
  });
});
