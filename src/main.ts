import * as core from '@actions/core';
import { synchronizeToSymitar, ConnectionType, SyncMode } from './synchronize';
import { version } from '../package.json';
import { AuthenticationError, ConnectionError } from './subscription';
import {
  DirectoryType,
  isValidDirectoryType,
  getDirectoryConfig,
  getLocalDirectoryPath,
  calculateTotalChanges,
} from './directory-config';

export async function run(): Promise<void> {
  const logPrefix = '[SynchronizeSymitar]';

  try {
    // Get inputs
    const directoryTypeInput = core.getInput('directory-type', { required: true });
    const localDirectoryPathInput = core.getInput('local-directory-path', { required: false });
    const connectionType = core.getInput('connection-type', { required: true }) as ConnectionType;
    const syncMode = core.getInput('sync-mode', { required: true }) as SyncMode;
    const isDryRun = core.getInput('dry-run', { required: false }) === 'true';
    const symitarHostname = core.getInput('symitar-hostname', { required: true });
    const symitarAppPortInput = core.getInput('symitar-app-port', { required: false });
    const sshUsername = core.getInput('ssh-username', { required: true });
    const sshPassword = core.getInput('ssh-password', { required: true });
    const sshPortInput = core.getInput('ssh-port', { required: false }) || '22';
    const symNumberInput = core.getInput('sym-number', { required: true });
    const symitarUserNumber = core.getInput('symitar-user-number', { required: true });
    const symitarUserPassword = core.getInput('symitar-user-password', { required: true });
    const apiKey = core.getInput('api-key', { required: true });
    const installPowerOnListInput =
      core.getInput('install-poweron-list', { required: false }) || '';
    const validateIgnoreListInput =
      core.getInput('validate-ignore-list', { required: false }) || '';
    const debug = core.getInput('debug', { required: false }) === 'true';

    // Mask sensitive information
    core.setSecret(apiKey);
    core.setSecret(symitarUserPassword);
    core.setSecret(sshPassword);

    // Validate directory type
    if (!isValidDirectoryType(directoryTypeInput)) {
      throw new Error(
        `Invalid directory type: ${directoryTypeInput}. Must be one of: powerOns, letterFiles, dataFiles, helpFiles`,
      );
    }
    const directoryType: DirectoryType = directoryTypeInput;

    // Validate connection type
    if (connectionType !== 'https' && connectionType !== 'ssh') {
      throw new Error(`Invalid connection type: ${connectionType}. Must be 'https' or 'ssh'`);
    }

    // Validate sync mode
    if (syncMode !== 'push' && syncMode !== 'pull' && syncMode !== 'mirror') {
      throw new Error(`Invalid sync mode: ${syncMode}. Must be 'push', 'pull', or 'mirror'`);
    }

    // Validate hostname format
    if (!symitarHostname.match(/^[a-zA-Z0-9.-]+$/)) {
      throw new Error(`Invalid hostname format: ${symitarHostname}`);
    }

    // Validate and parse SSH port
    const sshPort = parseInt(sshPortInput, 10);
    if (isNaN(sshPort) || sshPort < 1 || sshPort > 65535) {
      throw new Error(`Invalid SSH port: ${sshPortInput}. Must be between 1-65535`);
    }

    // Validate and parse Symitar app port (required for HTTPS)
    let symitarAppPort: number | undefined;
    if (connectionType === 'https') {
      if (!symitarAppPortInput) {
        throw new Error('symitar-app-port is required when connection-type is https');
      }
      symitarAppPort = parseInt(symitarAppPortInput, 10);
      if (isNaN(symitarAppPort) || symitarAppPort < 1 || symitarAppPort > 65535) {
        throw new Error(
          `Invalid Symitar app port: ${symitarAppPortInput}. Must be between 1-65535`,
        );
      }
    }

    // Parse sym number
    const symNumber = parseInt(symNumberInput, 10);
    if (isNaN(symNumber) || symNumber < 0 || symNumber > 9999) {
      throw new Error(`Invalid sym number: ${symNumberInput}. Must be between 0-9999`);
    }

    // Get directory config
    const directoryConfig = getDirectoryConfig(directoryType);

    // Get local directory path
    const localDirectoryPath = getLocalDirectoryPath(
      directoryType,
      localDirectoryPathInput || undefined,
    );

    // Parse install PowerOn list (only applies to PowerOns)
    const installPowerOnList = installPowerOnListInput
      .split(',')
      .map((f) => f.trim())
      .filter((f) => f.length > 0);

    // Parse validate ignore list
    const validateIgnoreList = validateIgnoreListInput
      .split(',')
      .map((f) => f.trim())
      .filter((f) => f.length > 0);

    core.info(`${logPrefix} Starting Symitar synchronization (v${version})`);
    core.info(`${logPrefix} Directory Type: ${directoryConfig.name}`);
    core.info(`${logPrefix} Connection Type: ${connectionType.toUpperCase()}`);
    core.info(`${logPrefix} Sync Mode: ${syncMode}`);
    core.info(`${logPrefix} Hostname: ${symitarHostname}`);
    if (connectionType === 'https') {
      core.info(`${logPrefix} Symitar App Port: ${symitarAppPort}`);
    } else {
      core.info(`${logPrefix} SSH Port: ${sshPort}`);
    }
    core.info(`${logPrefix} Sym: ${symNumber}`);
    core.info(`${logPrefix} Local Directory: ${localDirectoryPath}`);
    core.info(`${logPrefix} Dry Run: ${isDryRun}`);
    core.info(`${logPrefix} Debug: ${debug}`);
    core.info(`${logPrefix} API Key: ${apiKey ? '✓ provided' : '✗ missing'}`);

    if (directoryConfig.supportsInstall && installPowerOnList.length > 0) {
      core.info(`${logPrefix} Install PowerOn List: ${installPowerOnList.join(', ')}`);
    }

    if (validateIgnoreList.length > 0) {
      core.info(`${logPrefix} Validate Ignore List: ${validateIgnoreList.join(', ')}`);
    }

    // Run synchronization
    const startTime = Date.now();
    const result = await synchronizeToSymitar({
      symitarHostname,
      symNumber,
      symitarUserNumber,
      symitarUserPassword,
      sshUsername,
      sshPassword,
      sshPort,
      symitarAppPort,
      apiKey,
      localDirectoryPath,
      directoryType,
      connectionType,
      syncMode,
      isDryRun,
      installPowerOnList,
      validateIgnoreList,
      debug,
      logPrefix,
    });

    const elapsedTime = ((Date.now() - startTime) / 1000).toFixed(2);

    // Set outputs
    core.setOutput('files-deployed', result.filesDeployed);
    core.setOutput('files-deleted', result.filesDeleted);
    core.setOutput('files-installed', result.filesInstalled);
    core.setOutput('files-uninstalled', result.filesUninstalled);

    // Calculate total changes
    const totalChanges = calculateTotalChanges(directoryType, {
      deployed: result.deployedFiles,
      deleted: result.deletedFiles,
      installed: result.installedFiles,
      uninstalled: result.uninstalledFiles,
    });

    // Log summary
    core.info('');
    core.info(`${logPrefix} ========================================`);
    core.info(
      `${logPrefix} Synchronization Summary - ${directoryConfig.name}${isDryRun ? ' (DRY RUN)' : ''}`,
    );
    core.info(`${logPrefix} ========================================`);

    if (totalChanges === 0) {
      core.info(`${logPrefix} No changes to synchronize`);
    } else {
      core.info(`${logPrefix} Files Deployed: ${result.filesDeployed}`);
      if (result.deployedFiles.length > 0) {
        for (const file of result.deployedFiles) {
          core.info(`${logPrefix}   + ${file}`);
        }
      }
      core.info(`${logPrefix} Files Deleted: ${result.filesDeleted}`);
      if (result.deletedFiles.length > 0) {
        for (const file of result.deletedFiles) {
          core.info(`${logPrefix}   - ${file}`);
        }
      }
      if (directoryConfig.supportsInstall) {
        core.info(`${logPrefix} Files Installed: ${result.filesInstalled}`);
        if (result.installedFiles.length > 0) {
          for (const file of result.installedFiles) {
            core.info(`${logPrefix}   ✓ ${file}`);
          }
        }
        core.info(`${logPrefix} Files Uninstalled: ${result.filesUninstalled}`);
        if (result.uninstalledFiles.length > 0) {
          for (const file of result.uninstalledFiles) {
            core.info(`${logPrefix}   ✗ ${file}`);
          }
        }
      }
    }

    core.info(`${logPrefix} ========================================`);
    core.info(`${logPrefix} Completed in ${elapsedTime}s`);

    if (isDryRun) {
      core.info(`${logPrefix} This was a dry run - no changes were made`);
    } else {
      core.info(`${logPrefix} Synchronization completed successfully!`);
    }
  } catch (error) {
    // Handle authentication and connection errors specially
    if (error instanceof AuthenticationError) {
      core.error(`${logPrefix} Authentication failed: ${error.message}`);
      core.error(`${logPrefix} API Key: ${error.apiKey ? '***' : 'not provided'}`);
      core.error(`${logPrefix} Host: ${error.host}`);
      if (error.stack) {
        core.debug(`${logPrefix} Stack trace: ${error.stack}`);
      }
      core.setFailed(`API key validation failed: ${error.message}`);
    } else if (error instanceof ConnectionError) {
      core.error(`${logPrefix} Connection failed: ${error.message}`);
      core.error(`${logPrefix} Host: ${error.host}:${error.port}`);
      if (error.originalError) {
        core.error(`${logPrefix} Original error: ${error.originalError.message}`);
        if (error.originalError.stack) {
          core.debug(`${logPrefix} Original stack trace: ${error.originalError.stack}`);
        }
      }
      if (error.stack) {
        core.debug(`${logPrefix} Stack trace: ${error.stack}`);
      }
      core.setFailed(`Failed to connect to license server: ${error.message}`);
    } else if (error instanceof Error) {
      core.error(`${logPrefix} Unexpected error: ${error.message}`);
      if (error.stack) {
        core.debug(`${logPrefix} Stack trace: ${error.stack}`);
      }
      core.setFailed(error.message);
    } else {
      core.error(`${logPrefix} Unknown error: ${String(error)}`);
      core.setFailed(String(error));
    }
  }
}

run();
