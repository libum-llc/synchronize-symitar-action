import {
  DIRECTORY_CONFIG,
  isValidDirectoryType,
  getDirectoryConfig,
  getLocalDirectoryPath,
  getInstallList,
  calculateTotalChanges,
  DirectoryType,
} from '../src/directory-config';

// Mock @libum-llc/symitar enums
jest.mock('@libum-llc/symitar', () => ({
  SymitarSyncDirectory: {
    REPWRITERSPECS: 'REPWRITERSPECS',
    LETTERSPECS: 'LETTERSPECS',
    DATAFILES: 'DATAFILES',
    HELPFILES: 'HELPFILES',
  },
}));

describe('directory-config', () => {
  describe('DIRECTORY_CONFIG', () => {
    it('should have configuration for all directory types', () => {
      expect(DIRECTORY_CONFIG.powerOns).toBeDefined();
      expect(DIRECTORY_CONFIG.letterFiles).toBeDefined();
      expect(DIRECTORY_CONFIG.dataFiles).toBeDefined();
      expect(DIRECTORY_CONFIG.helpFiles).toBeDefined();
    });

    it('should have correct config for powerOns', () => {
      expect(DIRECTORY_CONFIG.powerOns).toEqual({
        name: 'PowerOns',
        symitarDirectory: 'REPWRITERSPECS',
        defaultPath: 'REPWRITERSPECS/',
        supportsInstall: true,
      });
    });

    it('should have correct config for letterFiles', () => {
      expect(DIRECTORY_CONFIG.letterFiles).toEqual({
        name: 'LetterFiles',
        symitarDirectory: 'LETTERSPECS',
        defaultPath: 'LETTERSPECS/',
        supportsInstall: false,
      });
    });

    it('should have correct config for dataFiles', () => {
      expect(DIRECTORY_CONFIG.dataFiles).toEqual({
        name: 'DataFiles',
        symitarDirectory: 'DATAFILES',
        defaultPath: 'DATAFILES/',
        supportsInstall: false,
      });
    });

    it('should have correct config for helpFiles', () => {
      expect(DIRECTORY_CONFIG.helpFiles).toEqual({
        name: 'HelpFiles',
        symitarDirectory: 'HELPFILES',
        defaultPath: 'HELPFILES/',
        supportsInstall: false,
      });
    });

    it('should only support install for powerOns', () => {
      expect(DIRECTORY_CONFIG.powerOns.supportsInstall).toBe(true);
      expect(DIRECTORY_CONFIG.letterFiles.supportsInstall).toBe(false);
      expect(DIRECTORY_CONFIG.dataFiles.supportsInstall).toBe(false);
      expect(DIRECTORY_CONFIG.helpFiles.supportsInstall).toBe(false);
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
      expect(isValidDirectoryType('REPWRITERSPECS')).toBe(false);
    });
  });

  describe('getDirectoryConfig', () => {
    it('should return config for valid directory type', () => {
      const config = getDirectoryConfig('powerOns');
      expect(config.name).toBe('PowerOns');
      expect(config.supportsInstall).toBe(true);
    });

    it('should throw error for invalid directory type', () => {
      expect(() => getDirectoryConfig('invalid')).toThrow(
        'Invalid directory type: invalid. Must be one of: powerOns, letterFiles, dataFiles, helpFiles',
      );
    });
  });

  describe('getLocalDirectoryPath', () => {
    it('should return input path when provided', () => {
      const result = getLocalDirectoryPath('powerOns', './custom/path/');
      expect(result).toBe('./custom/path/');
    });

    it('should return default path when input is not provided', () => {
      const result = getLocalDirectoryPath('powerOns', undefined);
      expect(result).toBe('REPWRITERSPECS/');
    });

    it('should return default path when input is empty', () => {
      const result = getLocalDirectoryPath('letterFiles', undefined);
      expect(result).toBe('LETTERSPECS/');
    });

    it('should return correct default for each directory type', () => {
      expect(getLocalDirectoryPath('powerOns')).toBe('REPWRITERSPECS/');
      expect(getLocalDirectoryPath('letterFiles')).toBe('LETTERSPECS/');
      expect(getLocalDirectoryPath('dataFiles')).toBe('DATAFILES/');
      expect(getLocalDirectoryPath('helpFiles')).toBe('HELPFILES/');
    });
  });

  describe('getInstallList', () => {
    const installList = ['FILE1.PO', 'FILE2.PO'];

    it('should return install list for powerOns', () => {
      const result = getInstallList('powerOns', installList);
      expect(result).toEqual(['FILE1.PO', 'FILE2.PO']);
    });

    it('should return empty array for non-powerOns directory types', () => {
      expect(getInstallList('letterFiles', installList)).toEqual([]);
      expect(getInstallList('dataFiles', installList)).toEqual([]);
      expect(getInstallList('helpFiles', installList)).toEqual([]);
    });

    it('should return empty array when install list is empty', () => {
      expect(getInstallList('powerOns', [])).toEqual([]);
    });
  });

  describe('calculateTotalChanges', () => {
    const resultWithInstall = {
      deployed: ['A.PO', 'B.PO'],
      deleted: ['C.PO'],
      installed: ['A.PO'],
      uninstalled: ['D.PO', 'E.PO'],
    };

    it('should include install counts for powerOns', () => {
      const total = calculateTotalChanges('powerOns', resultWithInstall);
      // 2 deployed + 1 deleted + 1 installed + 2 uninstalled = 6
      expect(total).toBe(6);
    });

    it('should exclude install counts for non-powerOns', () => {
      const total = calculateTotalChanges('letterFiles', resultWithInstall);
      // 2 deployed + 1 deleted = 3
      expect(total).toBe(3);
    });

    it('should return 0 for empty results', () => {
      const emptyResult = {
        deployed: [],
        deleted: [],
        installed: [],
        uninstalled: [],
      };
      expect(calculateTotalChanges('powerOns', emptyResult)).toBe(0);
      expect(calculateTotalChanges('letterFiles', emptyResult)).toBe(0);
    });
  });
});
