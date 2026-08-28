# Changelog

## v2.0.0

The synchronization logic is no longer implemented in this repository. It now
comes from [`@libum-llc/pipelines-core`](https://github.com/libum-llc/poweron-pipelines/tree/main/packages/core),
the host-agnostic package shared with the PowerOn Pipelines Azure DevOps
extension and `validate-poweron-action`, and this repo holds only the
GitHub-specific wiring around it. The repository was carrying both a pre-v2
implementation and an abandoned vendoring attempt; both are gone, −4,650 lines
under `src/`.

**No input or output was removed, renamed, or given a different default.** An
existing v1 workflow keeps working after you change `@v1` to `@v2`, with the
one exception below. The major bump exists because `publish.yml` force-moves
the `v1` tag on every release: shipping a wholly different implementation to
`@v1` consumers with no opt-in is what the new major avoids.

### Breaking change

**Boolean inputs are strict.** `dry-run`, `skip-validation`,
`pull-preserved-only`, `commit-pulled-changes`, `create-pull-request` and
`debug` are parsed with `@actions/core`'s `getBooleanInput`, which accepts only
`true`, `True`, `TRUE`, `false`, `False` and `FALSE`. v1 compared the raw string
to `'true'`, so every other spelling silently meant `false`. Two consequences:

- `yes`, `1`, `on` now **fail the step** instead of being read as `false`.
  Loud, and easy to fix.
- `TRUE` and `True` **flip from `false` to `true`** — silent, so this is the one
  to grep for. `dry-run: True` was a *live* run under v1 and is a dry run under
  v2, which is harmless. `skip-validation: TRUE` and `pull-preserved-only: TRUE`
  flip the other way: inert in v1, and now actually in effect, changing what
  gets validated and what gets pulled.

Search your workflows for those six inputs and confirm every value is lowercase
`true` or `false`.

### New

- **Pull-request creation.** `create-pull-request` commits pulled changes to
  `pull-request-branch` and opens — or reuses — a pull request into
  `pull-request-target-branch`, instead of pushing to `commit-branch`. Adds
  `pull-request-branch`, `pull-request-target-branch`, `pull-request-title`,
  `pull-request-body` and `github-token`, plus the `pull-request-id` and
  `pull-request-url` outputs.
- **`skip-validation`** for pushes and mirrors of `powerOns`.

### Also changed

- **Synchronization is transactional.** Core snapshots the files a run is about
  to mutate and restores them if the run fails partway, instead of leaving the
  host half-synchronized.
- **Failure messages and log output differ.** Core uses a typed error hierarchy
  and a structured logger, so the text job summaries and log greps see has
  changed. Which runs fail did not change.
- **The action runs on Node 24.** GitHub already executes `node20` actions on
  Node 24; declaring it removes the deprecation warning.
- **`symitar-app-port` is required up front when `connection-type` is `https`.**
  It was previously discovered missing only after the API-key check and after an
  SSH session had been opened on the host — which then leaked, because the
  matching teardown never ran.
- **`sym-number` is bounded** to a whole number between 0 and 999.
- **`pull-request-target-branch` falls back only to a real branch.** On a
  `pull_request` or tag build it now fails on input validation rather than
  calling `pulls.create` with a base that does not exist.
- **The six file-count outputs are not published when a run aborts** before the
  synchronization completes. v1 set them regardless.

### Explicitly unchanged

- **List inputs still accept commas, newlines and YAML block sequences.**
  `preserve-server-files`, `install-poweron-list` and `validate-ignore-list` are
  parsed exactly as v1 parsed them. A comma-only parser was tried and reverted:
  it would not have errored on a multi-line value, it would have produced one
  entry matching nothing, and every preserved server file would have started
  being overwritten on the next push.
- **`connection-type` still defaults to `ssh`.**
