import * as core from '@actions/core'
import * as exec from '@actions/exec'
import * as tc from '@actions/tool-cache'
import * as path from 'path'
import * as os from 'os'
import * as yaml from 'yaml'
import * as fs from 'fs'
import {
  OCAML_VERSION,
  OPAM_VERSION,
  ARCHITECTURE,
  IS_WINDOWS,
  IS_MACOS,
  ROCQ_VERSION,
  DUNE_MAX_CACHE_SIZE,
} from './constants.js'

function getOpamUrl(): string {
  if (IS_WINDOWS) {
    return `https://github.com/ocaml/opam/releases/download/${OPAM_VERSION}/opam-${OPAM_VERSION}-x86_64-windows.zip`
  } else if (IS_MACOS) {
    if (ARCHITECTURE === 'arm64') {
      return `https://github.com/ocaml/opam/releases/download/${OPAM_VERSION}/opam-${OPAM_VERSION}-arm64-macos`
    } else {
      return `https://github.com/ocaml/opam/releases/download/${OPAM_VERSION}/opam-${OPAM_VERSION}-x86_64-macos`
    }
  } else {
    // Linux
    return `https://github.com/ocaml/opam/releases/download/${OPAM_VERSION}/opam-${OPAM_VERSION}-x86_64-linux`
  }
}

async function acquireOpam(): Promise<void> {
  const cachedPath = tc.find('opam', OPAM_VERSION, ARCHITECTURE)
  const opam = IS_WINDOWS ? 'opam.exe' : 'opam'

  if (cachedPath === '') {
    const browserDownloadUrl = getOpamUrl()
    let downloadedPath: string

    if (IS_WINDOWS) {
      const zipPath = await tc.downloadTool(browserDownloadUrl)
      const extractedPath = await tc.extractZip(zipPath)
      downloadedPath = path.join(extractedPath, opam)
    } else {
      downloadedPath = await tc.downloadTool(browserDownloadUrl)
    }

    core.info(`Downloaded opam ${OPAM_VERSION} from ${browserDownloadUrl}`)

    const cachedPath = await tc.cacheFile(
      downloadedPath,
      opam,
      'opam',
      OPAM_VERSION,
      ARCHITECTURE,
    )

    core.info(`Successfully cached opam to ${cachedPath}`)

    // Make the binary executable on Unix-like systems
    if (!IS_WINDOWS) {
      const fs = await import('fs/promises')
      await fs.chmod(path.join(cachedPath, opam), 0o755)
    }

    core.addPath(cachedPath)
    core.info('Added opam to the path')
  } else {
    core.addPath(cachedPath)
    core.info('Added cached opam to the path')
  }
}

async function initializeOpam(): Promise<void> {
  // Set environment variables
  const opamRoot = path.join(os.homedir(), '.opam')
  if (core.isDebug()) {
    core.exportVariable('OPAMVERBOSE', 1)
  }
  core.exportVariable('OPAMCOLOR', 'always')
  core.exportVariable('OPAMDOWNLOADJOBS', os.availableParallelism())
  core.exportVariable('OPAMJOBS', os.availableParallelism())
  core.exportVariable('OPAMERRLOGLEN', 0)
  core.exportVariable('OPAMEXTERNALSOLVER', 'builtin-0install')
  core.exportVariable('OPAMPRECISETRACKING', 1)
  core.exportVariable('OPAMRETRIES', 10)
  core.exportVariable('OPAMROOT', opamRoot)
  core.exportVariable('OPAMYES', 1)
  core.exportVariable('OPAMROOTISOK', true)

  if (fs.existsSync(opamRoot)) {
    core.info('already initialized')
    return
  }

  await exec.exec('opam', [
    'init',
    '--bare',
    '--disable-sandboxing',
    '--auto-setup',
    '--enable-shell-hook',
  ])
}

