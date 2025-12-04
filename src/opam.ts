import * as core from '@actions/core'
import * as exec from '@actions/exec'
import * as tc from '@actions/tool-cache'
import * as path from 'path'
import * as os from 'os'
import * as yaml from 'yaml'
import {
  OCAML_VERSION,
  OPAM_DISABLE_SANDBOXING,
  ARCHITECTURE,
  IS_WINDOWS,
  IS_MACOS
} from './constants.js'

const OPAM_VERSION = '2.5.0'

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

export async function acquireOpam(): Promise<void> {
  await core.group('Installing opam', async () => {
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
        ARCHITECTURE
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
  })
}

export async function initializeOpam(): Promise<void> {
  await core.group('Initialising opam', async () => {
    // Set environment variables
    const opamRoot = path.join(os.homedir(), '.opam')
    core.exportVariable('OPAMROOT', opamRoot)
    core.exportVariable('OPAMYES', '1')
    core.exportVariable('OPAMCONFIRMLEVEL', 'unsafe-yes')
    core.exportVariable('OPAMROOTISOK', 'true')

    const args = [
      'init',
      '--bare',
      '--disable-sandboxing',
      '--auto-setup',
      '--enable-shell-hook'
    ]

    if (OPAM_DISABLE_SANDBOXING) {
      core.info('Sandboxing is disabled')
    }

    await exec.exec('opam', args)
  })
}

export async function setupOpam(): Promise<void> {
  await acquireOpam()
  await initializeOpam()
}

export async function createSwitch(): Promise<void> {
  await core.group('Installing OCaml', async () => {
    core.info(`Creating opam switch with OCaml ${OCAML_VERSION}`)
    await exec.exec('opam', [
      'switch',
      'create',
      'default',
      `ocaml-base-compiler.${OCAML_VERSION}`,
      '--yes'
    ])
  })
}

export async function setupOpamEnv(): Promise<void> {
  let output = ''
  const options = {
    listeners: {
      stdout: (data: Buffer) => {
        output += data.toString()
      }
    }
  }

  await exec.exec('opam', ['env'], options)

  // Parse the output and set environment variables
  const lines = output.split('\n')
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

export async function addRepository(name: string, url: string): Promise<void> {
  core.info(`Adding opam repository: ${name} (${url})`)
  await exec.exec('opam', [
    'repository',
    'add',
    'all-switches',
    '--set-default',
    name,
    url,
    '--yes'
  ])
}

export async function setupRepositories(): Promise<void> {
  await core.group('Setting up opam repositories', async () => {
    // Always add rocq-released repository
    await addRepository(
      'rocq-released',
      'https://rocq-prover.org/opam/released'
    )

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
          await addRepository(name, url)
        }
      } catch (error) {
        if (error instanceof Error) {
          core.warning(
            `Failed to parse opam-repositories as YAML: ${error.message}`
          )
        }
      }
    }
  })
}

export async function disableDuneCache(): Promise<void> {
  await core.group('Disabling dune cache', async () => {
    // Create a dune config file that disables caching
    const duneConfigDir = path.join(os.homedir(), '.config', 'dune')
    const duneConfigPath = path.join(duneConfigDir, 'config')

    // Ensure the directory exists
    await exec.exec('mkdir', ['-p', duneConfigDir])

    // Write config to disable cache
    const fs = await import('fs/promises')
    await fs.writeFile(duneConfigPath, '(cache disabled)\n')
    core.info('Dune cache disabled')
  })
}
