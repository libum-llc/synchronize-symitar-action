import { SymitarSyncDirectory } from '@libum-llc/symitar';

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
export type DirectoryType = 'powerOns' | 'letterFiles' | 'dataFiles' | 'helpFiles';

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
    throw new Error(`Invalid directory type: ${type}. Must be one of: ${validTypes}`);
  }
  return DIRECTORY_CONFIG[type];
}

/**
 * Gets the local directory path with priority:
 * 1. Direct input (inputPath)
 * 2. Default path for the directory type
 */
export function getLocalDirectoryPath(directoryType: DirectoryType, inputPath?: string): string {
  if (inputPath) {
    return inputPath;
  }
  const config = DIRECTORY_CONFIG[directoryType];
  return config.defaultPath;
}

/**
 * Gets the install list based on directory type
 * Only PowerOns support installation
 */
export function getInstallList(directoryType: DirectoryType, installPowerOns: string[]): string[] {
  const config = DIRECTORY_CONFIG[directoryType];
  return config.supportsInstall ? installPowerOns : [];
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
