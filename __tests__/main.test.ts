import * as core from '@actions/core';

// Mock @actions/core
jest.mock('@actions/core');
const mockedCore = core as jest.Mocked<typeof core>;

// Mock synchronize module
jest.mock('../src/synchronize', () => ({
  synchronizeToSymitar: jest.fn(),
}));

// Mock subscription module
jest.mock('../src/subscription', () => ({
  validateApiKey: jest.fn(),
  AuthenticationError: class AuthenticationError extends Error {
    constructor(
      message: string,
      public readonly apiKey: string,
      public readonly host: string,
    ) {
      super(message);
      this.name = 'AuthenticationError';
    }
  },
  ConnectionError: class ConnectionError extends Error {
    constructor(
      message: string,
      public readonly host: string,
      public readonly port: number,
      public readonly isSSL: boolean,
      public readonly originalError?: Error,
    ) {
      super(message);
      this.name = 'ConnectionError';
    }
  },
}));

// Mock directory-config module
jest.mock('../src/directory-config', () => ({
  isValidDirectoryType: jest.fn((type: string) =>
    ['powerOns', 'letterFiles', 'dataFiles', 'helpFiles'].includes(type),
  ),
  getDirectoryConfig: jest.fn((type: string) => ({
    name: type === 'powerOns' ? 'PowerOns' : type,
    symitarDirectory: 'REPWRITERSPECS',
    defaultPath: 'REPWRITERSPECS/',
    supportsInstall: type === 'powerOns',
  })),
  getLocalDirectoryPath: jest.fn(
    (_type: string, inputPath?: string) => inputPath || 'REPWRITERSPECS/',
  ),
  calculateTotalChanges: jest.fn(() => 4),
}));

import { run } from '../src/main';
import { synchronizeToSymitar } from '../src/synchronize';
import { AuthenticationError, ConnectionError } from '../src/subscription';

const mockedSynchronize = synchronizeToSymitar as jest.MockedFunction<typeof synchronizeToSymitar>;

// Helper function to get default inputs
function getDefaultInputs(): Record<string, string> {
  return {
    'directory-type': 'powerOns',
    'local-directory-path': '',
    'connection-type': 'ssh', // default
    'sync-mode': 'push', // required, no default
    'dry-run': 'false',
    'symitar-hostname': 'symitar.example.com',
    'symitar-app-port': '',
    'ssh-username': 'testuser',
    'ssh-password': 'testpass',
    'ssh-port': '22',
    'sym-number': '627',
    'symitar-user-number': '1',
    'symitar-user-password': 'questpass',
    'api-key': 'test-api-key',
    'install-poweron-list': '',
    'validate-ignore-list': '',
    'preserve-server-files': '',
    'pull-preserved-only': 'false',
    'commit-pulled-changes': 'false',
    'commit-message': '',
    'commit-branch': '',
    'git-user-name': '',
    'git-user-email': '',
    debug: 'false',
  };
}

