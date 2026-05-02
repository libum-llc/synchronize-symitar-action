[![GitHub release](https://img.shields.io/github/release/libum-llc/synchronize-symitar-action.svg?style=flat-square)](https://github.com/libum-llc/synchronize-symitar-action/releases/latest)
[![GitHub marketplace](https://img.shields.io/badge/marketplace-synchronize--symitar-blue?logo=github&style=flat-square)](https://github.com/marketplace/actions/synchronize-symitar)
[![CI workflow](https://img.shields.io/github/actions/workflow/status/libum-llc/synchronize-symitar-action/ci.yml?branch=main&label=ci&logo=github&style=flat-square)](https://github.com/libum-llc/synchronize-symitar-action/actions?workflow=ci)

## About
GitHub Action to synchronize a directory on the Jack Henry™ credit union core platform

![Synchronize Symitar Action](.github/synchronize-symitar.png)


___

- [Usage](#usage)
  - [Basic Example](#basic-example)
  - [Using HTTPS Connection](#using-https-connection)
  - [Synchronizing Other Directory Types](#synchronizing-other-directory-types)
  - [Using Mirror Mode](#using-mirror-mode)
  - [Preserving Server-Managed Files](#preserving-server-managed-files)
  - [Pulling Preserved Files Back to Git](#pulling-preserved-files-back-to-git)
  - [Release Pipeline with Environment Approvals](#release-pipeline-with-environment-approvals)
- [List Inputs](#list-inputs)
- [Customizing](#customizing)
  - [Inputs](#inputs)
  - [Outputs](#outputs)
  - [Secrets](#secrets)
- [Contributing](#contributing)

## Usage

### Basic Example

```yaml
name: Deploy PowerOns

on:
  push:
    branches: [main]
    paths:
      - 'REPWRITERSPECS/**'

jobs:
  deploy:
    runs-on: self-hosted
    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Synchronize PowerOns to Symitar
        uses: libum-llc/synchronize-symitar-action@v1
        with:
          directory-type: powerOns
          symitar-hostname: 93.455.43.232
          sym-number: 627
          symitar-user-number: 1995
          symitar-user-password: ${{ secrets.SYMITAR_USER_PASSWORD }}
          ssh-username: libum
          ssh-password: ${{ secrets.SSH_PASSWORD }}
          api-key: ${{ secrets.API_KEY }}
          sync-mode: push
          dry-run: false
          install-poweron-list: MYSPECFILE.PO,ANOTHERSPEC.PO
```

### Using HTTPS Connection

```yaml
jobs:
  deploy:
    runs-on: self-hosted
    steps:
      - name: Synchronize PowerOns via HTTPS
        uses: libum-llc/synchronize-symitar-action@v1
        with:
          directory-type: powerOns
          symitar-hostname: 93.455.43.232
          symitar-app-port: 42627
          sym-number: 627
          symitar-user-number: 1995
          symitar-user-password: ${{ secrets.SYMITAR_USER_PASSWORD }}
          ssh-username: libum
          ssh-password: ${{ secrets.SSH_PASSWORD }}
          api-key: ${{ secrets.API_KEY }}
          connection-type: https
          sync-mode: push
          dry-run: false
```

### Synchronizing Other Directory Types

```yaml
jobs:
  deploy:
    runs-on: self-hosted
    steps:
      - name: Synchronize LetterFiles
        uses: libum-llc/synchronize-symitar-action@v1
        with:
          directory-type: letterFiles
          symitar-hostname: 93.455.43.232
          sym-number: 627
          symitar-user-number: 1995
          symitar-user-password: ${{ secrets.SYMITAR_USER_PASSWORD }}
          ssh-username: libum
          ssh-password: ${{ secrets.SSH_PASSWORD }}
          api-key: ${{ secrets.API_KEY }}
          sync-mode: push
          dry-run: false
```

### Using Mirror Mode

Mirror mode makes Symitar match your local directory exactly, deleting any extra files on Symitar:

```yaml
jobs:
  deploy:
    runs-on: self-hosted
    steps:
      - name: Mirror PowerOns to Symitar
        uses: libum-llc/synchronize-symitar-action@v1
        with:
          directory-type: powerOns
          symitar-hostname: 93.455.43.232
          sym-number: 627
          symitar-user-number: 1995
          symitar-user-password: ${{ secrets.SYMITAR_USER_PASSWORD }}
          ssh-username: libum
          ssh-password: ${{ secrets.SSH_PASSWORD }}
          api-key: ${{ secrets.API_KEY }}
          sync-mode: mirror
          dry-run: false
```

### Preserving Server-Managed Files

Use `preserve-server-files` for files that are generated or forcibly updated by the server. In `push` and `mirror` mode, matched files are left unchanged on Symitar instead of being overwritten or deleted from the repository copy.

```yaml
jobs:
  deploy:
    runs-on: self-hosted
    steps:
      - name: Synchronize PowerOns while preserving server-managed files
        uses: libum-llc/synchronize-symitar-action@v1
        with:
          directory-type: powerOns
          symitar-hostname: 93.455.43.232
          sym-number: 627
          symitar-user-number: 1995
          symitar-user-password: ${{ secrets.SYMITAR_USER_PASSWORD }}
          ssh-username: libum
          ssh-password: ${{ secrets.SSH_PASSWORD }}
          api-key: ${{ secrets.API_KEY }}
          sync-mode: mirror
          dry-run: false
          preserve-server-files: |
            - RD.*
            - PFR.*
```

### Pulling Preserved Files Back to Git

Use `pull-preserved-only` when you want a workflow that only downloads preserved files from Symitar. If `preserve-server-files` is empty, the action exits without pulling anything.

When `commit-pulled-changes` is enabled, the action commits and pushes pulled changes after synchronization. No commit or push is performed during `dry-run`.

```yaml
jobs:
  pull-server-managed:
    runs-on: self-hosted
    permissions:
      contents: write
    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Pull server-managed PowerOns
        uses: libum-llc/synchronize-symitar-action@v1
        with:
          directory-type: powerOns
          symitar-hostname: 93.455.43.232
          sym-number: 627
          symitar-user-number: 1995
          symitar-user-password: ${{ secrets.SYMITAR_USER_PASSWORD }}
          ssh-username: libum
          ssh-password: ${{ secrets.SSH_PASSWORD }}
          api-key: ${{ secrets.API_KEY }}
          sync-mode: pull
          dry-run: false
          preserve-server-files: |
            - RD.*
            - PFR.*
          pull-preserved-only: true
          commit-pulled-changes: true
          commit-branch: main
```

### Release Pipeline with Environment Approvals

For credit unions running both a Stage and a Prod Symitar environment, this pattern uses GitHub Releases as the trigger and gates each deploy behind a required-reviewer approval. Each environment runs a dry-run first (no approval), then a real deploy that requires reviewer sign-off.

**Job graph**

```
release: published
   │
   ▼
[stage-dry-run]   environment: Stage-Preview   (no approval, dry-run: true)
   │
   ▼
[stage-deploy]    environment: Stage           (approval required, dry-run: false)
   │
   ▼
[prod-dry-run]    environment: Prod-Preview    (no approval, dry-run: true)
   │
   ▼
[prod-deploy]     environment: Prod            (approval required, dry-run: false)
```

**Setup requirements**

In repo Settings → Environments, create four environments:

| Environment | Required reviewers | Purpose |
|-------------|--------------------|---------|
| `Stage-Preview` | none | Dry-run preview against Stage Symitar |
| `Stage` | 1+ reviewers | Real deploy to Stage |
| `Prod-Preview` | none | Dry-run preview against Prod Symitar |
| `Prod` | 1+ reviewers | Real deploy to Prod |

Each environment holds its own Symitar credentials as scoped secrets and variables:

| Type | Name | Notes |
|------|------|-------|
| Variable | `SYMITAR_HOSTNAME` | Hostname / IP for that environment's Sym |
| Variable | `SYM_NUMBER` | Sym number |
| Variable | `SYMITAR_USER_NUMBER` | Quest user number |
| Variable | `SYMITAR_APP_PORT` | SymAppServer port (typically `42` + sym number) |
| Variable | `SSH_USERNAME` | AIX SSH username |
| Secret | `SYMITAR_USER_PASSWORD` | Quest user password |
| Secret | `SYMITAR_PASSWORD` | AIX SSH password |
| Secret | `API_KEY` | PowerOn Pipelines API key |

The same secret/variable values go on `Stage-Preview` and `Stage` (one set of Stage credentials, used by both dry-run and deploy). Same for `Prod-Preview` and `Prod`.

**Workflow**

```yaml
name: symitar-release

on:
  release:
    types: [published]
  workflow_dispatch:
    inputs:
      ref:
        description: 'Tag/branch/SHA to deploy'
        required: true
        default: 'main'
      target:
        description: 'Which segment to run'
        type: choice
        required: true
        default: all
        options: [all, stage, prod]

jobs:
  stage-dry-run:
    name: Stage (Dry Run)
    if: github.event_name == 'release' || inputs.target == 'all' || inputs.target == 'stage'
    runs-on: self-hosted
    environment: Stage-Preview
    steps:
      - uses: actions/checkout@v4
        with:
          ref: ${{ github.event.release.tag_name || inputs.ref }}
      - uses: libum-llc/synchronize-symitar-action@v1
        with:
          directory-type: powerOns
          symitar-hostname: ${{ vars.SYMITAR_HOSTNAME }}
          sym-number: ${{ vars.SYM_NUMBER }}
          symitar-user-number: ${{ vars.SYMITAR_USER_NUMBER }}
          symitar-user-password: ${{ secrets.SYMITAR_USER_PASSWORD }}
          symitar-app-port: ${{ vars.SYMITAR_APP_PORT }}
          ssh-username: ${{ vars.SSH_USERNAME }}
          ssh-password: ${{ secrets.SYMITAR_PASSWORD }}
          api-key: ${{ secrets.API_KEY }}
          connection-type: https
          sync-mode: mirror
          dry-run: true
          preserve-server-files: |
            - RD.*
            - PFR.*

  stage-deploy:
    name: Stage (Deploy)
    needs: stage-dry-run
    if: |
      always()
      && (needs.stage-dry-run.result == 'success' || needs.stage-dry-run.result == 'skipped')
      && (github.event_name == 'release' || inputs.target == 'all' || inputs.target == 'stage')
    runs-on: self-hosted
    environment: Stage
    steps:
      - uses: actions/checkout@v4
        with:
          ref: ${{ github.event.release.tag_name || inputs.ref }}
      - uses: libum-llc/synchronize-symitar-action@v1
        with:
          directory-type: powerOns
          symitar-hostname: ${{ vars.SYMITAR_HOSTNAME }}
          sym-number: ${{ vars.SYM_NUMBER }}
          symitar-user-number: ${{ vars.SYMITAR_USER_NUMBER }}
          symitar-user-password: ${{ secrets.SYMITAR_USER_PASSWORD }}
          symitar-app-port: ${{ vars.SYMITAR_APP_PORT }}
          ssh-username: ${{ vars.SSH_USERNAME }}
          ssh-password: ${{ secrets.SYMITAR_PASSWORD }}
          api-key: ${{ secrets.API_KEY }}
          connection-type: https
          sync-mode: mirror
          dry-run: false
          preserve-server-files: |
            - RD.*
            - PFR.*

  prod-dry-run:
    name: Prod (Dry Run)
    needs: stage-deploy
    if: |
      always()
      && (needs.stage-deploy.result == 'success' || needs.stage-deploy.result == 'skipped')
      && (github.event_name == 'release' || inputs.target == 'all' || inputs.target == 'prod')
    runs-on: self-hosted
    environment: Prod-Preview
    steps:
      - uses: actions/checkout@v4
        with:
          ref: ${{ github.event.release.tag_name || inputs.ref }}
      - uses: libum-llc/synchronize-symitar-action@v1
        with:
          directory-type: powerOns
          symitar-hostname: ${{ vars.SYMITAR_HOSTNAME }}
          sym-number: ${{ vars.SYM_NUMBER }}
          symitar-user-number: ${{ vars.SYMITAR_USER_NUMBER }}
          symitar-user-password: ${{ secrets.SYMITAR_USER_PASSWORD }}
          symitar-app-port: ${{ vars.SYMITAR_APP_PORT }}
          ssh-username: ${{ vars.SSH_USERNAME }}
          ssh-password: ${{ secrets.SYMITAR_PASSWORD }}
          api-key: ${{ secrets.API_KEY }}
          connection-type: https
          sync-mode: mirror
          dry-run: true
          preserve-server-files: |
            - RD.*
            - PFR.*

  prod-deploy:
    name: Prod (Deploy)
    needs: prod-dry-run
    if: |
      always()
      && (needs.prod-dry-run.result == 'success' || needs.prod-dry-run.result == 'skipped')
      && (github.event_name == 'release' || inputs.target == 'all' || inputs.target == 'prod')
    runs-on: self-hosted
    environment: Prod
    steps:
      - uses: actions/checkout@v4
        with:
          ref: ${{ github.event.release.tag_name || inputs.ref }}
      - uses: libum-llc/synchronize-symitar-action@v1
        with:
          directory-type: powerOns
          symitar-hostname: ${{ vars.SYMITAR_HOSTNAME }}
          sym-number: ${{ vars.SYM_NUMBER }}
          symitar-user-number: ${{ vars.SYMITAR_USER_NUMBER }}
          symitar-user-password: ${{ secrets.SYMITAR_USER_PASSWORD }}
          symitar-app-port: ${{ vars.SYMITAR_APP_PORT }}
          ssh-username: ${{ vars.SSH_USERNAME }}
          ssh-password: ${{ secrets.SYMITAR_PASSWORD }}
          api-key: ${{ secrets.API_KEY }}
          connection-type: https
          sync-mode: mirror
          dry-run: false
          preserve-server-files: |
            - RD.*
            - PFR.*
```

Cutting a GitHub Release runs the full pipeline. `workflow_dispatch` lets you re-run a single segment (`stage` or `prod`) against any tag, branch, or SHA without cutting a new release. If `stage-deploy` fails, the Prod jobs are skipped automatically.

## List Inputs

`install-poweron-list`, `validate-ignore-list`, and `preserve-server-files` accept either a comma-delimited string or a YAML list (one item per line, optionally `- ` prefixed). YAML list form is recommended when you have more than a handful of entries — it stays readable as the list grows.

```yaml
# Comma-delimited (good for short lists)
preserve-server-files: RD.*, PFR.*

# Multi-line (one item per line)
preserve-server-files: |
  RD.*
  PFR.*

# YAML block-sequence (mirrors poweron.yml conventions)
preserve-server-files: |
  - RD.*
  - PFR.*
```

## Customizing

### Inputs

| Input | Description | Required | Default |
|-------|-------------|----------|---------|
| `directory-type` | Type of Symitar directory: `powerOns`, `letterFiles`, `dataFiles`, `helpFiles` | Yes | - |
| `symitar-hostname` | The endpoint by which you connect to the Symitar host | Yes | - |
| `sym-number` | The directory (aka Sym) number for your connection | Yes | - |
| `symitar-user-number` | Your Symitar Quest user number (just the number) | Yes | - |
| `symitar-user-password` | Your Symitar Quest password (just the password) | Yes | - |
| `ssh-username` | The AIX user name for the Symitar host | Yes | - |
| `ssh-password` | The AIX password for the Symitar host | Yes | - |
| `ssh-port` | The port to connect to the SSH server | No | `22` |
| `api-key` | Your PowerOn Pipelines API Key from [Libum Portal](https://portal.libum.io) | Yes | - |
| `symitar-app-port` | The port which your SymAppServer communicates over. This is typically `42` + `symNumber` | No | - |
| `connection-type` | Connection type: `https` or `ssh` | No | `ssh` |
| `local-directory-path` | Local directory path containing files to synchronize | No | `REPWRITERSPECS/` (powerOns), `LETTERSPECS/` (letterFiles), `DATAFILES/` (dataFiles), `HELPFILES/` (helpFiles) |
| `sync-mode` | Synchronization mode: `push` (upload), `pull` (download), or `mirror` (exact sync) | Yes | - |
| `sync-method` | Transport method for file synchronization: `sftp` or `rsync` | No | `sftp` |
| `sftp-concurrency` | Number of concurrent SFTP transfers (1-20). Only applies when `sync-method` is `sftp` | No | `4` |
| `dry-run` | If `true`, shows proposed changes without applying them | No | `true` |
| `install-poweron-list` | List of PowerOn files to install after sync. Accepts comma-delimited or YAML list — see [List Inputs](#list-inputs). Only applies to `powerOns`. | No | `''` |
| `validate-ignore-list` | List of PowerOn files to skip validation for. Accepts comma-delimited or YAML list — see [List Inputs](#list-inputs). | No | `''` |
| `preserve-server-files` | List of exact filenames or glob patterns where the server copy should be preserved during `push` or `mirror`. Accepts comma-delimited or YAML list — see [List Inputs](#list-inputs). | No | `''` |
| `pull-preserved-only` | When `sync-mode` is `pull`, only pull files matched by `preserve-server-files`. If no preserve files are configured, the action exits without pulling files. | No | `false` |
| `commit-pulled-changes` | When `sync-mode` is `pull`, commit and push pulled workspace changes after synchronization. No commit is created during `dry-run`. | No | `false` |
| `commit-message` | Commit message used when `commit-pulled-changes` is enabled | No | `chore: sync server-managed Symitar files [skip ci]` |
| `commit-branch` | Branch to push the commit to. Defaults to the checked-out branch. | No | `''` |
| `git-user-name` | Git author name used when `commit-pulled-changes` is enabled | No | `libum-bot` |
| `git-user-email` | Git author email used when `commit-pulled-changes` is enabled | No | `bot@libum.io` |
| `debug` | Enable debug logging for Symitar clients | No | `false` |

### Outputs

| Output | Description |
|--------|-------------|
| `files-deployed` | Number of files deployed (added/updated) |
| `files-deleted` | Number of files deleted |
| `files-installed` | Number of PowerOn files installed (only for `powerOns`) |
| `files-uninstalled` | Number of PowerOn files uninstalled (only for `powerOns`) |

### Secrets

The following secrets should be configured in your repository:

- `SYMITAR_USER_PASSWORD` - Your Symitar Quest password (just the password)
- `SSH_PASSWORD` - The AIX password for the Symitar host
- `API_KEY` - Your PowerOn Pipelines API Key from [Libum Portal](https://portal.libum.io)

## Contributing
We at [Libum](https://libum.io) are committed to improving the software development process of Jack Henry™ credit unions. The best way for you to contribute / get involved is communicate ways we can improve the Synchronize Symitar Action feature set.

Please share your thoughts with us through our [Feedback Portal](https://feedback.libum.io), on our [Libum Community](https://discord.gg/libum) Discord, or at [development@libum.io](mailto:development@libum.io)
