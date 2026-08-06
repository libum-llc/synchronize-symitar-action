import * as core from '@actions/core';

import { getInput, setVariable, warning } from '../task-shim';

jest.mock('@actions/core');

const coreMock = core as jest.Mocked<typeof core>;

describe('task-shim', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getInput', () => {
    it.each([
      ['directoryType', 'directory-type'],
      ['localDirectoryPath', 'local-directory-path'],
      ['connectionType', 'connection-type'],
    ])(
      'reads the %s pipelines input as the %s action input',
      (name, actionName) => {
        coreMock.getInput.mockReturnValue('value');

        expect(getInput(name, true)).toBe('value');
        expect(coreMock.getInput).toHaveBeenCalledWith(actionName, {
          required: true,
        });
      },
    );

    it('defaults to an optional input when required is omitted', () => {
      coreMock.getInput.mockReturnValue('');

      expect(getInput('localDirectoryPath')).toBe('');
      expect(coreMock.getInput).toHaveBeenCalledWith('local-directory-path', {
        required: false,
      });
    });
  });

  describe('warning', () => {
    it('forwards the message to the runner', () => {
      warning('server managed files');

      expect(coreMock.warning).toHaveBeenCalledWith('server managed files');
    });
  });

  describe('setVariable', () => {
    it.each([
      ['outliersCount', 'outliers-count'],
      ['outlierFiles', 'outlier-files'],
      ['pullRequestId', 'pull-request-id'],
      ['pullRequestUrl', 'pull-request-url'],
    ])('publishes %s as the %s action output', (name, outputName) => {
      setVariable(name, '3', false, true);

      expect(coreMock.setOutput).toHaveBeenCalledWith(outputName, '3');
      expect(coreMock.setSecret).not.toHaveBeenCalled();
    });

    it('masks secret values before publishing them', () => {
      setVariable('apiKey', 'super-secret', true, true);

      expect(coreMock.setSecret).toHaveBeenCalledWith('super-secret');
      expect(coreMock.setOutput).toHaveBeenCalledWith(
        'api-key',
        'super-secret',
      );
    });
  });
});
