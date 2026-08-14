import { execFileSync } from 'child_process';
import { tmpdir } from 'os';

import { SymitarHTTPs, SymitarSSH, SymitarSyncMode } from '@libum-llc/symitar';

import {
  DEFAULT_POWERON_DIRECTORY,
  DEFAULT_SSH_PORT,
  InputError,
  SymNumberError,
  validateApiKey,
  type CommonTaskConfig,
  type RepoConfig,
  type SyncMethod,
  type SynchronizeDirectoryConfig,
} from '@libum-llc/pipelines-core';

import { getBoolInput, getInput, isValidNumber } from './utils';

// Validation patterns
const HOSTNAME_PATTERN = /^[a-zA-Z0-9.-]+$/;
const MIN_PORT = 1;
const MAX_PORT = 65535;

// The pipelines directory defaults, which the Azure DevOps extension reads
// from `.poweron-pipelines/config.yml`
const DEFAULT_DIRECTORY_PATHS: RepoConfig['inputs'] = {
  powerOnsDirectory: DEFAULT_POWERON_DIRECTORY,
  letterFilesDirectory: 'LETTERSPECS/',
  dataFilesDirectory: 'DATAFILES/',
  helpFilesDirectory: 'HELPFILES/',
};

// Which `RepoConfig.inputs` field the `local-directory-path` input overrides,
// keyed by the `directory-type` input
const DIRECTORY_TYPE_CONFIG_KEYS: Record<string, keyof RepoConfig['inputs']> = {
  powerOns: 'powerOnsDirectory',
  letterFiles: 'letterFilesDirectory',
  dataFiles: 'dataFilesDirectory',
  helpFiles: 'helpFilesDirectory',
};

/**
 * This action's configuration: core's `SynchronizeDirectoryConfig` plus the
 * one credential core has no field for.
 *
 * `PullRequestPublisher` is deliberately outside core's config surface —
 * opening a pull request is provider-specific, so the token belongs to the
 * consumer. The Azure extension carries `azureDevOpsAccessToken` on its own
 * extension of the same shape for exactly this reason.
 */
export interface SynchronizeActionConfig extends SynchronizeDirectoryConfig {
  /** The `github-token` input, used only by the Octokit publisher. */
  githubToken?: string;
}

/**
 * Validates a hostname format
 */
function validateHostname(hostname: string, inputName: string): void {
  if (!HOSTNAME_PATTERN.test(hostname)) {
    throw new InputError(
      `Invalid hostname format: ${hostname}. Must contain only alphanumeric characters, dots, and hyphens.`,
      inputName,
      { value: hostname },
    );
  }
}

/**
 * Validates a port number is within valid range
 */
function validatePort(port: number, inputName: string): void {
  if (isNaN(port) || port < MIN_PORT || port > MAX_PORT) {
    throw new InputError(
      `Invalid port: ${port}. Must be between ${MIN_PORT}-${MAX_PORT}.`,
      inputName,
      { value: port },
    );
  }
}

/**
 * Normalizes a directory input to the canonical form core expects: forward
 * slashes and exactly one trailing slash.
 *
 * The Azure DevOps extension enforces this with a zod `directoryPathSchema`
 * ("must end with a forward slash") when it parses
 * `.poweron-pipelines/config.yml`. That schema stayed with the extension —
 * core's `RepoConfig.inputs` fields are plain `string`s and core validates
 * nothing about their shape, because loading config is a host concern. A
 * GitHub Action is configured through `action.yml` inputs and has no schema, so
 * the guarantee is restored here instead.
 *
 * @param value The raw directory input
 */
function toDirectoryPath(value: string): string {
  const normalized = value.trim().replace(/\\/g, '/').replace(/\/+$/, '');

  return normalized ? `${normalized}/` : '';
}

/**
 * Resolves the checked-out workspace root.
 *
 * `sourcePath`, `sourceAbsolutePath` and `workspacePath` are Azure
 * artifact-staging concepts: the Azure extension synchronizes a published
 * build artifact that was downloaded next to, but separately from, the source
 * checkout. A GitHub Action has no such split - `actions/checkout` puts the
 * repository in `GITHUB_WORKSPACE` and that *is* the thing being synchronized -
 * so all three resolve to the workspace root here.
 */
