import {
  SymitarHTTPs,
  SymitarSSH,
  type SymitarSyncCompareMode,
  SymitarSyncMode,
  SymitarSyncTransport,
} from '@libum-llc/symitar';

import { getBoolInput, getInput, isValidNumber } from './utils';
import { DEFAULT_POWERON_DIRECTORY, DEFAULT_SSH_PORT } from './constants';
import { RepoConfig } from './types';
import { validateApiKey } from './subscription';
import { SymNumberError, InputError } from './errors';

// Validation patterns
const HOSTNAME_PATTERN = /^[a-zA-Z0-9.-]+$/;
const MIN_PORT = 1;
const MAX_PORT = 65535;
export const DEFAULT_SYNC_COMPARE_MODE: SymitarSyncCompareMode = 'quick';

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
 * Normalizes a directory input to the canonical form the vendored lib code
 * expects: forward slashes and exactly one trailing slash.
 *
 * The Azure DevOps extension enforces this with a zod `directoryPathSchema`
 * ("must end with a forward slash") when it parses
 * `.poweron-pipelines/config.yml`. A GitHub Action is configured through
 * `action.yml` inputs and has no schema, so the guarantee is restored here
 * instead. It is load-bearing: vendored code concatenates `${directory}${name}`
 * with no separator, so a directory of `REPWRITERSPECS` would otherwise yield
 * `REPWRITERSPECSFILE.PO`.
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
 * `artifactPath`, `artifactAbsolutePath` and `repositoryPath` are Azure
 * artifact-staging concepts: the Azure extension synchronizes a published
 * build artifact that was downloaded next to, but separately from, the source
 * checkout. A GitHub Action has no such split - `actions/checkout` puts the
 * repository in `GITHUB_WORKSPACE` and that *is* the thing being synchronized -
 * so all three resolve to the workspace root here.
 */
function resolveWorkspacePath(): string {
  const workspace = process.env.GITHUB_WORKSPACE || process.cwd();
  // The vendored runner builds `${basePath}/${localDirectoryPath}`, so a
  // trailing separator here would produce a doubled slash.
  const trimmed = workspace.replace(/[\\/]+$/, '');

  return trimmed || workspace;
}

function parseListInput(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

/**
 * Common configuration shared across all tasks
 */
export interface CommonTaskConfig {
  logPrefix: string;
  buildBranch: string;
  buildBranchName: string;
  repoConfig: RepoConfig;
  apiKey: string;
  powerOnsDirectory: string;
  symitarHostname: string;
  sshUsername: string;
  sshPassword: string;
  sshPort: number;
  symNumber: number;
  symitarUserNumber: string;
  symitarUserPassword: string;
  debug: boolean;
}

/**
 * Sync method type for file synchronization transport
 */
export type SyncMethod = 'sftp' | 'rsync';

/**
 * Configuration specific to Synchronize tasks
 */
export interface SynchronizeTaskConfig extends CommonTaskConfig {
  artifactPath: string;
  artifactAbsolutePath: string;
  isDryRun: boolean;
  skipValidation: boolean;
  syncMode: SymitarSyncMode;
  syncMethod: SyncMethod;
  sftpConcurrency: number;
  symitarAppPort?: number;
  preserveServerFiles: string[];
  pullPreservedOnly: boolean;
  commitPulledChanges: boolean;
  createPullRequest: boolean;
  commitMessage: string;
  commitBranch?: string;
  pullRequestBranch?: string;
  pullRequestTargetBranch?: string;
  pullRequestTitle: string;
  pullRequestDescription: string;
  gitUserName: string;
  gitUserEmail: string;
  repositoryPath: string;
  azureDevOpsAccessToken?: string;
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
  // detection to SSH, and the vendored runner reaches for SSH-only worker APIs
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
 * Loads configuration for Synchronize tasks
 */
export function loadSynchronizeConfig(): SynchronizeTaskConfig {
  // On GitHub the checkout is the workspace: there is no separate artifact
  // staging directory to resolve against
  const workspacePath = resolveWorkspacePath();
  const artifactPath: string = workspacePath;
  const artifactAbsolutePath: string = workspacePath;
  const repositoryPath: string = workspacePath;

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
  // `pickList` in `task.json`, so the vendored runner can safely cast the
  // input to `'https' | 'ssh'`. `action.yml` has no equivalent constraint, and
  // the runner branches `if (connectionType === 'https') { ... } else { SSH }`
  // - meaning a typo such as `htpps` would otherwise silently run the SSH path
  // against an HTTPS-configured job. The guarantee is restored here.
  //
  // The value is deliberately not returned on the config: the runner reads
  // this input itself through the task shim, and `SynchronizeTaskConfig` is
  // the shape the vendored `run.test.ts` constructs, so adding a field to it
  // would fork the vendored test.
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
  // Azure-specific credential with no GitHub equivalent; the GitHub token is
  // wired through the pull-request work rather than through this field
  const azureDevOpsAccessToken: string | undefined = undefined;

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
    artifactPath,
    artifactAbsolutePath,
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
    repositoryPath,
    azureDevOpsAccessToken,
  };
}

/**
 * Maps our sync method string to the Symitar transport enum
 */
export function getSyncTransport(method: SyncMethod): SymitarSyncTransport {
  switch (method) {
    case 'sftp':
      return SymitarSyncTransport.SFTP;
    case 'rsync':
      return SymitarSyncTransport.RSYNC;
    default:
      throw new InputError(`Invalid sync method: ${method}`, 'syncMethod');
  }
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
  config: SynchronizeTaskConfig,
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
