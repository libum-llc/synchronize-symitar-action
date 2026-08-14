import { getOctokit } from '@actions/github';

import { InputError } from '@libum-llc/pipelines-core';

import { createGitHubPullRequestPublisher } from '../github-pull-request';

const mockList = jest.fn();
const mockCreate = jest.fn();

/**
 * `@actions/github` is mocked rather than reached over the network: the claim
 * under test is the *shape* of the two REST calls and the reuse policy built
 * on top of them, not GitHub's behaviour. `context` is reimplemented over
 * `GITHUB_REPOSITORY` exactly as the real one is, so the "repository cannot be
 * determined" path stays reachable.
 */
jest.mock('@actions/github', () => ({
  getOctokit: jest.fn(() => ({
    rest: { pulls: { list: mockList, create: mockCreate } },
  })),
  context: {
    get repo() {
      const [owner, repo] = (process.env.GITHUB_REPOSITORY || '/').split('/');
      return { owner, repo };
    },
  },
}));

/** An Octokit-shaped failure: an `Error` carrying an HTTP `status`. */
const apiError = (status: number, message: string): Error =>
  Object.assign(new Error(message), { status });

// Core normalizes both refs to `refs/heads/<branch>` before calling the
// publisher, because that is what the Azure Repos API requires.
const INPUT = {
  head: 'refs/heads/chore/symitar-pull',
  base: 'refs/heads/main',
  title: 'chore: sync server-managed Symitar files',
  body: 'Auto-generated pull of server-managed Symitar files.',
};

const TOKEN = 'ghp-test-token';

// The token is always passed explicitly - never defaulted - so that
// `publish(undefined)` really exercises the missing-token path rather than
// silently falling back to a valid one.
const publish = (token: string | undefined) =>
  createGitHubPullRequestPublisher(token).openOrReuse(INPUT);

/** Awaits a publish that must reject, and hands back the Error it rejected with. */
const publishFailure = async (token: string | undefined): Promise<Error> => {
  try {
    await publish(token);
  } catch (error) {
    return error as Error;
  }
  throw new Error('expected openOrReuse to reject, but it resolved');
};

