import { execFileSync } from 'child_process';
import { readFileSync } from 'fs';
import * as path from 'path';

import {
  getInput,
  getBoolInput,
  getRemoteBranchRef,
  getChangedFilesInDir,
  isValidNumber,
  toActionInputName,
} from '../utils';

// Mock dependencies
jest.mock('child_process');

/**
 * Sets a GitHub Actions input using the runner's `INPUT_<NAME>` convention,
 * where `<NAME>` is the kebab-cased `action.yml` input name.
 */
const setActionInput = (actionInputName: string, value: string): void => {
  process.env[`INPUT_${actionInputName.toUpperCase()}`] = value;
};

const clearActionInputs = (): void => {
  Object.keys(process.env).forEach((key) => {
    if (key.startsWith('INPUT_')) {
      delete process.env[key];
    }
  });
};

/**
 * The `action.yml` input names, read from the real file so the mapping below
 * cannot drift away from what the action actually declares.
 */
const readDeclaredActionInputs = (): string[] => {
  const source = readFileSync(
    path.join(__dirname, '..', '..', '..', 'action.yml'),
    'utf8',
  );
  const inputsBlock = source.split(/^inputs:$/m)[1].split(/^outputs:$/m)[0];

  return [...inputsBlock.matchAll(/^ {2}([a-z0-9-]+):$/gm)].map(
    (match) => match[1],
  );
};

/**
 * Every pipelines (camelCase) input name the adapter and the vendored
 * SynchronizeDirectory runner read, mapped to its `action.yml` spelling.
 */
const INPUT_NAME_MAPPING: Array<[pipelinesName: string, actionName: string]> = [
  ['directoryType', 'directory-type'],
  ['localDirectoryPath', 'local-directory-path'],
  ['connectionType', 'connection-type'],
  ['syncMode', 'sync-mode'],
  ['isDryRun', 'dry-run'],
  ['symitarHostname', 'symitar-hostname'],
  ['symitarAppPort', 'symitar-app-port'],
  ['sshUsername', 'ssh-username'],
  ['sshPassword', 'ssh-password'],
  ['sshPort', 'ssh-port'],
  ['symNumber', 'sym-number'],
  ['symitarUserNumber', 'symitar-user-number'],
  ['symitarUserPassword', 'symitar-user-password'],
  ['apiKey', 'api-key'],
  ['installPowerOns', 'install-poweron-list'],
  ['validateIgnorePowerOns', 'validate-ignore-list'],
  ['preserveServerFiles', 'preserve-server-files'],
  ['pullPreservedOnly', 'pull-preserved-only'],
  ['commitPulledChanges', 'commit-pulled-changes'],
  ['commitMessage', 'commit-message'],
  ['commitBranch', 'commit-branch'],
  ['gitUserName', 'git-user-name'],
  ['gitUserEmail', 'git-user-email'],
  ['syncMethod', 'sync-method'],
  ['sftpConcurrency', 'sftp-concurrency'],
  ['debug', 'debug'],
];

/**
 * Inputs the adapter reads that `action.yml` does not declare yet:
 * `skip-validation` and the pull-request inputs are added alongside the
 * features that consume them.
 */
const PENDING_ACTION_INPUTS = [
  'skip-validation',
  'create-pull-request',
  'pull-request-branch',
  'pull-request-target-branch',
  'pull-request-title',
  'pull-request-description',
];

