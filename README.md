[![GitHub release](https://img.shields.io/github/release/libum-llc/synchronize-symitar-action.svg?style=flat-square)](https://github.com/libum-llc/synchronize-symitar-action/releases/latest)
[![GitHub marketplace](https://img.shields.io/badge/marketplace-synchronize--symitar-blue?logo=github&style=flat-square)](https://github.com/marketplace/actions/synchronize-symitar)
[![CI workflow](https://img.shields.io/github/actions/workflow/status/libum-llc/synchronize-symitar-action/ci.yml?branch=main&label=ci&logo=github&style=flat-square)](https://github.com/libum-llc/synchronize-symitar-action/actions?workflow=ci)

## About

GitHub Action to synchronize a directory on the Jack Henry™ credit union core platform

![Synchronize Symitar Action](.github/synchronize-symitar.png)

---

- [Usage](#usage)
  - [Basic Example](#basic-example)
  - [Using HTTPS Connection](#using-https-connection)
  - [Synchronizing Other Directory Types](#synchronizing-other-directory-types)
  - [Using Mirror Mode](#using-mirror-mode)
  - [Preserving Server-Managed Files](#preserving-server-managed-files)
  - [Pulling Preserved Files Back to Git](#pulling-preserved-files-back-to-git)
  - [Drift Detection](#drift-detection)
  - [Release Pipeline with Environment Approvals](#release-pipeline-with-environment-approvals)
- [List Inputs](#list-inputs)
- [Customizing](#customizing)
  - [Inputs](#inputs)
  - [Outputs](#outputs)
  - [Secrets](#secrets)
- [Contributing](#contributing)

## Usage

This action must run on a self-hosted runner with network access to the Symitar host.
The examples below use `runs-on: self-hosted`; if your organization uses runner labels,
include the label for the runner that can reach Symitar.

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

      - name: Synchronize PowerOns
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
```

### Using HTTPS Connection

```yaml
jobs:
  deploy:
    runs-on: self-hosted
    steps:
      - name: Synchronize PowerOns (HTTPS)
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

Supported `directory-type` values are `powerOns`, `letterFiles`, `dataFiles`, and `helpFiles`.
Use `local-directory-path` when your repo path does not match the default for that type.

### Using Mirror Mode

Mirror mode makes Symitar match the local directory, including deleting extra files on Symitar.

```yaml
jobs:
  deploy:
    runs-on: self-hosted
    steps:
      - name: Mirror PowerOns
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

Use `preserve-server-files` for generated or server-managed files. In `push` and `mirror` mode, matching server files are not overwritten or deleted.

```yaml
jobs:
  deploy:
    runs-on: self-hosted
    steps:
      - name: Mirror PowerOns while preserving server-managed files
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

Use `pull-preserved-only` to download only files matched by `preserve-server-files`. Enable `commit-pulled-changes` when the action should commit and push those changes.

```yaml
on:
  workflow_dispatch:
    inputs:
      commit_branch:
        description: Branch to compare against and commit pulled changes to
        type: string
        default: main

jobs:
  pull-server-managed:
    runs-on: self-hosted
    permissions:
      contents: write
    steps:
      - name: Checkout code
        uses: actions/checkout@v4
        with:
          ref: ${{ inputs.commit_branch || 'main' }}

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
          commit-branch: ${{ inputs.commit_branch || 'main' }}
```

When `commit-branch` is set, `actions/checkout` must check out the same branch. Drive both values from the same input or variable so they cannot drift. The action fails if the checked-out branch and `commit-branch` do not match.

For protected branches, set `commit-pulled-changes: false` and open a pull request in a later workflow step.

```yaml
- name: Open PR for pulled changes
  uses: peter-evans/create-pull-request@v7
  with:
    base: main
    branch: chore/symitar-pull
    delete-branch: true
    commit-message: 'chore: sync server-managed Symitar files'
    title: 'chore: sync server-managed Symitar files'
```

### Drift Detection

When `sync-mode: pull` and `pull-preserved-only: true`, the action reports server files that differ from git but do not match `preserve-server-files`. These outliers are not pulled.

```yaml
jobs:
  detect-drift:
    runs-on: self-hosted
    steps:
      - id: pull
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
          pull-preserved-only: true
          preserve-server-files: |
            - RD.*
            - PFR.*

      - name: Fail on server-side drift
        if: steps.pull.outputs.outliers-count != '0'
        run: |
          echo "::error::Server-side drift detected outside preserved patterns"
          echo "Files: ${{ steps.pull.outputs.outlier-files }}"
          exit 1
```

### Release Pipeline with Environment Approvals

For production deployments, use a protected GitHub Environment so releases require approval before the job can reach Symitar.

```yaml
name: Release PowerOns

on:
  workflow_dispatch:
    inputs:
      release_branch:
        description: Branch to deploy
        type: string
        default: main
      dry_run:
        description: Preview changes without writing to Symitar
        type: boolean
        default: true

jobs:
  release:
    runs-on: self-hosted
    environment: production-symitar
    permissions:
      contents: read
    steps:
      - name: Checkout release branch
        uses: actions/checkout@v4
        with:
          ref: ${{ inputs.release_branch || 'main' }}

      - name: Release PowerOns
        uses: libum-llc/synchronize-symitar-action@v1
        with:
          directory-type: powerOns
          symitar-hostname: ${{ vars.SYMITAR_HOSTNAME }}
          sym-number: ${{ vars.SYM_NUMBER }}
          symitar-user-number: ${{ secrets.SYMITAR_USER_NUMBER }}
          symitar-user-password: ${{ secrets.SYMITAR_USER_PASSWORD }}
          ssh-username: ${{ secrets.SSH_USERNAME }}
          ssh-password: ${{ secrets.SSH_PASSWORD }}
          api-key: ${{ secrets.API_KEY }}
          sync-mode: push
          dry-run: ${{ inputs.dry_run }}
          preserve-server-files: |
            - RD.*
            - PFR.*
```

GitHub setup requirements:

- Create a self-hosted runner that can reach the Symitar host over SSH or HTTPS.
- Create a GitHub Environment such as `production-symitar` and configure required reviewers.
- Store non-secret deployment values as environment or repository variables, such as `SYMITAR_HOSTNAME` and `SYM_NUMBER`.
- Store credentials as environment or repository secrets: `SYMITAR_USER_NUMBER`, `SYMITAR_USER_PASSWORD`, `SSH_USERNAME`, `SSH_PASSWORD`, and `API_KEY`.
- Grant only the permissions the workflow needs. A push-only release usually needs `contents: read`; workflows that commit pulled files back need `contents: write`.

## List Inputs

`install-poweron-list`, `validate-ignore-list`, and `preserve-server-files` accept either a comma-delimited string or a YAML list.

```yaml
# Comma-delimited
preserve-server-files: RD.*, PFR.*

# Multi-line
preserve-server-files: |
  RD.*
  PFR.*

# YAML block-sequence
preserve-server-files: |
  - RD.*
  - PFR.*
```

## Customizing

### Inputs

| Input                   | Description                                                                                                       | Required | Default                                              |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------- | -------- | ---------------------------------------------------- |
| `directory-type`        | Type of Symitar directory: `powerOns`, `letterFiles`, `dataFiles`, `helpFiles`                                    | Yes      | -                                                    |
| `symitar-hostname`      | The endpoint by which you connect to the Symitar host                                                             | Yes      | -                                                    |
| `sym-number`            | The directory (aka Sym) number for your connection                                                                | Yes      | -                                                    |
| `symitar-user-number`   | Your Symitar Quest user number                                                                                    | Yes      | -                                                    |
| `symitar-user-password` | Your Symitar Quest password                                                                                       | Yes      | -                                                    |
| `ssh-username`          | The AIX user name for the Symitar host                                                                            | Yes      | -                                                    |
| `ssh-password`          | The AIX password for the Symitar host                                                                             | Yes      | -                                                    |
| `ssh-port`              | The port to connect to the SSH server                                                                             | No       | `22`                                                 |
| `api-key`               | Your PowerOn Pipelines API Key from [Libum Portal](https://portal.libum.io)                                       | Yes      | -                                                    |
| `symitar-app-port`      | SymAppServer port. Typically `42` + `symNumber`                                                                   | No       | -                                                    |
| `connection-type`       | Connection type: `https` or `ssh`                                                                                 | No       | `ssh`                                                |
| `local-directory-path`  | Local directory path containing files to synchronize                                                              | No       | Standard path for the selected directory type        |
| `sync-mode`             | Synchronization mode: `push`, `pull`, or `mirror`                                                                 | Yes      | -                                                    |
| `sync-method`           | Transport method: `sftp` or `rsync`                                                                               | No       | `sftp`                                               |
| `sftp-concurrency`      | Number of concurrent SFTP transfers. Only applies when `sync-method` is `sftp`                                    | No       | `4`                                                  |
| `dry-run`               | Shows proposed changes without applying them                                                                      | No       | `true`                                               |
| `install-poweron-list`  | PowerOn files to install after sync. Accepts comma-delimited or YAML list. Only applies to `powerOns`.            | No       | `''`                                                 |
| `validate-ignore-list`  | PowerOn files to skip validation for. Accepts comma-delimited or YAML list.                                       | No       | `''`                                                 |
| `preserve-server-files` | Exact filenames or glob patterns where the server copy should be preserved. Accepts comma-delimited or YAML list. | No       | `''`                                                 |
| `pull-preserved-only`   | When `sync-mode` is `pull`, only pull files matched by `preserve-server-files`                                    | No       | `false`                                              |
| `commit-pulled-changes` | When `sync-mode` is `pull`, commit and push pulled workspace changes after synchronization                        | No       | `false`                                              |
| `commit-message`        | Commit message used when `commit-pulled-changes` is enabled                                                       | No       | `chore: sync server-managed Symitar files [skip ci]` |
| `commit-branch`         | Branch to push the commit to. Defaults to the checked-out branch.                                                 | No       | `''`                                                 |
| `git-user-name`         | Git author name used when `commit-pulled-changes` is enabled                                                      | No       | `libum-bot`                                          |
| `git-user-email`        | Git author email used when `commit-pulled-changes` is enabled                                                     | No       | `bot@libum.io`                                       |
| `debug`                 | Enable debug logging for Symitar clients                                                                          | No       | `false`                                              |

### Outputs

| Output              | Description                                                                |
| ------------------- | -------------------------------------------------------------------------- |
| `files-deployed`    | Number of files deployed or pulled                                         |
| `files-deleted`     | Number of files deleted                                                    |
| `files-installed`   | Number of PowerOn files installed                                          |
| `files-uninstalled` | Number of PowerOn files uninstalled                                        |
| `outliers-count`    | Number of server files that differ from local but are not preserve-matched |
| `outlier-files`     | JSON array of outlier file names                                           |

### Secrets

The following secrets should be configured in your repository:

- `SYMITAR_USER_PASSWORD` - Your Symitar Quest password
- `SSH_PASSWORD` - The AIX password for the Symitar host
- `API_KEY` - Your PowerOn Pipelines API Key from [Libum Portal](https://portal.libum.io)

## Contributing

We at [Libum](https://libum.io) are committed to improving the software development process of Jack Henry™ credit unions. The best way for you to contribute is to share ways we can improve the Synchronize Symitar Action feature set.

Please share your thoughts with us through our [Feedback Portal](https://feedback.libum.io), on our [Libum Community](https://discord.gg/libum) Discord, or at [development@libum.io](mailto:development@libum.io)