describe('createGitHubPullRequestPublisher', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.GITHUB_REPOSITORY = 'libum-llc/customer-repo';
    mockList.mockResolvedValue({ data: [] });
    mockCreate.mockResolvedValue({
      data: {
        number: 42,
        html_url: 'https://github.com/libum-llc/customer-repo/pull/42',
      },
    });
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('create path', () => {
    it('creates a pull request and reports reused: false', async () => {
      await expect(publish(TOKEN)).resolves.toEqual({
        id: 42,
        url: 'https://github.com/libum-llc/customer-repo/pull/42',
        reused: false,
      });
    });

    it('strips the refs/heads/ prefix core adds for the Azure API', async () => {
      await publish(TOKEN);

      expect(mockCreate).toHaveBeenCalledWith({
        owner: 'libum-llc',
        repo: 'customer-repo',
        head: 'chore/symitar-pull',
        base: 'main',
        title: INPUT.title,
        body: INPUT.body,
      });
    });

    it('authenticates with the supplied token', async () => {
      await publish('ghp-specific-token');

      expect(getOctokit).toHaveBeenCalledWith('ghp-specific-token');
    });
  });

  describe('reuse path', () => {
    // `head` has to be filtered as `owner:branch`. A bare branch name matches
    // nothing, so every run would create a duplicate instead of reusing.
    it('queries open pull requests by owner-qualified head and base', async () => {
      await publish(TOKEN);

      expect(mockList).toHaveBeenCalledWith({
        owner: 'libum-llc',
        repo: 'customer-repo',
        state: 'open',
        head: 'libum-llc:chore/symitar-pull',
        base: 'main',
        per_page: 100,
      });
    });

    it('reuses an existing open pull request and reports reused: true', async () => {
      mockList.mockResolvedValue({
        data: [
          {
            number: 7,
            html_url: 'https://github.com/libum-llc/customer-repo/pull/7',
          },
        ],
      });

      await expect(publish(TOKEN)).resolves.toEqual({
        id: 7,
        url: 'https://github.com/libum-llc/customer-repo/pull/7',
        reused: true,
      });
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it('takes the first match when several are open', async () => {
      mockList.mockResolvedValue({
        data: [
          { number: 7, html_url: 'https://example.com/7' },
          { number: 9, html_url: 'https://example.com/9' },
        ],
      });

      await expect(publish(TOKEN)).resolves.toMatchObject({
        id: 7,
        reused: true,
      });
    });

    // The list and the create are two round trips. A concurrent run can open
    // one in between; GitHub answers the duplicate create with 422.
    it('reuses the racing pull request when create reports it already exists', async () => {
      mockCreate.mockRejectedValue(
        apiError(
          422,
          'A pull request already exists for libum-llc:chore/symitar-pull.',
        ),
      );
      mockList.mockResolvedValueOnce({ data: [] }).mockResolvedValueOnce({
        data: [{ number: 13, html_url: 'https://example.com/13' }],
      });

      await expect(publish(TOKEN)).resolves.toEqual({
        id: 13,
        url: 'https://example.com/13',
        reused: true,
      });
    });

    it('surfaces the 422 when the re-query still finds nothing', async () => {
      mockCreate.mockRejectedValue(
        apiError(422, 'A pull request already exists for somewhere else.'),
      );

      await expect(publish(TOKEN)).rejects.toThrow(/already exists/);
    });

    // The re-query is a second round trip and can fail on its own. If it were
    // unwrapped, a raw Octokit error would propagate and the 422 - the only
    // evidence of why `create` failed - would be discarded.
    it('keeps the 422 in the message when the re-query itself fails', async () => {
      mockCreate.mockRejectedValue(
        apiError(422, 'A pull request already exists for libum-llc:chore.'),
      );
      mockList
        .mockResolvedValueOnce({ data: [] })
        .mockRejectedValueOnce(apiError(500, 'Internal Server Error'));

      const failure = await publishFailure(TOKEN);

      // Both halves are reported: what failed now, and what sent us here.
      expect(failure.message).toMatch(/Listing open pull requests/);
      expect(failure.message).toMatch(
        /while recovering from: A pull request already exists/,
      );
      // And the 422 is attached, not just interpolated.
      expect((failure.cause as Error).message).toMatch(/already exists/);
    });
  });

  describe('failure reporting', () => {
    it('throws InputError without calling the API when the token is missing', async () => {
      await expect(publish(undefined)).rejects.toThrow(InputError);
      expect(getOctokit).not.toHaveBeenCalled();
      expect(mockList).not.toHaveBeenCalled();
    });

    it('throws InputError for a whitespace-only token', async () => {
      await expect(publish('   ')).rejects.toThrow(InputError);
    });

    it('throws InputError when GITHUB_REPOSITORY is unset', async () => {
      delete process.env.GITHUB_REPOSITORY;

      await expect(publish(TOKEN)).rejects.toThrow(InputError);
      expect(mockList).not.toHaveBeenCalled();
    });

    // The permission named has to match the call that failed. Listing pull
    // requests needs only read, so telling the reader they need `write` after a
    // failed list sends them after the wrong fix.
    it('names read, not write, when the list call is forbidden', async () => {
      mockList.mockRejectedValue(apiError(403, 'Resource not accessible'));

      const failure = await publishFailure(TOKEN);

      expect(failure.message).toMatch(/pull-requests: read/);
      expect(failure.message).not.toMatch(/pull-requests: write/);
    });

    it('names write when the create call is forbidden', async () => {
      mockCreate.mockRejectedValue(apiError(403, 'Resource not accessible'));

      await expect(publish(TOKEN)).rejects.toThrow(/pull-requests: write/);
    });

    it('names the repository on a 404', async () => {
      mockList.mockRejectedValue(apiError(404, 'Not Found'));

      await expect(publish(TOKEN)).rejects.toThrow(
        /libum-llc\/customer-repo, or lacks repository scope/,
      );
    });

    it('reports which call failed for an unclassified error', async () => {
      mockCreate.mockRejectedValue(apiError(500, 'Internal Server Error'));

      await expect(publish(TOKEN)).rejects.toThrow(
        /Creating a pull request for chore\/symitar-pull -> main failed/,
      );
    });
  });
});
