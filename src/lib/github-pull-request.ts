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

/** Which REST call failed, and therefore which permission it needed. */
type ApiCall = 'list' | 'create';

/**
 * The permission a call actually requires.
 *
 * Naming `pull-requests: write` on a failed *list* would send the reader after
 * the wrong fix: listing pull requests needs only read access, so a 403 there
 * means the token cannot see the repository's pull requests at all, not that it
 * is missing write.
 */
const REQUIRED_PERMISSION: Record<ApiCall, string> = {
  list: 'pull-requests: read',
  create: 'pull-requests: write',
};

/**
 * Turns an Octokit failure into a message that names the likely cause.
 *
 * The two failures worth distinguishing are both silent-looking from a
 * workflow author's point of view: a token without the permission the call
 * needs (403), and a token that cannot see the repository at all (404).
 *
 * @param error The Octokit failure
 * @param call Which REST call failed
 * @param description Human-readable description of what was being attempted
 * @param cause An earlier error this one displaced, preserved on the result
 */
function describeApiError(
  error: unknown,
  call: ApiCall,
  description: string,
  cause?: unknown,
): Error {
  const status = (error as { status?: number }).status;
  const message = error instanceof Error ? error.message : String(error);
  const permission = REQUIRED_PERMISSION[call];

  const detail =
    status === 403
      ? `${description} was forbidden by the GitHub API (403): ${message}. ` +
        `The github-token needs \`${permission}\`; the default GITHUB_TOKEN ` +
        `only has it when the job grants \`permissions: ${permission}\`.`
      : status === 404
        ? `${description} failed with 404: ${message}. The github-token cannot see ` +
          `${context.repo.owner}/${context.repo.repo}, or lacks repository scope.`
        : `${description} failed: ${message}`;

  // `cause` carries the 422 that sent us back to the list query. It is appended
  // to the message as well as attached, because `core.setFailed` renders only
  // the message - attaching it alone would discard the only evidence of why
  // `create` failed and leave a bare list failure that reads as unrelated.
  const causeMessage =
    cause instanceof Error
      ? cause.message
      : cause === undefined
        ? ''
        : String(cause);

  return new Error(
    causeMessage
      ? `${detail} (while recovering from: ${causeMessage})`
      : detail,
    cause === undefined ? undefined : { cause },
  );
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

  const listDescription = `Listing open pull requests for ${headBranch} -> ${baseBranch}`;
  const createDescription = `Creating a pull request for ${headBranch} -> ${baseBranch}`;

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
    throw describeApiError(error, 'list', listDescription);
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
      throw describeApiError(error, 'create', createDescription);
    }

    // The re-query is wrapped for the same reason the first one is: if it
    // fails, the raw Octokit error would propagate and the 422 - the only
    // evidence of why `create` failed - would be lost. The 422 is carried
    // through as the `cause` either way, so both the "re-query failed" and the
    // "re-query found nothing" branches still report it.
    let raced: GitHubPullRequest | undefined;
    try {
      raced = await findOpenPullRequest(
        octokit,
        owner,
        repo,
        headBranch,
        baseBranch,
      );
    } catch (listError) {
      throw describeApiError(listError, 'list', listDescription, error);
    }

    if (!raced) {
      throw describeApiError(error, 'create', createDescription);
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
