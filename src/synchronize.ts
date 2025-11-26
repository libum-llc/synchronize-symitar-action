import * as core from '@actions/core';
import {
  SymitarSSH,
  SymitarHTTPs,
  SymitarSyncDirectory,
  SymitarSyncMode,
  SymitarSyncResponse,
} from '@libum-llc/symitar';
import { validateApiKey } from './subscription';
import { DirectoryType, getDirectoryConfig, getInstallList } from './directory-config';

export type ConnectionType = 'https' | 'ssh';
export type SyncMode = 'push' | 'pull' | 'mirror';

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
 * Synchronize files to a Symitar server using HTTPS or SSH.
 */
export async function synchronizeToSymitar(config: SynchronizeConfig): Promise<SynchronizeResult> {
  const { logPrefix } = config;

  // Validate API key first
  core.info(`${logPrefix} Validating API key...`);
  await validateApiKey(config.apiKey);

  // Get directory configuration
  const directoryConfig = getDirectoryConfig(config.directoryType);

  // Get install list (only for PowerOns)
  const installList = getInstallList(config.directoryType, config.installPowerOnList);

  // Get sync mode enum
  const syncMode = getSyncMode(config.syncMode);

  core.info(`${logPrefix} Using ${config.connectionType.toUpperCase()} connection`);
  core.info(
    `${logPrefix} Beginning ${config.syncMode} synchronization of ${directoryConfig.name} for Sym ${config.symNumber}${config.isDryRun ? ' (Dry Run)' : ''}`,
  );

  let result: SymitarSyncResponse;

  if (config.connectionType === 'https') {
    result = await synchronizeViaHTTPs(
      config,
      directoryConfig.symitarDirectory,
      syncMode,
      installList,
    );
  } else {
    result = await synchronizeViaSSH(
      config,
      directoryConfig.symitarDirectory,
      syncMode,
      installList,
    );
  }

  return {
    filesDeployed: result.deployed.length,
    filesDeleted: result.deleted.length,
    filesInstalled: result.installed.length,
    filesUninstalled: result.uninstalled.length,
    deployedFiles: result.deployed,
    deletedFiles: result.deleted,
    installedFiles: result.installed,
    uninstalledFiles: result.uninstalled,
  };
}

/**
 * Synchronize using HTTPS connection
 */
async function synchronizeViaHTTPs(
  config: SynchronizeConfig,
  symitarDirectory: SymitarSyncDirectory,
  syncMode: SymitarSyncMode,
  installList: string[],
): Promise<SymitarSyncResponse> {
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

  const client = new SymitarHTTPs(
    baseUrl,
    symitarConfig,
    config.debug ? 'debug' : 'info',
    sshConfig,
  );

  try {
    core.info(`${logPrefix} Starting synchronization${config.isDryRun ? ' (DRY RUN)' : ''}...`);

    const result = await client.synchronizeFiles(
      config.localDirectoryPath,
      installList,
      config.isDryRun,
      symitarDirectory,
      syncMode,
      config.validateIgnoreList,
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
  installList: string[],
): Promise<SymitarSyncResponse> {
  const { logPrefix } = config;

  core.info(`${logPrefix} Connecting to ${config.symitarHostname}:${config.sshPort} via SSH...`);

  const client = new SymitarSSH(
    {
      host: config.symitarHostname,
      port: config.sshPort,
      username: config.sshUsername,
      password: config.sshPassword,
    },
    config.debug ? 'debug' : 'info',
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

    const result = await client.synchronizeFiles(
      symitarConfig,
      config.localDirectoryPath,
      installList,
      config.isDryRun,
      symitarDirectory,
      syncMode,
      config.validateIgnoreList,
    );

    return result;
  } finally {
    core.info(`${logPrefix} Closing connection...`);
    await client.end();
  }
}