// Parse the stdout of `opam env` (Bourne shell syntax) into variable
// assignments.
//
// opam emits one assignment per line, in either of these shapes:
//
//   VAR='value'; export VAR;
//   export VAR='value'
//
// A single quote inside a value is written the POSIX way, by closing the
// quote, emitting an escaped quote, and reopening: 'a'\''b' is the value
// `a'b`.  Matching the value with [^']* stops at the first of those quotes and
// silently truncates the variable, so match to the last quote on the line
// instead and unescape afterwards.
export function parseOpamEnv(stdout: string): Map<string, string> {
  const vars = new Map<string, string>()
  for (const line of stdout.split('\n')) {
    const match = line.match(
      /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)='(.*)'\s*(?:;\s*export\s+\1\s*;?)?\s*$/,
    )
    if (!match) {
      continue
    }
    const [, varName, rawValue] = match
    vars.set(varName, rawValue.split("'\\''").join("'"))
  }
  return vars
}

// Set environment variables specified by `opam env`.
//
// This has a similar effect to adding `eval $(opam env)` to ~/.profile.
export async function setupOpamEnv(): Promise<void> {
  core.info('setting environment specified by opam env')
  const output = await exec.getExecOutput('opam', ['env'], {
    silent: true,
  })

  for (const [varName, value] of parseOpamEnv(output.stdout)) {
    core.exportVariable(varName, value)

    // Special handling for PATH.  Compare whole entries: a substring test
    // reports a hit for any path that merely contains an existing entry, so a
    // new /usr/local/bin never gets added once /usr/local/bin/foo is present.
    if (varName === 'PATH') {
      const existing = new Set(
        (process.env.PATH ?? '').split(path.delimiter).filter((p) => p !== ''),
      )
      for (const p of value.split(path.delimiter)) {
        if (p && !existing.has(p)) {
          core.addPath(p)
        }
      }
    }
  }
}

export async function setupOpam(): Promise<void> {
  await core.group('Installing opam', async () => {
    await acquireOpam()
    await initializeOpam()
  })
}

// The name of the global switch this action creates and installs Rocq into.
export const SWITCH_NAME = 'default'

async function switchCreate(): Promise<void> {
  await exec.exec('opam', [
    'switch',
    'create',
    SWITCH_NAME,
    `ocaml-base-compiler.${OCAML_VERSION}`,
  ])
}

export async function opamSwitchCreate(): Promise<void> {
  await core.group('Installing OCaml', switchCreate)
}

export async function opamSwitchExists(): Promise<boolean> {
  const output = await exec.getExecOutput(
    'opam',
    ['switch', 'list', '--short'],
    {
      silent: true,
      ignoreReturnCode: true,
    },
  )
  if (output.exitCode !== 0) {
    return false
  }
  return output.stdout
    .split('\n')
    .map((line) => stripAnsi(line).trim())
    .includes(SWITCH_NAME)
}

// A restored cache is not guaranteed to contain a usable switch: the archive
// can be partial, and a fallback cache key can match an archive saved by an
// older version of this action.  main.ts only creates a switch on a cache
// miss, so without this check a bad restore leaves every later opam command
// failing for a reason the log does not explain.
export async function ensureSwitch(): Promise<void> {
  await core.group('Verifying opam switch', async () => {
    if (!(await opamSwitchExists())) {
      core.warning(
        `Restored cache has no "${SWITCH_NAME}" switch; creating one`,
      )
      await switchCreate()
      return
    }

    const ocaml = await opamInstalledVersion('ocaml', SWITCH_NAME)
    if (ocaml === null) {
      core.warning(
        `Switch "${SWITCH_NAME}" has no OCaml compiler installed; recreating it`,
      )
    } else if (ocaml !== OCAML_VERSION) {
      core.warning(
        `Switch "${SWITCH_NAME}" has OCaml ${ocaml}, but ${OCAML_VERSION} was requested; recreating it`,
      )
    } else {
      core.info(`Switch "${SWITCH_NAME}" has the requested OCaml ${ocaml}`)
      return
    }

    await exec.exec('opam', ['switch', 'remove', SWITCH_NAME, '--yes'])
    await switchCreate()
  })
}

