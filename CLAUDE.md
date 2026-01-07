# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

GitHub Action to synchronize directories (PowerOns, LetterFiles, DataFiles, HelpFiles) on the Jack Henry Symitar credit union core platform. Supports both SSH and HTTPS connections with push, pull, and mirror sync modes. File transfers can use SFTP (with configurable concurrency) or rsync.

## Commands

```bash
pnpm build          # Build the action (compiles to dist/index.js via ncc)
pnpm test           # Run tests with coverage
pnpm lint           # Check linting and formatting
pnpm lint:fix       # Fix linting and formatting issues
pnpm all            # Run lint:fix, build, and test
```

Run a single test file:
```bash
pnpm test -- __tests__/synchronize.test.ts
```

## Architecture

**Entry Point**: `src/main.ts` - GitHub Action entry point that parses inputs, validates configuration, calls `synchronizeToSymitar()`, and outputs results.

**Core Modules**:
- `src/synchronize.ts` - Main synchronization logic with `synchronizeViaHTTPs()` and `synchronizeViaSSH()` functions using `@libum-llc/symitar` client
- `src/directory-config.ts` - Directory type configuration mapping (powerOns→REPWRITERSPECS, letterFiles→LETTERSPECS, etc.)
- `src/subscription.ts` - API key validation against Libum license server with retry logic

**Key Dependency**: `@libum-llc/symitar` (v1.0.4) provides `SymitarHTTPs` and `SymitarSSH` clients with `syncFiles()` method for file synchronization.

**Client Log Levels**: Clients are initialized with `'warn'` log level by default, `'debug'` when debug input is enabled.

## Environment Variables

- `SST_STAGE_PREFIX` - Stage prefix for development environments
- `IS_SANDBOX=true` - Use sandbox license server