function resolveWorkspacePath(): string {
  const workspace = process.env.GITHUB_WORKSPACE || process.cwd();
  // Core builds `${basePath}/${localDirectoryPath}`, so a trailing separator
  // here would produce a doubled slash.
  const trimmed = workspace.replace(/[\\/]+$/, '');

  return trimmed || workspace;
}

/**
 * Parses a list-shaped action input.
 *
 * Deliberately more permissive than the Azure extension's equivalent, which
 * only splits on commas because it reads these lists out of a YAML config file
 * that has already been parsed into arrays. `action.yml` inputs are always
 * plain strings, so `install-poweron-list`, `validate-ignore-list` and
 * `preserve-server-files` have accepted a comma-delimited string, a
 * newline-delimited block, or a `- ` prefixed YAML block sequence since v1 -
 * and the README documents all three forms in four separate examples.
 *
 * Narrowing this to comma-only would silently turn
 * `preserve-server-files: |\n  - RD.*\n  - PFR.*` into the single pattern
 * `- RD.*\n- PFR.*`, which matches nothing: every preserved server file would
 * quietly stop being preserved and start being overwritten on the next push.
 * Input parsing is a host concern - core neither performs nor constrains it -
 * so the v1 behaviour stays here.
 *
 * @param value The raw list input
 */
function parseListInput(value: string): string[] {
  return value
    .split(/[,\n]/)
    .map((item) => item.trim().replace(/^-\s*/, ''))
    .filter((item) => item.length > 0);
}

/**
 * Builds the repository configuration from action inputs.
 *
 * The Azure DevOps extension reads this from `.poweron-pipelines/config.yml`;
 * a GitHub Action is configured entirely through `action.yml` inputs, so the
 * same shape is assembled from those instead. Only the directory belonging to
 * the selected `directory-type` is overridable, through `local-directory-path`.
 */
function buildRepoConfigFromInputs(): RepoConfig {
  const inputs: RepoConfig['inputs'] = { ...DEFAULT_DIRECTORY_PATHS };
  const localDirectoryPath = toDirectoryPath(
    getInput('localDirectoryPath', false),
  );
  const configKey =
    DIRECTORY_TYPE_CONFIG_KEYS[getInput('directoryType', false)];

  if (localDirectoryPath && configKey) {
    inputs[configKey] = localDirectoryPath;
  }

  return {
    inputs,
    branchSymNumbers: {},
    installPowerOns: parseListInput(getInput('installPowerOns', false)),
    validateIgnorePowerOns: parseListInput(
      getInput('validateIgnorePowerOns', false),
    ),
    preserveServerFiles: parseListInput(getInput('preserveServerFiles', false)),
  };
}

/**
 * Loads common configuration used by all tasks
 */
