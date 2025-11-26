import * as core from '@actions/core';
import { synchronizeToSymitar, SynchronizeConfig } from '../src/synchronize';

// Mock @actions/core
jest.mock('@actions/core');

// Mock @libum-llc/symitar
const mockSSHEnd = jest.fn().mockResolvedValue(undefined);
const mockHTTPsEnd = jest.fn().mockResolvedValue(undefined);
const mockSSHSynchronizeFiles = jest.fn();
const mockHTTPsSynchronizeFiles = jest.fn();
const mockIsReady = Promise.resolve();

jest.mock('@libum-llc/symitar', () => ({
  SymitarSSH: jest.fn().mockImplementation(() => ({
    isReady: mockIsReady,
    synchronizeFiles: mockSSHSynchronizeFiles,
    end: mockSSHEnd,
  })),
  SymitarHTTPs: jest.fn().mockImplementation(() => ({
    synchronizeFiles: mockHTTPsSynchronizeFiles,
    end: mockHTTPsEnd,
  })),
  SymitarSyncDirectory: {
    REPWRITERSPECS: 'REPWRITERSPECS',
    LETTERSPECS: 'LETTERSPECS',
    DATAFILES: 'DATAFILES',
    HELPFILES: 'HELPFILES',
  },
  SymitarSyncMode: {
    PUSH: 'push',
    PULL: 'pull',
    MIRROR: 'mirror',
  },
}));

// Mock subscription
jest.mock('../src/subscription', () => ({
  validateApiKey: jest.fn().mockResolvedValue(undefined),
}));

// Mock directory-config
jest.mock('../src/directory-config', () => ({
  getDirectoryConfig: jest.fn((type: string) => ({
    name: type === 'powerOns' ? 'PowerOns' : type,
    symitarDirectory: 'REPWRITERSPECS',
    defaultPath: 'REPWRITERSPECS/',
    supportsInstall: type === 'powerOns',
  })),
  getInstallList: jest.fn((type: string, installList: string[]) =>
    type === 'powerOns' ? installList : [],
  ),
}));

import { SymitarSSH, SymitarHTTPs } from '@libum-llc/symitar';
import { validateApiKey } from '../src/subscription';

const mockedCore = core as jest.Mocked<typeof core>;
const mockedValidateApiKey = validateApiKey as jest.MockedFunction<typeof validateApiKey>;
const MockedSymitarSSH = SymitarSSH as jest.MockedClass<typeof SymitarSSH>;
const MockedSymitarHTTPs = SymitarHTTPs as jest.MockedClass<typeof SymitarHTTPs>;