describe('utils', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    clearActionInputs();
  });

  afterEach(() => {
    clearActionInputs();
  });

  describe('toActionInputName', () => {
    it.each(INPUT_NAME_MAPPING)(
      'should map the %s input to %s',
      (pipelinesName, actionName) => {
        expect(toActionInputName(pipelinesName)).toBe(actionName);
      },
    );

    it('should map every read input to a name action.yml declares', () => {
      const declared = readDeclaredActionInputs();

      // Guards against the regex above silently matching nothing
      expect(declared).toContain('directory-type');
      expect(declared.length).toBeGreaterThan(20);

      INPUT_NAME_MAPPING.forEach(([, actionName]) => {
        expect(declared).toContain(actionName);
      });
    });

    it('should not yet declare the pending inputs in action.yml', () => {
      const declared = readDeclaredActionInputs();

      PENDING_ACTION_INPUTS.forEach((actionName) => {
        expect(declared).not.toContain(actionName);
      });
    });

    it.each([
      // A plain camel -> kebab transform would produce the second value
      ['isDryRun', 'is-dry-run', 'dry-run'],
      ['installPowerOns', 'install-power-ons', 'install-poweron-list'],
      [
        'validateIgnorePowerOns',
        'validate-ignore-power-ons',
        'validate-ignore-list',
      ],
    ])(
      'should override %s rather than transforming it to %s',
      (pipelinesName, naiveName, actionName) => {
        expect(toActionInputName(pipelinesName)).toBe(actionName);
        expect(toActionInputName(pipelinesName)).not.toBe(naiveName);
      },
    );

    it('should leave single-word names unchanged', () => {
      expect(toActionInputName('debug')).toBe('debug');
    });

    it('should kebab-case output names for setOutput mapping', () => {
      expect(toActionInputName('outliersCount')).toBe('outliers-count');
      expect(toActionInputName('outlierFiles')).toBe('outlier-files');
      expect(toActionInputName('pullRequestId')).toBe('pull-request-id');
      expect(toActionInputName('pullRequestUrl')).toBe('pull-request-url');
    });
  });

  describe('getInput', () => {
    it('should read the kebab-cased action input', () => {
      setActionInput('symitar-hostname', 'symitar.example.com');

      expect(getInput('symitarHostname', false)).toBe('symitar.example.com');
    });

    it('should read a multi-word kebab-cased action input', () => {
      setActionInput('symitar-user-password', 'userpass');

      expect(getInput('symitarUserPassword', false)).toBe('userpass');
    });

    it('should read an overridden input name', () => {
      setActionInput('install-poweron-list', 'ONE.PO');

      expect(getInput('installPowerOns', false)).toBe('ONE.PO');
    });

    it('should return an empty string when the input is not set', () => {
      expect(getInput('localDirectoryPath', false)).toBe('');
    });

    it('should trim surrounding whitespace', () => {
      setActionInput('api-key', '  test-api-key  ');

      expect(getInput('apiKey', false)).toBe('test-api-key');
    });

    it('should throw naming the kebab input when a required input is missing', () => {
      expect(() => getInput('apiKey', true)).toThrow(
        'Input required and not supplied: api-key',
      );
    });

    it('should not throw when a required input is present', () => {
      setActionInput('api-key', 'test-api-key');

      expect(getInput('apiKey', true)).toBe('test-api-key');
    });
  });

  describe('getBoolInput', () => {
    it('should return true when the input is "true"', () => {
      setActionInput('debug', 'true');

      expect(getBoolInput('debug', false)).toBe(true);
    });

    it('should return true when the input is "TRUE"', () => {
      setActionInput('debug', 'TRUE');

      expect(getBoolInput('debug', false)).toBe(true);
    });

    it('should return false when the input is "false"', () => {
      setActionInput('debug', 'false');

      expect(getBoolInput('debug', false)).toBe(false);
    });

    it('should return false when the input is not set', () => {
      expect(getBoolInput('debug', false)).toBe(false);
    });

    it('should default required to false and return false when unset', () => {
      expect(getBoolInput('debug')).toBe(false);
    });

    it('should read the overridden dry-run input name', () => {
      setActionInput('dry-run', 'false');

      expect(getBoolInput('isDryRun', true)).toBe(false);
    });

    it('should throw when a required boolean input is unset', () => {
      expect(() => getBoolInput('isDryRun', true)).toThrow(
        'Input required and not supplied: dry-run',
      );
    });

    it('should throw for a value that is not a boolean', () => {
      setActionInput('debug', 'invalid');

      expect(() => getBoolInput('debug', false)).toThrow(TypeError);
    });
  });

  describe('getRemoteBranchRef', () => {
    it('should convert refs/heads/branch to origin/branch', () => {
      expect(getRemoteBranchRef('refs/heads/main')).toBe('origin/main');
    });

    it('should convert refs/heads/feature/test to origin/feature/test', () => {
      expect(getRemoteBranchRef('refs/heads/feature/test')).toBe(
        'origin/feature/test',
      );
    });

    it('should return original ref if not in refs/heads format', () => {
      expect(getRemoteBranchRef('main')).toBe('main');
    });

    it('should handle refs/tags/v1.0.0', () => {
      expect(getRemoteBranchRef('refs/tags/v1.0.0')).toBe('refs/tags/v1.0.0');
    });
  });

  describe('getChangedFilesInDir', () => {
    it('should parse git diff output correctly', () => {
      const gitOutput = `A\tREPWRITERSPECS/NEW.PO
M\tREPWRITERSPECS/MODIFIED.PO
D\tREPWRITERSPECS/DELETED.PO`;

      (execFileSync as jest.Mock).mockReturnValue(gitOutput);

      expect(
        getChangedFilesInDir('refs/heads/main', 'REPWRITERSPECS/'),
      ).toEqual([
        { filePath: 'REPWRITERSPECS/NEW.PO', status: 'added' },
        { filePath: 'REPWRITERSPECS/MODIFIED.PO', status: 'modified' },
        { filePath: 'REPWRITERSPECS/DELETED.PO', status: 'deleted' },
      ]);
    });

    it('should filter files not in the specified directory', () => {
      const gitOutput = `M\tREPWRITERSPECS/FILE1.PO
M\tOTHERDIR/FILE2.PO
M\tREPWRITERSPECS/FILE3.PO`;

      (execFileSync as jest.Mock).mockReturnValue(gitOutput);

      expect(
        getChangedFilesInDir('refs/heads/main', 'REPWRITERSPECS/'),
      ).toEqual([
        { filePath: 'REPWRITERSPECS/FILE1.PO', status: 'modified' },
        { filePath: 'REPWRITERSPECS/FILE3.PO', status: 'modified' },
      ]);
    });

    it('should handle empty git diff output', () => {
      (execFileSync as jest.Mock).mockReturnValue('');

      expect(
        getChangedFilesInDir('refs/heads/main', 'REPWRITERSPECS/'),
      ).toEqual([]);
    });

    it('should invoke git through argv, never a shell string', () => {
      (execFileSync as jest.Mock).mockReturnValue('');

      getChangedFilesInDir('refs/heads/feature', 'REPWRITERSPECS/');

      expect(execFileSync).toHaveBeenCalledWith(
        'git',
        ['diff', '--name-status', 'origin/feature...'],
        { encoding: 'utf-8' },
      );
    });

    it('should not let shell metacharacters in a ref reach a shell', () => {
      (execFileSync as jest.Mock).mockReturnValue('');

      getChangedFilesInDir('refs/heads/a;rm -rf /', 'REPWRITERSPECS/');

      // Passed as a single opaque argv element - never concatenated into a
      // command string a shell would re-parse.
      expect(execFileSync).toHaveBeenCalledWith(
        'git',
        ['diff', '--name-status', 'origin/a;rm -rf /...'],
        { encoding: 'utf-8' },
      );
    });

    // Regression: `git diff --name-status` reports a rename as
    // `R100\tOLD.PO\tNEW.PO`. Taking the first path names the deleted source,
    // which no longer exists on disk.
    it('should take the destination path of a rename, as modified', () => {
      (execFileSync as jest.Mock).mockReturnValue(
        'R100\tREPWRITERSPECS/OLD.PO\tREPWRITERSPECS/NEW.PO',
      );

      expect(
        getChangedFilesInDir('refs/heads/main', 'REPWRITERSPECS/'),
      ).toEqual([{ filePath: 'REPWRITERSPECS/NEW.PO', status: 'modified' }]);
    });

    it('should take the destination path of a copy, as modified', () => {
      (execFileSync as jest.Mock).mockReturnValue(
        'C75\tREPWRITERSPECS/SOURCE.PO\tREPWRITERSPECS/COPY.PO',
      );

      expect(
        getChangedFilesInDir('refs/heads/main', 'REPWRITERSPECS/'),
      ).toEqual([{ filePath: 'REPWRITERSPECS/COPY.PO', status: 'modified' }]);
    });

    it('should filter a rename whose destination is outside the directory', () => {
      (execFileSync as jest.Mock).mockReturnValue(
        'R100\tREPWRITERSPECS/OLD.PO\tOTHERDIR/NEW.PO',
      );

      expect(
        getChangedFilesInDir('refs/heads/main', 'REPWRITERSPECS/'),
      ).toEqual([]);
    });

    it('should map every documented status code to the expected status', () => {
      const gitOutput = `A\tREPWRITERSPECS/ADDED.PO
M\tREPWRITERSPECS/MODIFIED.PO
D\tREPWRITERSPECS/DELETED.PO
R100\tREPWRITERSPECS/OLD.PO\tREPWRITERSPECS/RENAMED.PO
C100\tREPWRITERSPECS/SOURCE.PO\tREPWRITERSPECS/COPIED.PO
T\tREPWRITERSPECS/TYPECHANGED.PO`;

      (execFileSync as jest.Mock).mockReturnValue(gitOutput);

      expect(
        getChangedFilesInDir('refs/heads/main', 'REPWRITERSPECS/'),
      ).toEqual([
        { filePath: 'REPWRITERSPECS/ADDED.PO', status: 'added' },
        { filePath: 'REPWRITERSPECS/MODIFIED.PO', status: 'modified' },
        { filePath: 'REPWRITERSPECS/DELETED.PO', status: 'deleted' },
        { filePath: 'REPWRITERSPECS/RENAMED.PO', status: 'modified' },
        { filePath: 'REPWRITERSPECS/COPIED.PO', status: 'modified' },
        { filePath: 'REPWRITERSPECS/TYPECHANGED.PO', status: 'modified' },
      ]);
    });

    it('should keep spaces in file names intact', () => {
      (execFileSync as jest.Mock).mockReturnValue(
        'M\tREPWRITERSPECS/MY FILE.PO',
      );

      expect(
        getChangedFilesInDir('refs/heads/main', 'REPWRITERSPECS/'),
      ).toEqual([
        { filePath: 'REPWRITERSPECS/MY FILE.PO', status: 'modified' },
      ]);
    });

    it('should drop malformed records with no path', () => {
      (execFileSync as jest.Mock).mockReturnValue(
        'M\nM\tREPWRITERSPECS/FILE.PO',
      );

      expect(
        getChangedFilesInDir('refs/heads/main', 'REPWRITERSPECS/'),
      ).toEqual([{ filePath: 'REPWRITERSPECS/FILE.PO', status: 'modified' }]);
    });
  });

  describe('isValidNumber', () => {
    it('should return true for valid numbers', () => {
      expect(isValidNumber(0)).toBe(true);
      expect(isValidNumber(1)).toBe(true);
      expect(isValidNumber(627)).toBe(true);
      expect(isValidNumber(-1)).toBe(true);
      expect(isValidNumber(3.14)).toBe(true);
    });

    it('should return false for NaN', () => {
      expect(isValidNumber(NaN)).toBe(false);
    });

    it('should return false for non-numbers', () => {
      expect(isValidNumber('123')).toBe(false);
      expect(isValidNumber(null)).toBe(false);
      expect(isValidNumber(undefined)).toBe(false);
      expect(isValidNumber({})).toBe(false);
      expect(isValidNumber([])).toBe(false);
      expect(isValidNumber(true)).toBe(false);
    });

    // The reason loadSynchronizeConfig cannot simply feed Number(input) here:
    // Number('') is 0, which this predicate accepts.
    it('should accept the zero that an empty sym-number would coerce to', () => {
      expect(isValidNumber(Number(''))).toBe(true);
    });

    it('should return true for Infinity', () => {
      expect(isValidNumber(Infinity)).toBe(true);
      expect(isValidNumber(-Infinity)).toBe(true);
    });
  });
});
