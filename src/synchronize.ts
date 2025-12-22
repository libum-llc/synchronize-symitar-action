import * as core from '@actions/core';
import {
  SymitarSSH,
  SymitarHTTPs,
  SymitarSyncDirectory,
  SymitarSyncMode,
  SymitarSyncTransport,
  SyncFilesOptions,
  SyncFilesResult,
} from '@libum-llc/symitar';
import { validateApiKey } from './subscription';
import { DirectoryType, getDirectoryConfig, getInstallList } from './directory-config';

export type ConnectionType = 'https' | 'ssh';
export type SyncMode = 'push' | 'pull' | 'mirror';
export type SyncMethod = 'sftp' | 'rsync';

export interface SynchronizeConfig {
  symitarHostname: string;
  symNumber: number;
  symitarUserNumber: string;
  symitarUserPassword: string;
  sshUsername: string;
  sshPassword: string;
  sshPort: number;
  symitarAppPort?: number;
  apiKey: string;
  localDirectoryPath: string;
  directoryType: DirectoryType;
  connectionType: ConnectionType;
  syncMode: SyncMode;
  syncMethod: SyncMethod;
  sftpConcurrency: number;
  isDryRun: boolean;
  installPowerOnList: string[];
  validateIgnoreList: string[];
  debug: boolean;
  logPrefix: string;
}

export interface SynchronizeResult {
  filesDeployed: number;
  filesDeleted: number;
  filesInstalled: number;
  filesUninstalled: number;
  deployedFiles: string[];
  deletedFiles: string[];
  installedFiles: string[];
  uninstalledFiles: string[];
}

/**
 * Maps our sync mode string to the Symitar enum
 */
function getSyncMode(mode: SyncMode): SymitarSyncMode {
  switch (mode) {
    case 'push':
      return SymitarSyncMode.PUSH;
    case 'pull':
      return SymitarSyncMode.PULL;
    case 'mirror':
      return SymitarSyncMode.MIRROR;
    default:
      throw new Error(`Invalid sync mode: ${mode}`);
  }
}

/**
 * Maps our sync method string to the Symitar transport enum
 */
function getSyncTransport(method: SyncMethod): SymitarSyncTransport {
  switch (method) {
    case 'sftp':
      return SymitarSyncTransport.SFTP;
    case 'rsync':
      return SymitarSyncTransport.RSYNC;
    default:
      throw new Error(`Invalid sync method: ${method}`);
  }
}

/**
 * Synchronize files to a Symitar server using HTTPS or SSH.
 */
export async function synchronizeToSymitar(config: SynchronizeConfig): Promise<SynchronizeResult> {
  const { logPrefix } = config;

  // Validate API key first
  await validateApiKey(config.apiKey);

  // Get directory configuration
  const directoryConfig = getDirectoryConfig(config.directoryType);

  // Get install list (only for PowerOns)
  const installList = getInstallList(config.directoryType, config.installPowerOnList);

  // Get sync mode enum
  const syncMode = getSyncMode(config.syncMode);

  // Get sync transport
  const syncTransport = getSyncTransport(config.syncMethod);

  // Build sync options
  const syncOptions: SyncFilesOptions = {
    transport: syncTransport,
    concurrency: config.sftpConcurrency,
    powerOn: {
      installList,
      validateIgnoreList: config.validateIgnoreList,
    },
  };

  core.info(`${logPrefix} Using ${config.connectionType.toUpperCase()} connection`);
  core.info(`${logPrefix} Sync method: ${config.syncMethod.toUpperCase()}`);
  if (config.syncMethod === 'sftp') {
    core.info(`${logPrefix} SFTP concurrency: ${config.sftpConcurrency}`);
  }
  core.info(
    `${logPrefix} Beginning ${config.syncMode} synchronization of ${directoryConfig.name} for Sym ${config.symNumber}${config.isDryRun ? ' (Dry Run)' : ''}`,
  );

  let result: SyncFilesResult;

  if (config.connectionType === 'https') {
    result = await synchronizeViaHTTPs(
      config,
      directoryConfig.symitarDirectory,
      syncMode,
      syncOptions,
    );
  } else {
    result = await synchronizeViaSSH(
      config,
      directoryConfig.symitarDirectory,
      syncMode,
      syncOptions,
    );
  }

  return {
    filesDeployed: result.synced.length,
    filesDeleted: result.deleted.length,
    filesInstalled: result.installed?.length ?? 0,
    filesUninstalled: result.uninstalled?.length ?? 0,
    deployedFiles: result.synced,
    deletedFiles: result.deleted,
    installedFiles: result.installed ?? [],
    uninstalledFiles: result.uninstalled ?? [],
  };
}

/**
 * Synchronize using HTTPS connection
 */
async function synchronizeViaHTTPs(
  config: SynchronizeConfig,
  symitarDirectory: SymitarSyncDirectory,
  syncMode: SymitarSyncMode,
  syncOptions: SyncFilesOptions,
): Promise<SyncFilesResult> {
  const { logPrefix } = config;

  if (!config.symitarAppPort) {
    throw new Error('symitar-app-port is required when using HTTPS connection');
  }

  const baseUrl = `https://${config.symitarHostname}:${config.symitarAppPort}`;
  core.info(`${logPrefix} Connecting to ${baseUrl}...`);

  const symitarConfig = {
    symNumber: config.symNumber,
    symitarUserNumber: config.symitarUserNumber,
    symitarUserPassword: config.symitarUserPassword,
  };

  const sshConfig = {
    port: config.sshPort,
    username: config.sshUsername,
    password: config.sshPassword,
  };

  const logLevel = config.debug ? 'debug' : 'warn';
  const client = new SymitarHTTPs(baseUrl, symitarConfig, logLevel, sshConfig);

  try {
    core.info(`${logPrefix} Starting synchronization${config.isDryRun ? ' (DRY RUN)' : ''}...`);

    const result = await client.syncFiles(
      config.localDirectoryPath,
      symitarDirectory,
      syncMode,
      syncOptions,
      config.isDryRun,
    );

    return result;
  } finally {
    core.info(`${logPrefix} Closing connection...`);
    await client.end();
  }
}

/**
 * Synchronize using SSH connection
 */
async function synchronizeViaSSH(
  config: SynchronizeConfig,
  symitarDirectory: SymitarSyncDirectory,
  syncMode: SymitarSyncMode,
  syncOptions: SyncFilesOptions,
): Promise<SyncFilesResult> {
  const { logPrefix } = config;

  core.info(`${logPrefix} Connecting to ${config.symitarHostname}:${config.sshPort} via SSH...`);

  const logLevel = config.debug ? 'debug' : 'warn';
  const client = new SymitarSSH(
    {
      host: config.symitarHostname,
      port: config.sshPort,
      username: config.sshUsername,
      password: config.sshPassword,
    },
    logLevel,
  );

  try {
    await client.isReady;
    core.info(`${logPrefix} Connected successfully`);

    core.info(`${logPrefix} Starting synchronization${config.isDryRun ? ' (DRY RUN)' : ''}...`);

    const symitarConfig = {
      symNumber: config.symNumber,
      symitarUserNumber: config.symitarUserNumber,
      symitarUserPassword: config.symitarUserPassword,
    };

    const result = await client.syncFiles(
      symitarConfig,
      config.localDirectoryPath,
      symitarDirectory,
      syncMode,
      syncOptions,
      config.isDryRun,
    );

    return result;
  } finally {
    core.info(`${logPrefix} Closing connection...`);
    await client.end();
  }
}
