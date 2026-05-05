import * as core from '@actions/core';
import * as exec from '@actions/exec';

jest.mock('@actions/core');
jest.mock('@actions/exec');

import { commitPulledChanges } from '../src/git';

const mockedExec = exec.exec as jest.MockedFunction<typeof exec.exec>;
const mockedCore = core as jest.Mocked<typeof core>;

function baseConfig(overrides: Partial<Parameters<typeof commitPulledChanges>[0]> = {}) {
  return {
    enabled: true,
    isDryRun: false,
    syncMode: 'pull' as const,
    localDirectoryPath: 'REPWRITERSPECS/',
    commitMessage: 'chore: sync',
    commitBranch: 'main',
    gitUserName: 'libum-bot',
    gitUserEmail: 'bot@libum.io',
    logPrefix: '[Test]',
    ...overrides,
  };
}

describe('commitPulledChanges - commit-branch guard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.GITHUB_WORKSPACE = '/tmp/workspace';
  });

  function mockHeadBranch(name: string) {
    // First call is `git rev-parse --abbrev-ref HEAD` for the guard.
    mockedExec.mockImplementationOnce(async (_cmd, _args, options) => {
      options?.listeners?.stdout?.(Buffer.from(name + '\n'));
      return 0;
    });
  }

  it('throws when checked-out branch does not match commitBranch', async () => {
    mockHeadBranch('feature-x');

    await expect(commitPulledChanges(baseConfig())).rejects.toThrow(
      /commit-branch is "main" but the checked-out branch is "feature-x"/,
    );
    // Should bail before any state-changing git command runs.
    expect(mockedExec).toHaveBeenCalledTimes(1);
  });

  it('throws when workspace is in detached HEAD state', async () => {
    mockHeadBranch('HEAD');

    await expect(commitPulledChanges(baseConfig())).rejects.toThrow(
      /detached HEAD state/,
    );
    expect(mockedExec).toHaveBeenCalledTimes(1);
  });

  it('proceeds past the guard when checked-out branch matches commitBranch', async () => {
    mockHeadBranch('main');
    // After the guard, git config / add / diff calls follow. Stub them as no-ops.
    // diff --cached --quiet returns 0 → "no staged changes" → early-return.
    mockedExec.mockResolvedValue(0);

    await expect(commitPulledChanges(baseConfig())).resolves.toBeUndefined();

    // 1: rev-parse, 2: config user.name, 3: config user.email, 4: add, 5: diff --cached --quiet
    expect(mockedExec).toHaveBeenCalledTimes(5);
    expect(mockedCore.info).toHaveBeenCalledWith(
      expect.stringContaining('No pulled changes to commit'),
    );
  });

  it('skips the guard when commitBranch is not set', async () => {
    mockedExec.mockResolvedValue(0);

    await commitPulledChanges(baseConfig({ commitBranch: undefined }));

    // No rev-parse call — guard is skipped.
    expect(mockedExec).not.toHaveBeenCalledWith(
      'git',
      ['rev-parse', '--abbrev-ref', 'HEAD'],
      expect.anything(),
    );
  });

  it('skips the guard during dry run', async () => {
    await commitPulledChanges(baseConfig({ isDryRun: true }));

    expect(mockedExec).not.toHaveBeenCalled();
    expect(mockedCore.info).toHaveBeenCalledWith(
      expect.stringContaining('Dry run'),
    );
  });
});
