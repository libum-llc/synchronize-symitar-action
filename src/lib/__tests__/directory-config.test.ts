import { SymitarSyncDirectory } from '@libum-llc/symitar';

import {
  DIRECTORY_CONFIG,
  isValidDirectoryType,
  getDirectoryConfig,
  getDirectoryConfigKey,
  getLocalDirectoryPath,
  getInstallList,
  SYMITAR_CLI_POWERON_NAME_MAX_LENGTH,
  calculateTotalChanges,
  type ConfigDirectoryPaths,
} from '../directory-config';

describe('directory-config', () => {
  describe('DIRECTORY_CONFIG', () => {
    it('should have configuration for all four directory types', () => {
      expect(Object.keys(DIRECTORY_CONFIG)).toHaveLength(4);
      expect(DIRECTORY_CONFIG).toHaveProperty('powerOns');
      expect(DIRECTORY_CONFIG).toHaveProperty('letterFiles');
      expect(DIRECTORY_CONFIG).toHaveProperty('dataFiles');
      expect(DIRECTORY_CONFIG).toHaveProperty('helpFiles');
    });

    it('should map powerOns to REPWRITERSPECS', () => {
      const config = DIRECTORY_CONFIG.powerOns;

      expect(config.name).toBe('PowerOns');
      expect(config.symitarDirectory).toBe(SymitarSyncDirectory.REPWRITERSPECS);
      expect(config.defaultPath).toBe('REPWRITERSPECS/');
      expect(config.supportsInstall).toBe(true);
    });

    it('should map letterFiles to LETTERSPECS', () => {
      const config = DIRECTORY_CONFIG.letterFiles;

      expect(config.name).toBe('LetterFiles');
      expect(config.symitarDirectory).toBe(SymitarSyncDirectory.LETTERSPECS);
      expect(config.defaultPath).toBe('LETTERSPECS/');
      expect(config.supportsInstall).toBe(false);
    });

    it('should map dataFiles to DATAFILES', () => {
      const config = DIRECTORY_CONFIG.dataFiles;

      expect(config.name).toBe('DataFiles');
      expect(config.symitarDirectory).toBe(SymitarSyncDirectory.DATAFILES);
      expect(config.defaultPath).toBe('DATAFILES/');
      expect(config.supportsInstall).toBe(false);
    });

    it('should map helpFiles to HELPFILES', () => {
      const config = DIRECTORY_CONFIG.helpFiles;

      expect(config.name).toBe('HelpFiles');
      expect(config.symitarDirectory).toBe(SymitarSyncDirectory.HELPFILES);
      expect(config.defaultPath).toBe('HELPFILES/');
      expect(config.supportsInstall).toBe(false);
    });

    it('should only support install for powerOns', () => {
      const typesWithInstall = Object.entries(DIRECTORY_CONFIG)
        .filter(([, config]) => config.supportsInstall)
        .map(([type]) => type);

      expect(typesWithInstall).toEqual(['powerOns']);
    });
  });

  describe('isValidDirectoryType', () => {
    it('should return true for valid directory types', () => {
      expect(isValidDirectoryType('powerOns')).toBe(true);
      expect(isValidDirectoryType('letterFiles')).toBe(true);
      expect(isValidDirectoryType('dataFiles')).toBe(true);
      expect(isValidDirectoryType('helpFiles')).toBe(true);
    });

    it('should return false for invalid directory types', () => {
      expect(isValidDirectoryType('invalid')).toBe(false);
      expect(isValidDirectoryType('')).toBe(false);
      expect(isValidDirectoryType('PowerOns')).toBe(false); // case sensitive
      expect(isValidDirectoryType('POWERONS')).toBe(false);
    });
  });

  describe('getDirectoryConfig', () => {
    it('should return config for valid directory types', () => {
      const config = getDirectoryConfig('powerOns');

      expect(config.name).toBe('PowerOns');
      expect(config.symitarDirectory).toBe(SymitarSyncDirectory.REPWRITERSPECS);
    });

    it('should throw error for invalid directory type', () => {
      expect(() => getDirectoryConfig('invalid')).toThrow(
        'Invalid directory type: invalid. Must be one of: powerOns, letterFiles, dataFiles, helpFiles',
      );
    });

    it('should throw error with helpful message listing valid types', () => {
      expect(() => getDirectoryConfig('foo')).toThrow(/Must be one of:/);
      expect(() => getDirectoryConfig('foo')).toThrow(/powerOns/);
      expect(() => getDirectoryConfig('foo')).toThrow(/letterFiles/);
      expect(() => getDirectoryConfig('foo')).toThrow(/dataFiles/);
      expect(() => getDirectoryConfig('foo')).toThrow(/helpFiles/);
    });
  });

  describe('getDirectoryConfigKey', () => {
    it('should return correct config key for powerOns', () => {
      expect(getDirectoryConfigKey('powerOns')).toBe('powerOnsDirectory');
    });

    it('should return correct config key for letterFiles', () => {
      expect(getDirectoryConfigKey('letterFiles')).toBe('letterFilesDirectory');
    });

    it('should return correct config key for dataFiles', () => {
      expect(getDirectoryConfigKey('dataFiles')).toBe('dataFilesDirectory');
    });

    it('should return correct config key for helpFiles', () => {
      expect(getDirectoryConfigKey('helpFiles')).toBe('helpFilesDirectory');
    });
  });

  describe('getLocalDirectoryPath', () => {
    const mockConfigPaths: ConfigDirectoryPaths = {
      powerOnsDirectory: 'config/REPWRITERSPECS/',
      letterFilesDirectory: 'config/LETTERSPECS/',
      dataFilesDirectory: 'config/DATAFILES/',
      helpFilesDirectory: 'config/HELPFILES/',
    };

    describe('priority 1: task input', () => {
      it('should return input path when provided', () => {
        const result = getLocalDirectoryPath('powerOns', 'custom/path/');

        expect(result).toBe('custom/path/');
      });

      it('should prefer input path over config path', () => {
        const result = getLocalDirectoryPath(
          'powerOns',
          'custom/path/',
          mockConfigPaths,
        );

        expect(result).toBe('custom/path/');
      });
    });

    describe('priority 2: config file value', () => {
      it('should return config path when input is undefined', () => {
        const result = getLocalDirectoryPath(
          'powerOns',
          undefined,
          mockConfigPaths,
        );

        expect(result).toBe('config/REPWRITERSPECS/');
      });

      it('should return config path when input is empty string', () => {
        const result = getLocalDirectoryPath('powerOns', '', mockConfigPaths);

        expect(result).toBe('config/REPWRITERSPECS/');
      });

      it('should return correct config path for each directory type', () => {
        expect(
          getLocalDirectoryPath('powerOns', undefined, mockConfigPaths),
        ).toBe('config/REPWRITERSPECS/');
        expect(
          getLocalDirectoryPath('letterFiles', undefined, mockConfigPaths),
        ).toBe('config/LETTERSPECS/');
        expect(
          getLocalDirectoryPath('dataFiles', undefined, mockConfigPaths),
        ).toBe('config/DATAFILES/');
        expect(
          getLocalDirectoryPath('helpFiles', undefined, mockConfigPaths),
        ).toBe('config/HELPFILES/');
      });
    });

    describe('priority 3: default path', () => {
      it('should return default path when input is undefined and no config', () => {
        const result = getLocalDirectoryPath('powerOns', undefined);

        expect(result).toBe('REPWRITERSPECS/');
      });

      it('should return default path when input is empty and config is undefined', () => {
        const result = getLocalDirectoryPath('powerOns', '', undefined);

        expect(result).toBe('REPWRITERSPECS/');
      });

      it('should return default path when config path is undefined', () => {
        const partialConfig: ConfigDirectoryPaths = {
          letterFilesDirectory: 'config/LETTERSPECS/',
        };
        const result = getLocalDirectoryPath(
          'powerOns',
          undefined,
          partialConfig,
        );

        expect(result).toBe('REPWRITERSPECS/');
      });

      it('should return correct default for each directory type', () => {
        expect(getLocalDirectoryPath('powerOns', undefined)).toBe(
          'REPWRITERSPECS/',
        );
        expect(getLocalDirectoryPath('letterFiles', undefined)).toBe(
          'LETTERSPECS/',
        );
        expect(getLocalDirectoryPath('dataFiles', undefined)).toBe(
          'DATAFILES/',
        );
        expect(getLocalDirectoryPath('helpFiles', undefined)).toBe(
          'HELPFILES/',
        );
      });
    });

    describe('priority fallback behavior', () => {
      it('should fall back from empty input to config to default', () => {
        // With config, should use config
        expect(getLocalDirectoryPath('dataFiles', '', mockConfigPaths)).toBe(
          'config/DATAFILES/',
        );

        // Without config, should use default
        expect(getLocalDirectoryPath('dataFiles', '')).toBe('DATAFILES/');
      });

      it('should handle partial config correctly', () => {
        const partialConfig: ConfigDirectoryPaths = {
          powerOnsDirectory: 'custom/REPWRITERSPECS/',
          // letterFilesDirectory is undefined
        };

        expect(
          getLocalDirectoryPath('powerOns', undefined, partialConfig),
        ).toBe('custom/REPWRITERSPECS/');
        expect(
          getLocalDirectoryPath('letterFiles', undefined, partialConfig),
        ).toBe('LETTERSPECS/');
      });
    });

    it.each(['../outside/', '/absolute/', 'C:/outside/', 'bad\\path/'])(
      'rejects unsafe local path %s',
      (unsafePath) => {
        expect(() => getLocalDirectoryPath('powerOns', unsafePath)).toThrow(
          'must remain within the configured artifact or repository',
        );
      },
    );
  });

  describe('getInstallList', () => {
    const mockInstallList = ['INSTALL1.PO', 'INSTALL2.PO'];

    it('should return install list for powerOns', () => {
      const result = getInstallList('powerOns', mockInstallList);

      expect(result).toEqual(mockInstallList);
    });

    it('should return empty array for letterFiles', () => {
      const result = getInstallList('letterFiles', mockInstallList);

      expect(result).toEqual([]);
    });

    it('should return empty array for dataFiles', () => {
      const result = getInstallList('dataFiles', mockInstallList);

      expect(result).toEqual([]);
    });

    it('should return empty array for helpFiles', () => {
      const result = getInstallList('helpFiles', mockInstallList);

      expect(result).toEqual([]);
    });

    it('should return empty array for powerOns when install list is empty', () => {
      const result = getInstallList('powerOns', []);

      expect(result).toEqual([]);
    });

    it('should accept an installed PowerOn name at the CLI limit', () => {
      const fileName = `${'A'.repeat(SYMITAR_CLI_POWERON_NAME_MAX_LENGTH - 3)}.PO`;

      expect(getInstallList('powerOns', [fileName])).toEqual([fileName]);
    });

    it('should reject installed PowerOn names longer than the CLI field', () => {
      const fileName = `${'A'.repeat(SYMITAR_CLI_POWERON_NAME_MAX_LENGTH - 2)}.PO`;

      expect(() => getInstallList('powerOns', [fileName])).toThrow(
        `cannot exceed ${SYMITAR_CLI_POWERON_NAME_MAX_LENGTH} characters`,
      );
    });
  });

  describe('calculateTotalChanges', () => {
    const baseResult = {
      deployed: ['file1', 'file2'],
      deleted: ['file3'],
      installed: ['install1'],
      uninstalled: ['uninstall1', 'uninstall2'],
    };

    it('should include all counts for powerOns', () => {
      const result = calculateTotalChanges('powerOns', baseResult);

      // 2 deployed + 1 deleted + 1 installed + 2 uninstalled = 6
      expect(result).toBe(6);
    });

    it('should only include deploy/delete for letterFiles', () => {
      const result = calculateTotalChanges('letterFiles', baseResult);

      // 2 deployed + 1 deleted = 3
      expect(result).toBe(3);
    });

    it('should only include deploy/delete for dataFiles', () => {
      const result = calculateTotalChanges('dataFiles', baseResult);

      // 2 deployed + 1 deleted = 3
      expect(result).toBe(3);
    });

    it('should only include deploy/delete for helpFiles', () => {
      const result = calculateTotalChanges('helpFiles', baseResult);

      // 2 deployed + 1 deleted = 3
      expect(result).toBe(3);
    });

    it('should return 0 when no changes', () => {
      const emptyResult = {
        deployed: [],
        deleted: [],
        installed: [],
        uninstalled: [],
      };

      expect(calculateTotalChanges('powerOns', emptyResult)).toBe(0);
      expect(calculateTotalChanges('letterFiles', emptyResult)).toBe(0);
    });

    it('should handle result with only deployed files', () => {
      const deployOnlyResult = {
        deployed: ['file1', 'file2', 'file3'],
        deleted: [],
        installed: [],
        uninstalled: [],
      };

      expect(calculateTotalChanges('powerOns', deployOnlyResult)).toBe(3);
      expect(calculateTotalChanges('letterFiles', deployOnlyResult)).toBe(3);
    });

    it('should handle result with only install changes for powerOns', () => {
      const installOnlyResult = {
        deployed: [],
        deleted: [],
        installed: ['install1', 'install2'],
        uninstalled: ['uninstall1'],
      };

      expect(calculateTotalChanges('powerOns', installOnlyResult)).toBe(3);
      expect(calculateTotalChanges('letterFiles', installOnlyResult)).toBe(0);
    });
  });
});
