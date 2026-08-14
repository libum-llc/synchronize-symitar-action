# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

GitHub Action to synchronize directories (PowerOns, LetterFiles, DataFiles,
HelpFiles) on the Jack Henry Symitar credit union core platform. Supports both
SSH and HTTPS connections with push, pull, and mirror sync modes. File transfers
can use SFTP (with configurable concurrency) or rsync.

## Build Commands

Always use pnpm, never npm.

```bash
pnpm install          # Install dependencies
pnpm build            # Build with ncc to dist/
pnpm test             # Run tests with coverage
pnpm lint             # Check linting and formatting
pnpm lint:fix         # Fix linting and formatting issues
pnpm all              # Run lint:fix, build, and test
```

Run a single test file:
```bash
pnpm test -- src/lib/__tests__/task-orchestration.test.ts
```

## Architecture

**The rule: shared logic lives in `@libum-llc/pipelines-core`; this repo holds
only GitHub-specific wiring.**

The synchronization logic is not written here. It lives in
[`@libum-llc/pipelines-core`](https://github.com/libum-llc/poweron-pipelines/tree/main/packages/core),
a host-agnostic package published to GitHub Packages and shared with the
`poweron-pipelines` Azure DevOps extension and `validate-poweron-action`. Core
owns the `runSynchronizeDirectoryTask` runner, the mutation/snapshot/rollback
transaction machinery, the error hierarchy, the logger, directory-type
resolution, git commit/push helpers, License API subscription checks, and the
config *types*. It imports no CI host SDK and reads no host environment
variables.

What lives here is everything that knows it is running on GitHub Actions: input
parsing, config *loading*, client construction, the `TaskHost` adapter, the
Octokit `PullRequestPublisher`, and the error-to-annotation mapping.

This repo previously carried *vendored copies* of core's modules under
`src/lib/`, kept in sync by hand under a "never edit these, change upstream and
re-vendor" rule, plus a `task-shim.ts` and a `@lib/*` tsconfig alias that let
Azure-shaped imports resolve. All of that is gone. If shared behavior needs to
change, change it in `poweron-pipelines/packages/core`, publish a new version,
and bump the dependency here — do not reintroduce a local copy of a core module,
a task shim, or a path alias.

### Import from the package entrypoint only

```ts
import { runSynchronizeDirectoryTask, type TaskHost } from '@libum-llc/pipelines-core';
```

Never deep-import into `@libum-llc/pipelines-core/dist/...`. `dist/`'s layout is
build output and can change in a patch release; only what core's `src/index.ts`
re-exports is stable. The entrypoint also carries the
`/// <reference types="node" />` directive that makes core's `Buffer`-typed
surface resolve. (One test reads a file under core's `dist/` as *text* to check
this repo's output mapping against what core actually publishes — that is not an
import, and it is commented as such.)

Note that importing the package applies core's module-scope
`https.globalAgent.options.rejectUnauthorized = false`. That is a deliberate,
documented owner decision in core (Symitar hosts commonly present certificates
that fail default verification), not something to work around here.

### `src/lib/github-task-host.ts` — the `TaskHost` adapter

`TaskHost` is core's contract for talking to a CI host — the intersection of
what Azure Pipelines, GitHub Actions, and GitLab CI can all do.
`createGitHubTaskHost()` implements it over `@actions/core`. Two things about it
are load-bearing:

- **Name translation.** Core names inputs and outputs in camelCase
  (`connectionType`, `filesDeployed`, `outliersCount`); `action.yml` spells them
  in kebab-case. Everything crossing this boundary goes through
  `toActionInputName()`.
- **`setOutput` must be a real step output.** Core deliberately leaves Azure's
  `setVariable(name, value, isSecret, isOutput)` flags out of the interface, so
  each adapter supplies its own equivalent. The GitHub equivalent of
  `isOutput: true` is `@actions/core`'s `setOutput`, **not** `exportVariable`.
  Using `exportVariable` writes to `$GITHUB_ENV` instead of `$GITHUB_OUTPUT`:
  the step still succeeds, still logs its summary, and the consuming workflow
  silently reads an empty string. `src/lib/__tests__/github-task-host.test.ts`
  and the end-to-end case in `src/synchronize/dependencies.test.ts` assert
  against real `$GITHUB_OUTPUT` / `$GITHUB_ENV` files precisely because a mocked
  `@actions/core` cannot tell the two apart.

`github-task-host.test.ts` also greps core's compiled runner for its
`setOutput` names and cross-checks all eight against `action.yml`'s `outputs:`
block, so a core release that publishes a new output cannot land silently.

Related: `setSecret` masks whole registered values, not substrings. Never log a
fragment of a secret and expect the mask to catch it — `main.ts` prints only
whether `AuthenticationError.apiKeyPrefix` is present, never its value.

### `src/lib/github-pull-request.ts` — the `PullRequestPublisher`

Core owns *when* a pull request is opened, which branches it spans, and the
reuse-don't-duplicate policy; this file is the Octokit call and the credential
it needs. It is the GitHub counterpart of `poweron-pipelines`'s
`src/lib/azure-pull-request.ts`.

Three things are easy to get wrong:

- **`head` and `base` arrive as `refs/heads/<branch>`**, because that is the
  form the Azure Repos API requires and core normalizes for it. GitHub's pulls
  API wants bare branch names, so `trimBranchRef` strips the prefix here.
- **The list query filters `head` as `owner:branch`.** A bare branch name
  matches nothing, so every run would create a duplicate instead of reusing.
- **A 422 "already exists" from `create` is a reuse signal, not a failure.**
  The list and the create are two round trips; a concurrent run can open one in
  between.

`createPullRequest` is enforced from two directions: `loadSynchronizeConfig`
refuses the run when `github-token` is missing (before Symitar is contacted),
and core throws `InputError` if the input is on and no publisher was supplied —
so `src/synchronize/dependencies.ts` supplies one unconditionally.

### `src/lib/task-orchestration.ts` — config loading

Builds core's `SynchronizeDirectoryConfig` from `action.yml` inputs instead of
from `.poweron-pipelines/config.yml`. Also home to the validations the Azure
extension gets from its `task.json` pick lists and its zod config schema, and
which therefore have to be restored here:

- `connectionType`, `syncMode` and `syncMethod` value checks
- hostname and port format checks, and the `sftp-concurrency` 1-20 range
- `dry-run` is read as a **required** boolean, so an explicitly empty value
  fails the run rather than silently defaulting to a live mutation
- `commitPulledChanges` / `createPullRequest` are pull-mode only and mutually
  exclusive
- `github-token` is required when `create-pull-request` is on
- **`toDirectoryPath()`** — normalizes directory inputs to exactly one trailing
  slash, which core does not guarantee
- **`parseListInput()`** — splits on commas *and* newlines and strips a leading
  `- `. Deliberately more permissive than the Azure extension's comma-only
  parser, because `action.yml` inputs are plain strings and the README has
  documented the multi-line and YAML block-sequence forms since v1. Narrowing it
  would silently collapse a `- RD.*` / `- PFR.*` block into one pattern that
  matches nothing, and every preserved server file would start being overwritten.

It also resolves the two things core refuses to read from the environment:
`sourcePath`/`sourceAbsolutePath`/`workspacePath` (all `GITHUB_WORKSPACE` — a
GitHub Action has no Azure-style artifact staging split) and `tempDirectory`
(`RUNNER_TEMP`, falling back to `os.tmpdir()`).

`SynchronizeActionConfig` extends core's config with `githubToken`, the one
credential core has no field for — the same shape `poweron-pipelines` uses for
`azureDevOpsAccessToken`.

### `src/synchronize/dependencies.ts` — dependency injection

`runSynchronizeDirectoryTask` takes all of its host interactions through a
`SynchronizeDirectoryTaskDependencies` object. This file is the concrete
implementation. It loads the config **once, eagerly**, so the token can reach the
publisher without appearing on a core-owned type and so a bad input fails before
Symitar is contacted.

### `src/main.ts` — the entry point

Masks secret inputs, calls
`runSynchronizeDirectoryTask(createSynchronizeDependencies())`, and maps core's
typed errors (`AuthenticationError`, `ConnectionError`, `InputError`,
`SymNumberError`, `ValidationError`, `ConfigError`, `PowerOnError`) onto
`core.setFailed`/`core.error` with per-error-type detail.

Two things here must not be "simplified":

- **The explicit `process.exit`** in the `require.main === module` block. It is
  load-bearing, not defensive: the Symitar client can leave a handle on the
  event loop, and without it the step hung for 14 minutes *after* logging
  success. `poweron-pipelines` does the same at the end of its `executeTask`.
- **`resolveExitCode` and the `require.main === module` guard itself.** ncc
  rewrites that expression at bundle time; CI's smoke-test step exists to catch
  a future ncc version breaking the rewrite, which would silently turn the
  bundle into a no-op that exits 0.

### `dist/` is committed

`action.yml` ships `dist/index.js`, so the committed bundle — not `src/` — is
what consumers run, and they never run `pnpm install`. Two consequences:

- **`@libum-llc/pipelines-core` and `@libum-llc/symitar` must be inlined by
  ncc.** They are private GitHub Packages dependencies; a leftover runtime
  `require()` would throw `MODULE_NOT_FOUND` for every consumer while passing
  every test here. CI asserts on this, with a sentinel string that only core's
  runner can contribute. Pick such a marker carefully: ncc copies source
  *comments* into the bundle verbatim, so a marker that also appears in a
  comment here would survive an externalized build and make the check vacuous.
  Verify any replacement with
  `pnpm exec ncc build src/main.ts -o <scratch> --external @libum-llc/pipelines-core`
  and confirm the marker count is 0 there.
- **Rebuild and commit `dist/` with any `src/` change.** CI's `Check dist` step
  rebuilds and fails if the committed tree differs. ncc output varies by Node
  major and by pnpm major (hoisting changes what gets bundled), so build with
  the Node and pnpm that CI pins: Node 24 (`.github/workflows/ci.yml`) and the
  pnpm in `package.json`'s `packageManager` field.

### Live integration

`.github/workflows/live-integration.yml` runs the committed bundle against SYM
627 on a self-hosted runner. Two properties are load-bearing and must not be
relaxed:

- **The fork guard** in the job's `if:`. This is a public repo; a job-level
  `if:` is evaluated before a runner is assigned, so a fork's pull request never
  reaches the runner. Never switch the trigger to `pull_request_target`.
- **Every scenario is `dry-run: true`.** Core skips snapshot, mutation and
  verification entirely on a dry run, so the workflow is read-only against the
  live host. Mutating coverage belongs in `poweron-pipelines`' own live suite,
  which owns run-scoped fixtures and recovery scripts.

### Registry auth

`@libum-llc/*` packages come from GitHub Packages. Auth lives in the **global**
`~/.npmrc`; the repo `.gitignore`s `.npmrc` and must not contain one. In CI,
`actions/setup-node` writes the registry config and `NODE_AUTH_TOKEN` supplies
the token.

### Key Dependencies

- `@libum-llc/pipelines-core` — the shared, host-agnostic task runner and
  supporting modules
- `@libum-llc/symitar` — proprietary Symitar client (`SymitarHTTPs`,
  `SymitarSSH`). Core pins this to an **exact** version; keep this repo's
  version identical to core's, or the tree gets two copies and `instanceof`
  checks across them break silently.
- `@actions/core` — GitHub Actions toolkit, reached through
  `github-task-host.ts` and `utils.ts`
- `@actions/github` — Octokit, reached only through `github-pull-request.ts`

### Testing notes

`@libum-llc/pipelines-core` is a real dependency, so a bare
`jest.mock('@libum-llc/pipelines-core', () => ({ ... }))` replaces the error
hierarchy that `main.ts` dispatches on and the helpers core's own runner calls,
which makes suites vacuous rather than failing. Spread `jest.requireActual` and
override only what you mean to stub. The same applies to
`jest.mock('@libum-llc/symitar', ...)`, since core imports it too.
