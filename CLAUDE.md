<!-- markdownlint-disable -->
# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with
code in this repository.

## Project Overview

This is a GitHub Action that sets up Rocq (formerly Coq) development
environments in CI workflows. It installs opam, OCaml, and configures the
environment for building Rocq projects.

## Key Commands

### Development Workflow

- `npm install` - Install dependencies
- `npm test` - Run tests (uses Jest with experimental VM modules)
- `npm run package` - Bundle TypeScript to JavaScript (must run after source
  changes)
- `npm run bundle` - Format + package in one command
- `npm run all` - Run format, lint, test, coverage, and package
- `npm run local-action` - Test action locally using `@github/local-action`

### Code Quality

- `npm run format:write` - Auto-format code with Prettier
- `npm run format:check` - Check formatting without changes
- `npm run lint` - Run ESLint

**CRITICAL**:

- Always run `npm run format:write` after making code changes
- The `dist/` directory contains transpiled JavaScript and MUST be updated via
  `npm run package` after any changes to `src/`. The CI workflow verifies
  `dist/` is up-to-date.

## Architecture

### Action Execution Flow

The action follows this sequence (see `src/main.ts:run()`):

1. **Cache Restoration** (`cache.ts:restoreCache()`) - Attempts to restore opam
   cache
2. **System Package Installation** (`unix.ts:installSystemPackages()`) -
   Installs required system packages
   - Linux: Disables mandb updates, installs mandatory and optional packages
   - macOS: Installs packages via brew
3. **Opam Setup** (`opam.ts:setupOpam()`) - ALWAYS runs, even on cache hit
   - Acquires opam binary (downloads or uses cached)
   - Initializes opam with `--disable-sandboxing`
4. **Repository Setup** (`opam.ts:setupRepositories()`) - Configures opam repos
   - Always adds `rocq-released` repository
   - Parses YAML input for additional repos
5. **OCaml Installation** (`opam.ts:createSwitch()`) - Only if cache miss
   - Creates switch with OCaml 5.4.0
6. **Environment Setup** (`opam.ts:setupOpamEnv()`) - Sets PATH and env vars
7. **Dune Cache Disable** (`opam.ts:disableDuneCache()`) - Writes dune config
8. **Rocq Installation** (`opam.ts:installRocq()`) - Installs Rocq based on
   version
9. **Post-Action** (`post.ts`) - Saves cache if not restored

### Module Responsibilities

src/main.ts:

- Entry point and orchestration
- Coordinates cache, opam setup, and error handling

src/opam.ts:

- Core opam operations wrapped in `core.group()` for logging
- `setupOpam()` orchestrator (calls `acquireOpam()` + `initializeOpam()`)
- `acquireOpam()`: Downloads/caches opam binary with architecture awareness
- `initializeOpam()`: Runs `opam init --bare --disable-sandboxing`
- `setupRepositories()`: Parses YAML repos input and adds them
- `createSwitch()`: Installs OCaml compiler
- `setupOpamEnv()`: Parses `opam env` and exports variables

src/cache.ts:

- Cache key generation based on platform/arch/OCaml version
- `restoreCache()`: Restores `~/.opam` with fallback keys
- `saveCache()`: Saves cache in post-action (skips if restored)
- Uses `core.saveState()` to track cache status between main/post

src/constants.ts:

- Platform detection (IS_WINDOWS, IS_MACOS, IS_LINUX)
- Fixed OCaml version (5.4.0)
- Configuration flags

src/post.ts:

- Post-action entry point that calls `saveCache()`

src/unix.ts:

- System package installation following setup-ocaml patterns
- `installSystemPackages()`: Installs required system packages based on platform
- Linux: Disables mandb updates, installs mandatory packages (bubblewrap,
  musl-tools, rsync, libgmp-dev, pkg-config) and optional packages when
  available
- macOS: Installs darcs and mercurial via brew
- `isPackageInstallable()`: Checks apt-cache for package availability

### Key Design Patterns

**setup-ocaml Compatibility**: This action mimics setup-ocaml patterns:

- Uses `core.group()` to wrap all operations for collapsible logs
- Opam setup (`acquireOpam()` + `initializeOpam()`) runs even on cache hit
- Repositories parsed as YAML objects, entries reversed before processing
- Opam binary cached with architecture parameter

**Cache Strategy**:

- Cache key includes platform, architecture, and OCaml version
- Fallback keys allow partial matches (same platform, different arch)
- Post-action only saves if cache wasn't restored (avoids duplicates)
- State variables track cache status between main and post actions

**Repository Management**:

- `rocq-released` repo always added automatically
- Additional repos via `opam-repositories` input (YAML format)
- Repos added with `--all-switches --set-default` flags

## Action Inputs

Defined in `action.yml`:

- `rocq-version` (default: 'latest') - Currently unused, planned for future
- `opam-repositories` (optional) - YAML object with additional repos

  ```yaml
  opam-repositories: |
    custom: https://example.com/repo.git
    experimental: https://other.com/repo
  ```

## Testing

Tests use Jest with ESM modules and unstable mocking:

- Mock all external modules (`@actions/core`, `cache`, `opam`)
- Tests in `__tests__/main.test.ts` cover cache hit/miss scenarios
- Fixtures in `__fixtures__/core.ts` provide test doubles
- Run with `NODE_OPTIONS=--experimental-vm-modules`

When adding tests:

- Update `__fixtures__/core.ts` if using new `@actions/core` functions
- Mock module functions before importing the module under test
- Use `jest.unstable_mockModule()` for ESM mocking

## Building for Distribution

Rollup configuration (`rollup.config.ts`) builds two bundles:

- `dist/index.js` - Main action entry point
- `dist/post.js` - Post-action for cache saving

Both use the same plugins (TypeScript, JSON, CommonJS, Node Resolve).

## Commit Messages

Follow conventional format with Claude Code footer:

```txt
<type>: <subject>

<body>

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>
```

Use `git add -A && git commit -m "$(cat <<'EOF' ... EOF)"` for multi-line
messages.
