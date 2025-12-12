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

// Set environment variables specified by `opam env`.
//
// This has a similar effect to adding `eval $(opam env)` to ~/.profile.
export async function setupOpamEnv(): Promise<void> {
  core.info('setting environment specified by opam env')
  const output = await exec.getExecOutput('opam', ['env'], {
    silent: true,
  })

  // Parse the output and set environment variables
  const lines = output.stdout.split('\n')
  for (const line of lines) {
    // Look for export statements like: export VAR='value'
    const match = line.match(/^(?:export\s+)?([A-Z_]+)='([^']*)'/)
    if (match) {
      const [, varName, value] = match
      core.exportVariable(varName, value)

      // Special handling for PATH
      if (varName === 'PATH') {
        const paths = value.split(path.delimiter)
        for (const p of paths) {
          if (p && !process.env.PATH?.includes(p)) {
            core.addPath(p)
          }
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

export async function opamSwitchCreate(): Promise<void> {
  await core.group('Installing OCaml', async () => {
    await exec.exec('opam', [
      'switch',
      'create',
      'default',
      `ocaml-base-compiler.${OCAML_VERSION}`,
    ])
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
  pkg: string,
  options: string[] = [],
): Promise<void> {
  await exec.exec('opam', ['install', pkg, ...options])
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