function loadCommonConfig(): CommonTaskConfig {
  const logPrefix = '[Main]';

  // Build repository configuration from action inputs
  const repoConfig: RepoConfig = buildRepoConfigFromInputs();

  // Get branch information
  const buildBranch: string = process.env.GITHUB_REF || '';
  const buildBranchName: string = buildBranch.replace(/^refs\/heads\//, '');

  // Get task inputs
  const apiKey: string = getInput('apiKey', true).trim();
  const powerOnsDirectory: string = repoConfig.inputs.powerOnsDirectory;

  // Log the loaded configuration
  console.info(
    `${logPrefix} Loaded repository configuration:\n${JSON.stringify(
      repoConfig,
      null,
      2,
    )
      .split('\n')
      .map((line) => `${logPrefix} ${line}`)
      .join('\n')}`,
  );

  // Get Symitar connection inputs. SSH credentials are required for every
  // connection type: the HTTPS client delegates file transfer and change
  // detection to SSH, and core's runner reaches for SSH-only worker APIs
  // (install/uninstall workers, remote mtimes) in both branches.
  const symitarHostname: string = getInput('symitarHostname', true);
  validateHostname(symitarHostname, 'symitarHostname');

  const sshUsername: string = getInput('sshUsername', true);
  const sshPassword: string = getInput('sshPassword', true);
  const sshPort: number = parseInt(
    getInput('sshPort', false) || DEFAULT_SSH_PORT,
    10,
  );
  validatePort(sshPort, 'sshPort');

  // The sym number is supplied directly as an input; it is a number, never a
  // zero-padded string. Padding is the Symitar client's concern. The empty
  // string is guarded explicitly because `Number('')` is `0`, which
  // `isValidNumber` would accept - silently synchronizing against Sym 0.
  const symNumberInput: string = getInput('symNumber', false).trim();
  const symNumber: number = symNumberInput ? Number(symNumberInput) : NaN;

  const symitarUserNumber: string = getInput('symitarUserNumber', true);
  const symitarUserPassword: string = getInput('symitarUserPassword', true);
  const debug: boolean = getBoolInput('debug', false);

  // Validate symNumber
  if (!isValidNumber(symNumber)) {
    throw new SymNumberError(
      `No valid symNumber found for build branch (${buildBranchName}). Provide the 'sym-number' input as a number.`,
      buildBranchName,
    );
  }

  return {
    logPrefix,
    buildBranch,
    buildBranchName,
    repoConfig,
    apiKey,
    powerOnsDirectory,
    symitarHostname,
    sshUsername,
    sshPassword,
    sshPort,
    symNumber,
    symitarUserNumber,
    symitarUserPassword,
    debug,
  };
}

/**
 * Refuses a `commit-pulled-changes` run whose checked-out branch is not the
 * branch it would push to.
 *
 * Core's `commitPulledChanges` stages the pulled directory and runs
 * `git push origin HEAD:<commitBranch>`. It never compares HEAD to
 * `commitBranch`, because on Azure the two cannot diverge. On GitHub they can:
 * `actions/checkout` takes an arbitrary `ref`, so a workflow that checks out
 * `develop` and sets `commit-branch: main` would compute the diff against
 * `develop`'s tree and then silently move `main` to it. This repo's pre-v2
 * `git.ts` guarded against exactly that, and the README still documents the
 * requirement, so the guard is restored here - at load time, before Symitar is
 * contacted and before anything has been pulled into the workspace.
 *
 * Not applied to `create-pull-request` runs: core checks out
 * `pullRequestBranch` itself with `git checkout -B` before committing, so HEAD
 * is whatever it needs to be by construction.
 *
 * @param commitBranch The resolved commit branch
 * @param workspacePath Absolute path to the git working tree
 */
function assertCheckoutMatchesCommitBranch(
  commitBranch: string,
  workspacePath: string,
): void {
  const headBranch = execFileSync(
    'git',
    ['rev-parse', '--abbrev-ref', 'HEAD'],
    { cwd: workspacePath, encoding: 'utf8' },
  ).trim();

  if (headBranch === 'HEAD') {
    throw new InputError(
      `commit-branch is "${commitBranch}" but the workspace is in a detached HEAD state. ` +
        `Configure actions/checkout with ref: ${commitBranch} so drift detection and the commit target match.`,
      'commitBranch',
    );
  }

  if (headBranch !== commitBranch) {
    throw new InputError(
      `commit-branch is "${commitBranch}" but the checked-out branch is "${headBranch}". ` +
        'These must match — drift is computed against the working tree, and pushing to a different branch ' +
        "would silently move that branch's content. " +
        `Configure actions/checkout with ref: ${commitBranch}.`,
      'commitBranch',
      { commitBranch, headBranch },
    );
  }
}

/**
 * Loads configuration for Synchronize tasks
 */
export function loadSynchronizeConfig(): SynchronizeActionConfig {
  // On GitHub the checkout is the workspace: there is no separate artifact
  // staging directory to resolve against
  const workspaceRoot = resolveWorkspacePath();
  const sourcePath: string = workspaceRoot;
  const sourceAbsolutePath: string = workspaceRoot;
  const workspacePath: string = workspaceRoot;
  // Core never reads host environment variables, so the runner's scratch
  // location is resolved here and handed over as plain configuration.
  const tempDirectory: string = process.env.RUNNER_TEMP || tmpdir();

  const commonConfig = loadCommonConfig();

  // Required, so that an explicitly empty `dry-run` fails the run rather than
  // silently defaulting to a live mutation
  const isDryRun: boolean = getBoolInput('isDryRun', true);
  const skipValidation: boolean = getBoolInput('skipValidation', false);
  const syncModeInput = getInput('syncMode', true);

  if (!syncModeInput || !['push', 'pull', 'mirror'].includes(syncModeInput)) {
    throw new InputError(
      `Invalid or missing syncMode: '${syncModeInput}'. Must be one of: push, pull, mirror`,
      'syncMode',
    );
  }

  const syncMode: SymitarSyncMode =
    syncModeInput === 'push'
      ? SymitarSyncMode.PUSH
      : syncModeInput === 'pull'
        ? SymitarSyncMode.PULL
        : SymitarSyncMode.MIRROR;

  // Parse sync method (sftp or rsync)
  const syncMethodInput = getInput('syncMethod', false) || 'sftp';
  if (syncMethodInput !== 'sftp' && syncMethodInput !== 'rsync') {
    throw new InputError(
      `Invalid sync method: '${syncMethodInput}'. Must be 'sftp' or 'rsync'`,
      'syncMethod',
    );
  }
  const syncMethod: SyncMethod = syncMethodInput;

  // Validate the connection type (https or ssh).
  //
  // The Azure DevOps extension declares `connectionType` as a two-option
  // `pickList` in `task.json`, so core's runner can safely treat the input as
  // `'https' | 'ssh'`. `action.yml` has no equivalent constraint, and the
  // runner branches `connectionType === 'https' ? HTTPS : SSH` - meaning a
  // typo such as `htpps` would otherwise silently run the SSH path against an
  // HTTPS-configured job. The guarantee is restored here.
  //
  // The value is deliberately not returned on the config: core's runner reads
  // this input itself through the `TaskHost`, and `SynchronizeDirectoryConfig`
  // is part of the package's public API, so it cannot carry a field core does
  // not define.
  const connectionType = getInput('connectionType', false) || 'ssh';
  if (connectionType !== 'https' && connectionType !== 'ssh') {
    throw new InputError(
      `Invalid connection type: '${connectionType}'. Must be 'https' or 'ssh'`,
      'connectionType',
    );
  }

  // preserveServerFiles comes exclusively from the repo config, which parses
  // it from this same input
  const preserveServerFiles = commonConfig.repoConfig.preserveServerFiles;

  const pullPreservedOnly = getBoolInput('pullPreservedOnly', false);
  const commitPulledChanges = getBoolInput('commitPulledChanges', false);
  const createPullRequest = getBoolInput('createPullRequest', false);

  if (
    (commitPulledChanges || createPullRequest) &&
    syncMode !== SymitarSyncMode.PULL
  ) {
    throw new InputError(
      'commitPulledChanges and createPullRequest can only be used when syncMode is pull',
      createPullRequest ? 'createPullRequest' : 'commitPulledChanges',
    );
  }

  if (commitPulledChanges && createPullRequest) {
    throw new InputError(
      'commitPulledChanges and createPullRequest cannot both be enabled',
      'createPullRequest',
    );
  }

  const commitMessage =
    getInput('commitMessage', false) ||
    'chore: sync server-managed Symitar files [skip ci]';
  const commitBranch =
    getInput('commitBranch', false) ||
    process.env.GITHUB_REF_NAME ||
    commonConfig.buildBranchName ||
    undefined;
  const pullRequestTargetBranch =
    getInput('pullRequestTargetBranch', false) || commitBranch || undefined;
  const pullRequestBranch =
    getInput('pullRequestBranch', false) || 'chore/symitar-pull';
  const pullRequestTitle =
    getInput('pullRequestTitle', false) ||
    'chore: sync server-managed Symitar files';
  const pullRequestDescription =
    getInput('pullRequestDescription', false) ||
    'Auto-generated pull of server-managed Symitar files.';
  const gitUserName = getInput('gitUserName', false) || 'libum-bot';
  const gitUserEmail = getInput('gitUserEmail', false) || 'bot@libum.io';

  // Skipped on a dry run, which never commits or pushes.
  if (commitPulledChanges && !isDryRun && commitBranch) {
    assertCheckoutMatchesCommitBranch(commitBranch, workspacePath);
  }

  // Read eagerly so a `create-pull-request` run without a usable token fails
  // here, before Symitar is contacted, rather than after the pull has already
  // mutated the workspace. `GITHUB_TOKEN` is not consulted as a fallback: the
  // runner does not export it to an action's environment, so a silent fallback
  // would only ever resolve to undefined.
  const githubToken = getInput('githubToken', false).trim() || undefined;
  if (createPullRequest && !githubToken) {
    throw new InputError(
      "The 'github-token' input is required when 'create-pull-request' is enabled. " +
        'Pass `github-token: ${{ secrets.GITHUB_TOKEN }}` (or a PAT with `pull-requests: write`).',
      'githubToken',
    );
  }

  // Parse SFTP concurrency
  const sftpConcurrencyInput = getInput('sftpConcurrency', false) || '4';
  const sftpConcurrency = parseInt(sftpConcurrencyInput, 10);
  if (isNaN(sftpConcurrency) || sftpConcurrency < 1 || sftpConcurrency > 20) {
    throw new InputError(
      `Invalid SFTP concurrency: '${sftpConcurrencyInput}'. Must be between 1-20`,
      'sftpConcurrency',
    );
  }

  // Parse symitar app port (optional, only for HTTPS)
  const symitarAppPortInput = getInput('symitarAppPort', false);
  let symitarAppPort: number | undefined;
  if (symitarAppPortInput) {
    symitarAppPort = parseInt(symitarAppPortInput, 10);
    validatePort(symitarAppPort, 'symitarAppPort');
  }

  return {
    ...commonConfig,
    sourcePath,
    sourceAbsolutePath,
    workspacePath,
    tempDirectory,
    isDryRun,
    skipValidation,
    syncMode,
    syncMethod,
    sftpConcurrency,
    symitarAppPort,
    preserveServerFiles,
    pullPreservedOnly,
    commitPulledChanges,
    createPullRequest,
    commitMessage,
    commitBranch,
    pullRequestBranch,
    pullRequestTargetBranch,
    pullRequestTitle,
    pullRequestDescription,
    gitUserName,
    gitUserEmail,
    githubToken,
  };
}

/**
 * Creates a SymitarHTTPs client with the provided configuration.
 *
 * The synchronize runner always builds an SSH client first and passes it in
 * here, because it goes on to call SSH-only APIs on that same client
 * (`getFileModificationTime`, `createInstallWorker`, `createUninstallWorker`)
 * regardless of the connection type. Sharing the one connection avoids opening
 * a second session, and means `end()` on the HTTPS client closes it.
 */
export function createHTTPsClient(
  config: SynchronizeDirectoryConfig,
  sshClient?: SymitarSSH,
): SymitarHTTPs {
  if (!config.symitarAppPort) {
    throw new InputError(
      'symitarAppPort is required when using HTTPS connection',
      'symitarAppPort',
    );
  }

  return new SymitarHTTPs(
    `https://${config.symitarHostname}:${config.symitarAppPort}`,
    {
      symNumber: config.symNumber,
      symitarUserNumber: config.symitarUserNumber,
      symitarUserPassword: config.symitarUserPassword,
    },
    config.debug ? 'debug' : 'info',
    {
      port: config.sshPort,
      username: config.sshUsername,
      password: config.sshPassword,
    },
    sshClient ? { sshClient } : undefined,
  );
}

/**
 * Creates a SymitarSSH client with the provided configuration
 */
export async function createSSHClient(
  config: CommonTaskConfig,
): Promise<SymitarSSH> {
  const client = new SymitarSSH(
    {
      host: config.symitarHostname,
      port: config.sshPort,
      username: config.sshUsername,
      password: config.sshPassword,
    },
    config.debug ? 'debug' : 'info',
  );

  await client.isReady;

  return client;
}

/**
 * Validates the API key for the given hostname
 */
export async function validateTaskApiKey(
  apiKey: string,
  hostname: string,
): Promise<void> {
  await validateApiKey(apiKey, hostname);
}