describe('synchronize', () => {
  const defaultConfig: SynchronizeConfig = {
    symitarHostname: 'symitar.example.com',
    symNumber: 627,
    symitarUserNumber: '1',
    symitarUserPassword: 'questpass',
    sshUsername: 'testuser',
    sshPassword: 'testpass',
    sshPort: 22,
    apiKey: 'test-api-key',
    localDirectoryPath: './powerons/',
    directoryType: 'powerOns',
    connectionType: 'ssh',
    syncMode: 'push',
    isDryRun: false,
    installPowerOnList: ['FILE1.PO'],
    validateIgnoreList: [],
    debug: false,
    logPrefix: '[Test]',
  };

  const defaultSyncResult = {
    deployed: ['FILE1.PO', 'FILE2.PO'],
    deleted: ['OLD.PO'],
    installed: ['FILE1.PO'],
    uninstalled: [],
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockSSHSynchronizeFiles.mockResolvedValue(defaultSyncResult);
    mockHTTPsSynchronizeFiles.mockResolvedValue(defaultSyncResult);
  });

  describe('SSH connection', () => {
    it('should validate API key before synchronization', async () => {
      await synchronizeToSymitar(defaultConfig);

      expect(mockedValidateApiKey).toHaveBeenCalledWith('test-api-key');
    });

    it('should create SymitarSSH client with correct config', async () => {
      await synchronizeToSymitar(defaultConfig);

      expect(MockedSymitarSSH).toHaveBeenCalledWith(
        {
          host: 'symitar.example.com',
          port: 22,
          username: 'testuser',
          password: 'testpass',
        },
        'info',
      );
    });

    it('should use debug log level when debug is true', async () => {
      await synchronizeToSymitar({ ...defaultConfig, debug: true });

      expect(MockedSymitarSSH).toHaveBeenCalledWith(expect.anything(), 'debug');
    });

    it('should call synchronizeFiles with correct parameters', async () => {
      await synchronizeToSymitar(defaultConfig);

      expect(mockSSHSynchronizeFiles).toHaveBeenCalledWith(
        { symNumber: 627, symitarUserNumber: '1', symitarUserPassword: 'questpass' },
        './powerons/',
        ['FILE1.PO'],
        false,
        'REPWRITERSPECS',
        'push',
        [],
      );
    });

    it('should pass isDryRun to synchronizeFiles', async () => {
      await synchronizeToSymitar({ ...defaultConfig, isDryRun: true });

      expect(mockSSHSynchronizeFiles).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.anything(),
        true,
        expect.anything(),
        expect.anything(),
        expect.anything(),
      );
    });

    it('should pass validateIgnoreList to synchronizeFiles', async () => {
      await synchronizeToSymitar({ ...defaultConfig, validateIgnoreList: ['TEST.PO'] });

      expect(mockSSHSynchronizeFiles).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.anything(),
        expect.anything(),
        expect.anything(),
        expect.anything(),
        ['TEST.PO'],
      );
    });

    it('should always close connection in finally block', async () => {
      await synchronizeToSymitar(defaultConfig);

      expect(mockSSHEnd).toHaveBeenCalled();
    });

    it('should close connection even on error', async () => {
      mockSSHSynchronizeFiles.mockRejectedValue(new Error('Sync failed'));

      await expect(synchronizeToSymitar(defaultConfig)).rejects.toThrow('Sync failed');
      expect(mockSSHEnd).toHaveBeenCalled();
    });
  });

  describe('HTTPS connection', () => {
    const httpsConfig: SynchronizeConfig = {
      ...defaultConfig,
      connectionType: 'https',
      symitarAppPort: 42627,
    };

    it('should create SymitarHTTPs client with correct config', async () => {
      await synchronizeToSymitar(httpsConfig);

      expect(MockedSymitarHTTPs).toHaveBeenCalledWith(
        'https://symitar.example.com:42627',
        { symNumber: 627, symitarUserNumber: '1', symitarUserPassword: 'questpass' },
        'info',
        { port: 22, username: 'testuser', password: 'testpass' },
      );
    });

    it('should throw error if symitarAppPort is missing', async () => {
      const configWithoutPort: SynchronizeConfig = {
        ...defaultConfig,
        connectionType: 'https',
        symitarAppPort: undefined,
      };

      await expect(synchronizeToSymitar(configWithoutPort)).rejects.toThrow(
        'symitar-app-port is required when using HTTPS connection',
      );
    });

    it('should call synchronizeFiles with correct parameters', async () => {
      await synchronizeToSymitar(httpsConfig);

      expect(mockHTTPsSynchronizeFiles).toHaveBeenCalledWith(
        './powerons/',
        ['FILE1.PO'],
        false,
        'REPWRITERSPECS',
        'push',
        [],
      );
    });

    it('should always close connection in finally block', async () => {
      await synchronizeToSymitar(httpsConfig);

      expect(mockHTTPsEnd).toHaveBeenCalled();
    });

    it('should close connection even on error', async () => {
      mockHTTPsSynchronizeFiles.mockRejectedValue(new Error('Sync failed'));

      await expect(synchronizeToSymitar(httpsConfig)).rejects.toThrow('Sync failed');
      expect(mockHTTPsEnd).toHaveBeenCalled();
    });
  });

  describe('result handling', () => {
    it('should return correct result structure', async () => {
      const result = await synchronizeToSymitar(defaultConfig);

      expect(result).toEqual({
        filesDeployed: 2,
        filesDeleted: 1,
        filesInstalled: 1,
        filesUninstalled: 0,
        deployedFiles: ['FILE1.PO', 'FILE2.PO'],
        deletedFiles: ['OLD.PO'],
        installedFiles: ['FILE1.PO'],
        uninstalledFiles: [],
      });
    });

    it('should handle empty sync result', async () => {
      mockSSHSynchronizeFiles.mockResolvedValue({
        deployed: [],
        deleted: [],
        installed: [],
        uninstalled: [],
      });

      const result = await synchronizeToSymitar(defaultConfig);

      expect(result).toEqual({
        filesDeployed: 0,
        filesDeleted: 0,
        filesInstalled: 0,
        filesUninstalled: 0,
        deployedFiles: [],
        deletedFiles: [],
        installedFiles: [],
        uninstalledFiles: [],
      });
    });
  });

  describe('logging', () => {
    it('should log connection status for SSH', async () => {
      await synchronizeToSymitar(defaultConfig);

      expect(mockedCore.info).toHaveBeenCalledWith(expect.stringContaining('Connecting'));
      expect(mockedCore.info).toHaveBeenCalledWith(expect.stringContaining('Connected'));
    });

    it('should log connection status for HTTPS', async () => {
      await synchronizeToSymitar({
        ...defaultConfig,
        connectionType: 'https',
        symitarAppPort: 42627,
      });

      expect(mockedCore.info).toHaveBeenCalledWith(
        expect.stringContaining('https://symitar.example.com:42627'),
      );
    });

    it('should log sync mode and directory type', async () => {
      await synchronizeToSymitar(defaultConfig);

      expect(mockedCore.info).toHaveBeenCalledWith(expect.stringContaining('push'));
      expect(mockedCore.info).toHaveBeenCalledWith(expect.stringContaining('PowerOns'));
    });
  });
});
