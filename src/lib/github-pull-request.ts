import { context, getOctokit } from '@actions/github';

import {
  InputError,
  trimBranchRef,
  type OpenPullRequestInput,
  type PullRequestPublisher,
  type PullRequestRef,
} from '@libum-llc/pipelines-core';

/** The shape of a pull request this module reads back from the REST API. */
interface GitHubPullRequest {
  number: number;
  html_url: string;
}

/**
 * Resolves `owner`/`repo` for the repository the action is running in.
 *
 * `@actions/github`'s `context.repo` throws a bare
 * "context.repo requires a GITHUB_REPOSITORY environment variable" when the
 * variable is absent, which says nothing about pull requests; this restates it
 * as an input error naming the feature that needs it.
 */
function resolveRepository(): { owner: string; repo: string } {
  if (!process.env.GITHUB_REPOSITORY) {
    throw new InputError(
      'GITHUB_REPOSITORY is not set, so the repository to open a pull request against cannot be determined. ' +
        'create-pull-request only works inside a GitHub Actions job.',
      'createPullRequest',
    );
  }

  return context.repo;
}

/**
 * Turns an Octokit failure into a message that names the likely cause.
 *
 * The two failures worth distinguishing are both silent-looking from a
 * workflow author's point of view: a token with read-only `pull-requests`
 * scope (403), and a token that cannot see the repository at all (404).
 */
function describeApiError(error: unknown, action: string): Error {
  const status = (error as { status?: number }).status;
  const message = error instanceof Error ? error.message : String(error);

  if (status === 403) {
    return new Error(
      `${action} was forbidden by the GitHub API (403): ${message}. ` +
        'The github-token needs `pull-requests: write`; the default GITHUB_TOKEN ' +
        'only has it when the job grants `permissions: pull-requests: write`.',
    );
  }

  if (status === 404) {
    return new Error(
      `${action} failed with 404: ${message}. The github-token cannot see ` +
        `${context.repo.owner}/${context.repo.repo}, or lacks repository scope.`,
    );
  }

  return new Error(`${action} failed: ${message}`);
}

/**
 * Whether a create failure is GitHub reporting that the pull request already
 * exists, rather than a genuine error.
 *
 * The list query below is authoritative in practice, but it and the create are
 * two round trips: a concurrent run (or a pull request whose head branch was
 * listed under a different owner) can open one in between. GitHub answers the
 * duplicate create with 422 and a message naming the existing head, which is a
 * reuse signal, not a failure.
 */
function isAlreadyExists(error: unknown): boolean {
  const status = (error as { status?: number }).status;
  const message = error instanceof Error ? error.message : String(error);

  return status === 422 && /already exists/i.test(message);
}

async function findOpenPullRequest(
  octokit: ReturnType<typeof getOctokit>,
  owner: string,
  repo: string,
  headBranch: string,
  baseBranch: string,
): Promise<GitHubPullRequest | undefined> {
  // `head` is filtered as `owner:branch`. Passing the bare branch name matches
  // nothing, which would make every run create a duplicate instead of reusing.
  const { data } = await octokit.rest.pulls.list({
    owner,
    repo,
    state: 'open',
    head: `${owner}:${headBranch}`,
    base: baseBranch,
    per_page: 100,
  });

  return data[0];
}

async function openOrReusePullRequest(
  input: OpenPullRequestInput,
  token: string | undefined,
): Promise<PullRequestRef> {
  if (!token || token.trim().length === 0) {
    throw new InputError(
      "The 'github-token' input is required when 'create-pull-request' is enabled",
      'githubToken',
    );
  }

  const { owner, repo } = resolveRepository();
  const octokit = getOctokit(token);
  // Core normalizes both refs to `refs/heads/<branch>` because that is the
  // form the Azure Repos API requires. GitHub's pulls API takes bare branch
  // names (with the owner prefix on `head`), so the prefix comes back off here.
  const headBranch = trimBranchRef(input.head);
  const baseBranch = trimBranchRef(input.base);

  let existing: GitHubPullRequest | undefined;
  try {
    existing = await findOpenPullRequest(
      octokit,
      owner,
      repo,
      headBranch,
      baseBranch,
    );
  } catch (error) {
    throw describeApiError(
      error,
      `Listing open pull requests for ${headBranch} -> ${baseBranch}`,
    );
  }

  if (existing) {
    return { id: existing.number, url: existing.html_url, reused: true };
  }

  try {
    const { data } = await octokit.rest.pulls.create({
      owner,
      repo,
      head: headBranch,
      base: baseBranch,
      title: input.title,
      body: input.body,
    });

    return { id: data.number, url: data.html_url, reused: false };
  } catch (error) {
    if (!isAlreadyExists(error)) {
      throw describeApiError(
        error,
        `Creating a pull request for ${headBranch} -> ${baseBranch}`,
      );
    }

    const raced = await findOpenPullRequest(
      octokit,
      owner,
      repo,
      headBranch,
      baseBranch,
    );

    if (!raced) {
      throw describeApiError(
        error,
        `Creating a pull request for ${headBranch} -> ${baseBranch}`,
      );
    }

    return { id: raced.number, url: raced.html_url, reused: true };
  }
}

/**
 * The GitHub (Octokit) implementation of core's `PullRequestPublisher`.
 *
 * Core owns *when* a pull request is opened, which branches it spans, and the
 * reuse-don't-duplicate policy; everything here is the REST call and the
 * credential it needs. It is the Octokit counterpart of
 * `poweron-pipelines`'s `createAzurePullRequestPublisher`.
 *
 * Nothing is validated eagerly: this factory is called on every synchronize run
 * that enables `create-pull-request`, including dry runs and runs with nothing
 * to commit, which never reach `openOrReuse`. A token problem therefore surfaces
 * from `openOrReuse` — and, earlier and more usefully, from
 * `loadSynchronizeConfig`, which refuses a `create-pull-request` run with no
 * `github-token` before Symitar is contacted at all.
 *
 * @param token The `github-token` input
 */
export function createGitHubPullRequestPublisher(
  token: string | undefined,
): PullRequestPublisher {
  return {
    openOrReuse: (input) => openOrReusePullRequest(input, token),
  };
}
