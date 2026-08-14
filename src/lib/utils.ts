import * as core from '@actions/core';

/**
 * Input and output names whose `action.yml` spelling is not a plain camelCase
 * to kebab-case transform of the core name.
 */
const INPUT_NAME_OVERRIDES: Record<string, string> = {
  isDryRun: 'dry-run',
  installPowerOns: 'install-poweron-list',
  validateIgnorePowerOns: 'validate-ignore-list',
  // Not `pull-request-description`: the GitHub REST API calls this field
  // `body`, so the action input takes the GitHub-native spelling while core
  // keeps the pipelines-side name. Deliberate - do not "fix" this into a
  // mechanical camel -> kebab transform.
  pullRequestDescription: 'pull-request-body',
};

/**
 * Translates a core (camelCase) input or output name into this action's
 * kebab-case `action.yml` name
 * @param name The camelCase name
 */
export const toActionInputName = (name: string): string =>
  INPUT_NAME_OVERRIDES[name] ??
  name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();

/**
 * Gets the input from the GitHub Actions runner
 * @param name The name of the input
 * @param required Whether the input is required or not
 */
export const getInput = (name: string, required: boolean): string =>
  core.getInput(toActionInputName(name), { required });

/**
 * Gets a boolean input from the GitHub Actions runner, defaulting to false
 * when the input is not set
 * @param name The name of the boolean input
 * @param required Whether the input is required or not
 */
export const getBoolInput = (name: string, required = false): boolean => {
  const inputName = toActionInputName(name);
  if (!core.getInput(inputName, { required })) {
    return false;
  }
  return core.getBooleanInput(inputName);
};

/**
 * Whether the given value is a valid number
 * @param value The value to check
 */
export const isValidNumber = (value: unknown): value is number =>
  typeof value === 'number' && !isNaN(value);