describe('main', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    // Setup default input values
    mockedCore.getInput.mockImplementation((name: string) => {
      return getDefaultInputs()[name] || '';
    });

    // Setup default successful result
    mockedSynchronize.mockResolvedValue({
      filesDeployed: 2,
      filesDeleted: 1,
      filesInstalled: 1,
      filesUninstalled: 0,
      outliersCount: 0,
      deployedFiles: ['FILE1.PO', 'FILE2.PO'],
      deletedFiles: ['OLD.PO'],
      installedFiles: ['FILE1.PO'],
      uninstalledFiles: [],
      outlierFiles: [],
    });
  });

  it('should successfully synchronize files', async () => {
    await run();

    expect(mockedCore.setOutput).toHaveBeenCalledWith('files-deployed', 2);
    expect(mockedCore.setOutput).toHaveBeenCalledWith('files-deleted', 1);
    expect(mockedCore.setOutput).toHaveBeenCalledWith('files-installed', 1);
    expect(mockedCore.setOutput).toHaveBeenCalledWith('files-uninstalled', 0);
    expect(mockedCore.setOutput).toHaveBeenCalledWith('outliers-count', 0);
    expect(mockedCore.setOutput).toHaveBeenCalledWith('outlier-files', '[]');
  });

  it('should expose outlier outputs and warn when drift is detected', async () => {
    mockedSynchronize.mockResolvedValueOnce({
      filesDeployed: 1,
      filesDeleted: 0,
      filesInstalled: 0,
      filesUninstalled: 0,
      outliersCount: 2,
      deployedFiles: ['RD.A'],
      deletedFiles: [],
      installedFiles: [],
      uninstalledFiles: [],
      outlierFiles: ['MYREPORT.PO', 'OTHER.PO'],
    });

    await run();

    expect(mockedCore.setOutput).toHaveBeenCalledWith('outliers-count', 2);
    expect(mockedCore.setOutput).toHaveBeenCalledWith(
      'outlier-files',
      JSON.stringify(['MYREPORT.PO', 'OTHER.PO']),
    );
    expect(mockedCore.warning).toHaveBeenCalledWith(
      expect.stringContaining('Drift detected: 2 server file(s)'),
    );
  });

  it('should mask sensitive inputs', async () => {
    await run();

    expect(mockedCore.setSecret).toHaveBeenCalledWith('test-api-key');
    expect(mockedCore.setSecret).toHaveBeenCalledWith('questpass');
    expect(mockedCore.setSecret).toHaveBeenCalledWith('testpass');
  });

  it('should validate hostname format', async () => {
    const inputs = getDefaultInputs();
    inputs['symitar-hostname'] = 'invalid hostname!';
    mockedCore.getInput.mockImplementation((name: string) => inputs[name] || '');

    await run();

    expect(mockedCore.setFailed).toHaveBeenCalledWith(
      expect.stringContaining('Invalid hostname format'),
    );
  });

  it('should validate SSH port range', async () => {
    const inputs = getDefaultInputs();
    inputs['ssh-port'] = '99999';
    mockedCore.getInput.mockImplementation((name: string) => inputs[name] || '');

    await run();

    expect(mockedCore.setFailed).toHaveBeenCalledWith(expect.stringContaining('Invalid SSH port'));
  });

  it('should validate directory type', async () => {
    const inputs = getDefaultInputs();
    inputs['directory-type'] = 'invalidType';
    mockedCore.getInput.mockImplementation((name: string) => inputs[name] || '');

    await run();

    expect(mockedCore.setFailed).toHaveBeenCalledWith(
      expect.stringContaining('Invalid directory type'),
    );
  });

  it('should validate connection type', async () => {
    const inputs = getDefaultInputs();
    inputs['connection-type'] = 'ftp';
    mockedCore.getInput.mockImplementation((name: string) => inputs[name] || '');

    await run();

    expect(mockedCore.setFailed).toHaveBeenCalledWith(
      expect.stringContaining('Invalid connection type'),
    );
  });

  it('should validate sync mode', async () => {
    const inputs = getDefaultInputs();
    inputs['sync-mode'] = 'sync';
    mockedCore.getInput.mockImplementation((name: string) => inputs[name] || '');

    await run();

    expect(mockedCore.setFailed).toHaveBeenCalledWith(expect.stringContaining('Invalid sync mode'));
  });

  it('should require symitar-app-port for HTTPS connection', async () => {
    const inputs = getDefaultInputs();
    inputs['connection-type'] = 'https';
    inputs['symitar-app-port'] = '';
    mockedCore.getInput.mockImplementation((name: string) => inputs[name] || '');

    await run();

    expect(mockedCore.setFailed).toHaveBeenCalledWith(
      expect.stringContaining('symitar-app-port is required'),
    );
  });

  it('should validate symitar-app-port range for HTTPS', async () => {
    const inputs = getDefaultInputs();
    inputs['connection-type'] = 'https';
    inputs['symitar-app-port'] = '99999';
    mockedCore.getInput.mockImplementation((name: string) => inputs[name] || '');

    await run();

    expect(mockedCore.setFailed).toHaveBeenCalledWith(
      expect.stringContaining('Invalid Symitar app port'),
    );
  });

  it('should validate sym number range', async () => {
    const inputs = getDefaultInputs();
    inputs['sym-number'] = '10000';
    mockedCore.getInput.mockImplementation((name: string) => inputs[name] || '');

    await run();

    expect(mockedCore.setFailed).toHaveBeenCalledWith(
      expect.stringContaining('Invalid sym number'),
    );
  });

  it('should handle AuthenticationError', async () => {
    mockedSynchronize.mockRejectedValue(
      new AuthenticationError('API key invalid', 'test-key', 'license.libum.io'),
    );

    await run();

    expect(mockedCore.setFailed).toHaveBeenCalledWith(
      expect.stringContaining('API key validation failed'),
    );
  });

  it('should handle ConnectionError', async () => {
    mockedSynchronize.mockRejectedValue(
      new ConnectionError('Connection refused', 'symitar.example.com', 22, false),
    );

    await run();

    expect(mockedCore.setFailed).toHaveBeenCalledWith(
      expect.stringContaining('Failed to connect to license server'),
    );
  });

  it('should handle generic Error', async () => {
    mockedSynchronize.mockRejectedValue(new Error('Something went wrong'));

    await run();

    expect(mockedCore.setFailed).toHaveBeenCalledWith('Something went wrong');
  });

  it('should parse install-poweron-list correctly', async () => {
    const inputs = getDefaultInputs();
    inputs['install-poweron-list'] = 'FILE1.PO, FILE2.PO, FILE3.PO';
    mockedCore.getInput.mockImplementation((name: string) => inputs[name] || '');

    await run();

    expect(mockedSynchronize).toHaveBeenCalledWith(
      expect.objectContaining({
        installPowerOnList: ['FILE1.PO', 'FILE2.PO', 'FILE3.PO'],
      }),
    );
  });

  it('should parse validate-ignore-list correctly', async () => {
    const inputs = getDefaultInputs();
    inputs['validate-ignore-list'] = 'TEST.PO, SKIP.PO';
    mockedCore.getInput.mockImplementation((name: string) => inputs[name] || '');

    await run();

    expect(mockedSynchronize).toHaveBeenCalledWith(
      expect.objectContaining({
        validateIgnoreList: ['TEST.PO', 'SKIP.PO'],
      }),
    );
  });

  it('should parse preserve-server-files correctly', async () => {
    const inputs = getDefaultInputs();
    inputs['preserve-server-files'] = 'RD.*, PFR.*';
    mockedCore.getInput.mockImplementation((name: string) => inputs[name] || '');

    await run();

    expect(mockedSynchronize).toHaveBeenCalledWith(
      expect.objectContaining({
        preserveServerFiles: ['RD.*', 'PFR.*'],
      }),
    );
  });

  it('should parse multi-line list inputs (newline-delimited)', async () => {
    const inputs = getDefaultInputs();
    inputs['preserve-server-files'] = 'RD.*\nPFR.*\n';
    inputs['validate-ignore-list'] = 'TEST.PO\nSKIP.PO';
    inputs['install-poweron-list'] = 'A.PO,B.PO\nC.PO';
    mockedCore.getInput.mockImplementation((name: string) => inputs[name] || '');

    await run();

    expect(mockedSynchronize).toHaveBeenCalledWith(
      expect.objectContaining({
        preserveServerFiles: ['RD.*', 'PFR.*'],
        validateIgnoreList: ['TEST.PO', 'SKIP.PO'],
        installPowerOnList: ['A.PO', 'B.PO', 'C.PO'],
      }),
    );
  });

  it('should parse YAML block-sequence list inputs (- prefixed)', async () => {
    const inputs = getDefaultInputs();
    inputs['preserve-server-files'] = '- RD.*\n- PFR.*\n';
    inputs['validate-ignore-list'] = '  - ASCIICHAR.DATA\n  - RB.SYNERGY.AP.INDEX.ASCIIDATA';
    mockedCore.getInput.mockImplementation((name: string) => inputs[name] || '');

    await run();

    expect(mockedSynchronize).toHaveBeenCalledWith(
      expect.objectContaining({
        preserveServerFiles: ['RD.*', 'PFR.*'],
        validateIgnoreList: ['ASCIICHAR.DATA', 'RB.SYNERGY.AP.INDEX.ASCIIDATA'],
      }),
    );
  });

  it('should pass sym number as integer', async () => {
    const inputs = getDefaultInputs();
    inputs['sym-number'] = '7';
    mockedCore.getInput.mockImplementation((name: string) => inputs[name] || '');

    await run();

    expect(mockedSynchronize).toHaveBeenCalledWith(
      expect.objectContaining({
        symNumber: 7,
      }),
    );
  });

  it('should pass correct config for HTTPS connection', async () => {
    const inputs = getDefaultInputs();
    inputs['connection-type'] = 'https';
    inputs['symitar-app-port'] = '42627';
    mockedCore.getInput.mockImplementation((name: string) => inputs[name] || '');

    await run();

    expect(mockedSynchronize).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionType: 'https',
        symitarAppPort: 42627,
      }),
    );
  });

  it('should pass sync mode correctly', async () => {
    const inputs = getDefaultInputs();
    inputs['sync-mode'] = 'mirror';
    mockedCore.getInput.mockImplementation((name: string) => inputs[name] || '');

    await run();

    expect(mockedSynchronize).toHaveBeenCalledWith(
      expect.objectContaining({
        syncMode: 'mirror',
      }),
    );
  });

  it('should pass directory type correctly', async () => {
    const inputs = getDefaultInputs();
    inputs['directory-type'] = 'letterFiles';
    mockedCore.getInput.mockImplementation((name: string) => inputs[name] || '');

    await run();

    expect(mockedSynchronize).toHaveBeenCalledWith(
      expect.objectContaining({
        directoryType: 'letterFiles',
      }),
    );
  });
});
