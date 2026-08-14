import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { getOctokit } from '@actions/github';

import { createSynchronizeDependencies } from './dependencies';
import {
  createHTTPsClient,
  createSSHClient,
  validateTaskApiKey,
} from '../lib/task-orchestration';

const mockList = jest.fn();
const mockCreate = jest.fn();

jest.mock('@actions/github', () => ({
  getOctokit: jest.fn(() => ({
    rest: { pulls: { list: mockList, create: mockCreate } },
  })),
  context: {
    get repo() {
      const [owner, repo] = (process.env.GITHUB_REPOSITORY || '/').split('/');
      return { owner, repo };
    },
  },
}));

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
    if (key.startsWith('INPUT_')) delete process.env[key];
  });
};

describe('createSynchronizeDependencies', () => {
  const originalEnv = { ...process.env };
  let scratch: string;
  let outputFile: string;
  let envFile: string;

  beforeEach(() => {
    jest.clearAllMocks();
    clearActionInputs();
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-deps-'));
    outputFile = path.join(scratch, 'github_output');
    envFile = path.join(scratch, 'github_env');
    fs.writeFileSync(outputFile, '');
    fs.writeFileSync(envFile, '');
    process.env.GITHUB_OUTPUT = outputFile;
    process.env.GITHUB_ENV = envFile;
    process.env.GITHUB_REF = 'refs/heads/main';
    process.env.GITHUB_REF_NAME = 'main';
    process.env.GITHUB_WORKSPACE = '/home/runner/work/repo/repo';
    process.env.GITHUB_REPOSITORY = 'libum-llc/customer-repo';
    setActionInputs(BASE_INPUTS);
    jest.spyOn(console, 'info').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
    process.env = { ...originalEnv };
    fs.rmSync(scratch, { recursive: true, force: true });
  });

  it('supplies every dependency core requires', () => {
    const dependencies = createSynchronizeDependencies();

    expect(dependencies.task).toBeDefined();
    expect(dependencies.loadConfig).toEqual(expect.any(Function));
    expect(dependencies.validateApiKey).toBe(validateTaskApiKey);
    expect(dependencies.createHttpsClient).toBe(createHTTPsClient);
    expect(dependencies.createSshClient).toBe(createSSHClient);
    expect(dependencies.pullRequestPublisher).toBeDefined();
  });

  // Loading eagerly is what lets the github-token reach the publisher without
  // ever appearing on a core-owned type, and it is what makes a bad input fail
  // before Symitar is contacted.
  it('loads the config once, before the runner starts', () => {
    setActionInputs({ 'sftp-concurrency': '8' });

    const dependencies = createSynchronizeDependencies();
    const first = dependencies.loadConfig();

    // Changing an input afterwards must not change what the runner sees.
    setActionInputs({ 'sftp-concurrency': '2' });

    expect(dependencies.loadConfig()).toBe(first);
    expect(first.sftpConcurrency).toBe(8);
  });

  it('fails at construction time when an input is invalid', () => {
    setActionInputs({ 'sync-mode': 'sideways' });

    expect(() => createSynchronizeDependencies()).toThrow(
      /Must be one of: push, pull, mirror/,
    );
  });

  // Core throws InputError when createPullRequest is on and no publisher was
  // supplied, so the publisher is passed unconditionally rather than only when
  // the input happens to be on.
  it('supplies a pull request publisher even when create-pull-request is off', async () => {
    const { pullRequestPublisher } = createSynchronizeDependencies();

    expect(pullRequestPublisher).toBeDefined();
    // Its credential is absent, so using it fails loudly rather than silently
    // opening a pull request with no token.
    await expect(
      pullRequestPublisher?.openOrReuse({
        head: 'refs/heads/chore/symitar-pull',
        base: 'refs/heads/main',
        title: 't',
        body: 'b',
      }),
    ).rejects.toThrow(/github-token/);
  });

  it('hands the github-token input to the publisher', async () => {
    setActionInputs({
      'sync-mode': 'pull',
      'create-pull-request': 'true',
      'github-token': 'ghp-wired-through',
    });
    mockList.mockResolvedValue({ data: [] });
    mockCreate.mockResolvedValue({
      data: { number: 5, html_url: 'https://example.com/5' },
    });

    const { pullRequestPublisher } = createSynchronizeDependencies();
    await pullRequestPublisher?.openOrReuse({
      head: 'refs/heads/chore/symitar-pull',
      base: 'refs/heads/main',
      title: 't',
      body: 'b',
    });

    expect(getOctokit).toHaveBeenCalledWith('ghp-wired-through');
  });

  // End-to-end through the wiring the runner actually uses: the real
  // `@actions/core` writes to a real `$GITHUB_OUTPUT`. A mocked toolkit could
  // not distinguish this from `exportVariable`, which would land in
  // `$GITHUB_ENV` and leave `steps.<id>.outputs.*` empty.
  it('publishes a real step output through the wired TaskHost', () => {
    createSynchronizeDependencies().task.setOutput('outliersCount', '3');

    expect(fs.readFileSync(outputFile, 'utf8')).toMatch(/^outliers-count<</m);
    expect(fs.readFileSync(outputFile, 'utf8')).toMatch(/^3$/m);
    expect(fs.readFileSync(envFile, 'utf8')).toBe('');
  });
});
