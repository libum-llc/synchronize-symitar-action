import { SymitarSyncDirectory } from '@libum-llc/symitar';

import { ConfigError } from './errors';

/**
 * Configuration for a Symitar directory type
 */
export interface DirectoryTypeConfig {
  /** Display name for the directory type */
  name: string;
  /** Symitar directory enum value */
  symitarDirectory: SymitarSyncDirectory;
  /** Default local path in the repository */
  defaultPath: string;
  /** Whether this directory type supports install/uninstall operations */
  supportsInstall: boolean;
}

/**
 * Supported directory types for synchronization
 */
export type DirectoryType =
  'powerOns' | 'letterFiles' | 'dataFiles' | 'helpFiles';

export const SYMITAR_CLI_POWERON_NAME_MAX_LENGTH = 31;

/**
 * Configuration mapping for all supported directory types
 */
export const DIRECTORY_CONFIG: Record<DirectoryType, DirectoryTypeConfig> = {
  powerOns: {
    name: 'PowerOns',
    symitarDirectory: SymitarSyncDirectory.REPWRITERSPECS,
    defaultPath: 'REPWRITERSPECS/',
    supportsInstall: true,
  },
  letterFiles: {
    name: 'LetterFiles',
    symitarDirectory: SymitarSyncDirectory.LETTERSPECS,
    defaultPath: 'LETTERSPECS/',
    supportsInstall: false,
  },
  dataFiles: {
    name: 'DataFiles',
    symitarDirectory: SymitarSyncDirectory.DATAFILES,
    defaultPath: 'DATAFILES/',
    supportsInstall: false,
  },
  helpFiles: {
    name: 'HelpFiles',
    symitarDirectory: SymitarSyncDirectory.HELPFILES,
    defaultPath: 'HELPFILES/',
    supportsInstall: false,
  },
} as const;

/**
 * Validates that the given string is a valid directory type
 */
export function isValidDirectoryType(type: string): type is DirectoryType {
  return type in DIRECTORY_CONFIG;
}

/**
 * Gets the configuration for a directory type
 * @throws Error if the directory type is invalid
 */
export function getDirectoryConfig(type: string): DirectoryTypeConfig {
  if (!isValidDirectoryType(type)) {
    const validTypes = Object.keys(DIRECTORY_CONFIG).join(', ');
    throw new Error(
      `Invalid directory type: ${type}. Must be one of: ${validTypes}`,
    );
  }
  return DIRECTORY_CONFIG[type];
}

/**
 * Mapping of directory types to their config file field names
 */
const DIRECTORY_CONFIG_KEYS: Record<DirectoryType, string> = {
  powerOns: 'powerOnsDirectory',
  letterFiles: 'letterFilesDirectory',
  dataFiles: 'dataFilesDirectory',
  helpFiles: 'helpFilesDirectory',
} as const;

/**
 * Gets the config key for a directory type
 */
export function getDirectoryConfigKey(
  directoryType: DirectoryType,
): keyof typeof DIRECTORY_CONFIG_KEYS {
  return DIRECTORY_CONFIG_KEYS[
    directoryType
  ] as keyof typeof DIRECTORY_CONFIG_KEYS;
}

/**
 * Directory paths from repository configuration
 */
export interface ConfigDirectoryPaths {
  powerOnsDirectory?: string;
  letterFilesDirectory?: string;
  dataFilesDirectory?: string;
  helpFilesDirectory?: string;
}

/**
 * Gets the local directory path with priority:
 * 1. Task input (inputPath)
 * 2. Config file (configPaths)
 * 3. Default path
 */
export function getLocalDirectoryPath(
  directoryType: DirectoryType,
  inputPath?: string,
  configPaths?: ConfigDirectoryPaths,
): string {
  let resolvedPath: string;
  // Priority 1: Direct task input
  if (inputPath) {
    resolvedPath = inputPath;
  } else if (configPaths) {
    const configKey = DIRECTORY_CONFIG_KEYS[
      directoryType
    ] as keyof ConfigDirectoryPaths;
    resolvedPath =
      configPaths[configKey] || DIRECTORY_CONFIG[directoryType].defaultPath;
  } else {
    resolvedPath = DIRECTORY_CONFIG[directoryType].defaultPath;
  }

  if (
    resolvedPath.includes('\0') ||
    resolvedPath.includes('\\') ||
    resolvedPath.startsWith('/') ||
    /^[A-Za-z]:/.test(resolvedPath) ||
    resolvedPath.split('/').includes('..')
  ) {
    throw new ConfigError(
      `Local directory path must remain within the configured artifact or repository: ${resolvedPath}`,
      { localDirectoryPath: resolvedPath },
    );
  }
  return resolvedPath;
}

/**
 * Gets the install list based on directory type
 * Only PowerOns support installation
 */
export function getInstallList(
  directoryType: DirectoryType,
  installPowerOns: string[],
): string[] {
  const config = DIRECTORY_CONFIG[directoryType];
  if (!config.supportsInstall) return [];

  const namesTooLong = installPowerOns.filter(
    (fileName) => fileName.length > SYMITAR_CLI_POWERON_NAME_MAX_LENGTH,
  );
  if (namesTooLong.length > 0) {
    throw new ConfigError(
      `Installed PowerOn file names cannot exceed ${SYMITAR_CLI_POWERON_NAME_MAX_LENGTH} characters: ${namesTooLong.join(', ')}`,
      {
        installPowerOns: namesTooLong,
        maximumLength: SYMITAR_CLI_POWERON_NAME_MAX_LENGTH,
      },
    );
  }

  return installPowerOns;
}

/**
 * Calculates total changes based on directory type
 * PowerOns include install/uninstall counts, others only deploy/delete
 */
export function calculateTotalChanges(
  directoryType: DirectoryType,
  result: {
    deployed: string[];
    deleted: string[];
    installed: string[];
    uninstalled: string[];
  },
): number {
  const config = DIRECTORY_CONFIG[directoryType];
  const baseChanges = result.deployed.length + result.deleted.length;

  if (config.supportsInstall) {
    return baseChanges + result.installed.length + result.uninstalled.length;
  }

  return baseChanges;
}
