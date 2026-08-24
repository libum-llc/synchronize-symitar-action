import {
  validateApiKey,
  type SynchronizeDirectoryTaskDependencies,
} from '@libum-llc/pipelines-core';

import { createGitHubPullRequestPublisher } from '../lib/github-pull-request';
import { createGitHubTaskHost } from '../lib/github-task-host';
import {
  createHTTPsClient,
  createSSHClient,
  loadSynchronizeConfig,
} from '../lib/task-orchestration';

/**
 * Builds the production dependencies for `@libum-llc/pipelines-core`'s
 * SynchronizeDirectory runner.
 *
 * `runSynchronizeDirectoryTask` is host-agnostic and reads nothing from the
 * environment, so every GitHub-specific behaviour has to arrive through this
 * object: the `@actions/core`-backed `TaskHost`, the input loader, the Symitar
 * client factories, and the Octokit `PullRequestPublisher`.
 *
 * The config is loaded here, once, rather than inside the runner, for the same
 * reason the Azure extension does it: the `github-token` is a consumer-owned
 * credential and must reach the publisher without ever appearing on a
 * core-owned type. Loading is still the first thing on the call path and this
 * function is called before the runner starts, so a bad input still fails
 * before Symitar is contacted.
 *
 * The publisher is supplied unconditionally. Core only calls it when the
 * `createPullRequest` input is on — and throws `InputError` if it is on and no
 * publisher was supplied — so passing one always is strictly safer than
 * trying to predict, here, whether the run will need it.
 */
export function createSynchronizeDependencies(): SynchronizeDirectoryTaskDependencies {
  const config = loadSynchronizeConfig();

  return {
    task: createGitHubTaskHost(),
    loadConfig: () => config,
    validateApiKey,
    createHttpsClient: createHTTPsClient,
    createSshClient: createSSHClient,
    pullRequestPublisher: createGitHubPullRequestPublisher(config.githubToken),
  };
}