export async function opamRepoAdd(name: string, url: string): Promise<void> {
  await exec.exec('opam', [
    'repository',
    'add',
    '--all-switches',
    '--set-default',
    name,
    url,
  ])
}

export async function setupOpamRepositories(): Promise<void> {
  await core.group('Setting up opam repositories', async () => {
    // Always add rocq-released repository
    await opamRepoAdd('rocq-released', 'https://rocq-prover.org/opam/released')
    if (ROCQ_VERSION == 'dev' || ROCQ_VERSION == 'weekly') {
      await opamRepoAdd(
        'rocq-core-dev',
        'https://rocq-prover.github.io/opam/core-dev',
      )
    }

    // Add any additional repositories from input
    const opamReposInput = core.getInput('opam-repositories')
    if (opamReposInput) {
      try {
        const repositoriesYaml = yaml.parse(opamReposInput) as Record<
          string,
          string
        >
        const repositories = Object.entries(repositoriesYaml).reverse()

        for (const [name, url] of repositories) {
          await opamRepoAdd(name, url)
        }
      } catch (error) {
        if (error instanceof Error) {
          core.warning(
            `Failed to parse opam-repositories as YAML: ${error.message}`,
          )
        }
      }
    }
  })
}

export async function configureDune(): Promise<void> {
  const configPath = path.join(os.homedir(), '.config/dune/config')
  await fs.promises.mkdir(path.dirname(configPath), { recursive: true })
  await fs.promises.writeFile(
    configPath,
    '(lang dune 3.20)\n(display short)\n(cache enabled)\n',
  )
}

export async function opamUpdate(): Promise<void> {
  await core.group('Updating opam repositories', async () => {
    await exec.exec('opam', ['update', '--development'])
  })
}

export async function opamInstall(
  pkgs: string | string[],
  options: string[] = [],
): Promise<void> {
  const pkgList = Array.isArray(pkgs) ? pkgs : [pkgs]
  await exec.exec('opam', ['install', ...pkgList, ...options])
}

// initializeOpam exports OPAMCOLOR=always, and opam colorizes even
// single-field queries and --short listings, so escapes have to come off
// before anything parses the output -- even where --color=never is passed.
export function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*m/g, '')
}

// Parse the stdout of `opam show --field installed-version`.  Returns
// null for a package that is not installed, which opam prints as `--`.
export function parseInstalledVersion(stdout: string): string | null {
  const version = stripAnsi(stdout).trim()
  return version === '' || version === '--' ? null : version
}

// The version of `pkg` installed in `switchName` (the current switch when
// omitted), or null if it is not installed -- or opam cannot answer, e.g. for
// an unknown package name or when no switch is selected.
export async function opamInstalledVersion(
  pkg: string,
  switchName?: string,
): Promise<string | null> {
  const switchArgs = switchName ? ['--switch', switchName] : []
  const output = await exec.getExecOutput(
    'opam',
    [
      'show',
      '--color=never',
      '--field',
      'installed-version',
      ...switchArgs,
      pkg,
    ],
    { silent: true, ignoreReturnCode: true },
  )
  if (output.exitCode !== 0) {
    return null
  }
  return parseInstalledVersion(output.stdout)
}

export async function opamPin(
  pkg: string,
  target: string,
  options: string[] = [],
): Promise<void> {
  await exec.exec('opam', [
    'pin',
    'add',
    '--no-action',
    pkg,
    target,
    ...options,
  ])
}

export async function opamList(): Promise<void> {
  await core.group('List installed opam packages', async () => {
    await exec.exec('opam', ['list', '--installed', '--wrap'])
  })
}

export async function opamClean(): Promise<void> {
  await exec.exec('dune', ['cache', 'trim', `--size=${DUNE_MAX_CACHE_SIZE}`])
  await exec.exec('opam', [
    'clean',
    '--all-switches',
    '--download-cache',
    '--untracked',
    '--logs',
    '--unused-repositories',
  ])
}
