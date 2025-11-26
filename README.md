[![GitHub release](https://img.shields.io/github/release/libum-llc/synchronize-symitar-action.svg?style=flat-square)](https://github.com/libum-llc/synchronize-symitar-action/releases/latest)
[![GitHub marketplace](https://img.shields.io/badge/marketplace-synchronize--symitar-blue?logo=github&style=flat-square)](https://github.com/marketplace/actions/synchronize-symitar)
[![CI workflow](https://img.shields.io/github/actions/workflow/status/libum-llc/synchronize-symitar-action/ci.yml?branch=main&label=ci&logo=github&style=flat-square)](https://github.com/libum-llc/synchronize-symitar-action/actions?workflow=ci)

## About
GitHub Action to synchronize a directory on the Jack Henry™ credit union core platform

___

- [Usage](#usage)
  - [Basic Example](#basic-example)
  - [Using HTTPS Connection](#using-https-connection)
  - [Synchronizing Other Directory Types](#synchronizing-other-directory-types)
  - [Using Mirror Mode](#using-mirror-mode)
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
    runs-on: ubuntu-latest
    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Synchronize PowerOns to Symitar
        uses: libum-llc/synchronize-symitar-action@v1
        with:
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
- name: Synchronize PowerOns via HTTPS
  uses: libum-llc/synchronize-symitar-action@v1
  with:
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
- name: Mirror PowerOns to Symitar
  uses: libum-llc/synchronize-symitar-action@v1
  with:
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

## Customizing

### Inputs

| Input | Description | Required | Default |
|-------|-------------|----------|---------|
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
| `directory-type` | Type of Symitar directory: `powerOns`, `letterFiles`, `dataFiles`, `helpFiles` | No | `powerOns` |
| `local-directory-path` | Local directory path containing files to synchronize | No | Per type |
| `sync-mode` | Synchronization mode: `push` (upload), `pull` (download), or `mirror` (exact sync) | Yes | - |
| `dry-run` | If `true`, shows proposed changes without applying them | No | `true` |
| `install-poweron-list` | Comma-separated list of PowerOn files to install after sync (only for `powerOns`) | No | `''` |
| `validate-ignore-list` | Comma-separated list of PowerOn files to skip validation for | No | `''` |
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
