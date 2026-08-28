import { readFileSync } from 'fs';
import * as path from 'path';

import {
  getInput,
  getBoolInput,
  isValidNumber,
  toActionInputName,
} from '../utils';

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
 * Every core (camelCase) input name this adapter and core's
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
  ['createPullRequest', 'create-pull-request'],
  ['pullRequestBranch', 'pull-request-branch'],
  ['pullRequestTargetBranch', 'pull-request-target-branch'],
  ['pullRequestTitle', 'pull-request-title'],
  ['pullRequestDescription', 'pull-request-body'],
  ['githubToken', 'github-token'],
  ['skipValidation', 'skip-validation'],
];

/**
 * Inputs `loadSynchronizeConfig` reads that `action.yml` deliberately does not
 * declare.
 *
 * Empty, and the test below keeps it that way: every name the adapter reads is
 * now declared. An undeclared input silently resolves to '' at run time *and*
 * makes the runner warn "Unexpected input(s)" at any consumer that passes it,
 * so a read with no declaration is a bug rather than a feature flag.
 */
const PENDING_ACTION_INPUTS: string[] = [];

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

    // skip-validation is the lever that makes a powerOns scenario safe under
    // dry-run: PowerOn validation ignores isDryRun entirely and writes to
    // REPWRITERSPECS, and `!options.powerOn.skipValidation` is the only term in
    // `shouldValidate` a consumer can control without changing sync mode.
    it('should declare skip-validation, which loadSynchronizeConfig reads', () => {
      expect(readDeclaredActionInputs()).toContain('skip-validation');
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
      // The GitHub REST API calls this field `body`
      [
        'pullRequestDescription',
        'pull-request-description',
        'pull-request-body',
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

    // The full core-output -> action.yml tie-up lives in
    // github-task-host.test.ts; this is the name transform on its own.
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
