# Live GitHub Action Integration

The live workflow executes `uses: ./`: the committed `action.yml` and `dist/`
bundle customers receive. It does not rebuild the Action or mock Symitar.
Licensing alone is simulated for `POWERON_PIPELINES_ORG_ID`, as in the Azure
DevOps integration suite. This is not a licensing-entitlement test.

## Configuration and execution

Enable this repository in the `Symitar` runner group. Use the same single runner
for both Actions and the Azure DevOps extension's GitHub live workflows so they
cannot overlap against the shared test console. Repository concurrency groups
alone do not serialize different repositories.

In the `symitar-integration` environment, configure:

- Secrets: `SYMITAR_PASSWORD` and `SYMITAR_USER_PASSWORD` (valid test credentials).
- Variable: `POWERON_PIPELINES_ORG_ID`.
- Approved trust: `SYMITAR_SSH_HOST_KEY`, or the host's approved key already in
  the runner service account's `~/.ssh/known_hosts`. Never automatically accept
  an unknown key. Preflight performs no login.

Relevant trusted branch pushes run the suite and attach results to the PR.
Manual dispatch is also supported. Fork PRs and Dependabot do not run it.
Never blindly rerun a failed job: rerun attempts are blocked. Review the cause
and any remaining fixture journal before a fresh dispatch. No test changes
credentials, injects authentication failures, or retries a failed connection.

The workflow summary and `symitar-live-evidence` artifact contain each scenario's
elapsed milliseconds and outcome. Each Action has a three-minute timeout; this
is a safety ceiling, not a performance target. Failures stop further host calls.

## Coverage

- Repeat a push preview to prove the file remains proposed and undeployed.
- Push one run-owned HELPFILE, then verify an identical push is a no-op.
- Preview preserved-only pulls with no match and a multiline matching list.
- Pull the run-owned file and compare exact bytes, including mixed line endings,
  NUL, and non-UTF-8 bytes. Verify previews wrote nothing locally.
- Independently download the remote file, compare its exact bytes, remove only
  that file, and verify absence. A preflight inventory proves it did not exist
  before the test. No mirror or unrelated-file deletion is permitted.

The fixture verifier installs the exact locked core and SDK using the existing
`NGUYENDON_GITHUB_TOKEN` package/source-read secret. The Action still runs its
committed bundle. The verifier uses the same Symitar connector; there are no
legacy SSH/HTTPS client factories.

If any Action, assertion, or connection fails, cleanup does **not** log in again.
The evidence artifact retains `fixture.json` (exact name, expected checksum,
location, and cleanup state). Review the failure and verify ownership/bytes
before performing targeted recovery. Never restart the whole suite to clean up.

The shared engine's rollback/lifecycle matrix stays in poweron-pipelines. This
suite proves GitHub packaging, inputs, outputs, filtering, dry-run behavior,
and real byte-preserving transfer. Live GitHub PR creation and rsync are not
covered here; PR publishing has offline adapter coverage.
