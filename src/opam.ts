import * as core from '@actions/core'
import * as exec from '@actions/exec'
import * as tc from '@actions/tool-cache'
import * as path from 'path'
import * as os from 'os'
import {
  OCAML_VERSION,
  OPAM_DISABLE_SANDBOXING,
  ARCHITECTURE,
  IS_WINDOWS,
  IS_MACOS
} from './constants.js'

const OPAM_VERSION = '2.2.1'

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

export async function acquireOpam(): Promise<string> {
  const url = getOpamUrl()
  core.info(`Downloading opam from ${url}`)

  let opamPath: string

  if (IS_WINDOWS) {
    const downloadPath = await tc.downloadTool(url)
    const extractedPath = await tc.extractZip(downloadPath)
    opamPath = path.join(extractedPath, 'opam.exe')
  } else {
    opamPath = await tc.downloadTool(url)
    // Make the binary executable
    await exec.exec('chmod', ['+x', opamPath])
  }

  // Cache the tool
  const cachedPath = await tc.cacheFile(
    opamPath,
    IS_WINDOWS ? 'opam.exe' : 'opam',
    'opam',
    OPAM_VERSION
  )

  core.addPath(cachedPath)
  return cachedPath
}

export async function initializeOpam(): Promise<void> {
  core.info('Initializing opam')

  // Set environment variables
  const opamRoot = path.join(os.homedir(), '.opam')
  core.exportVariable('OPAMROOT', opamRoot)
  core.exportVariable('OPAMYES', '1')
  core.exportVariable('OPAMCONFIRMLEVEL', 'unsafe-yes')

  const args = ['init', '--bare', '--disable-sandboxing']

  if (OPAM_DISABLE_SANDBOXING) {
    core.info('Sandboxing is disabled')
  }

  await exec.exec('opam', args)
}

export async function createSwitch(): Promise<void> {
  core.info(`Creating opam switch with OCaml ${OCAML_VERSION}`)
  await exec.exec('opam', [
    'switch',
    'create',
    'default',
    `ocaml-base-compiler.${OCAML_VERSION}`,
    '--yes'
  ])
}

export async function setupOpamEnv(): Promise<void> {
  core.info('Setting up opam environment')

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

export async function disableDuneCache(): Promise<void> {
  core.info('Disabling dune cache')
  // Create a dune config file that disables caching
  const duneConfigDir = path.join(os.homedir(), '.config', 'dune')
  const duneConfigPath = path.join(duneConfigDir, 'config')

  // Ensure the directory exists
  await exec.exec('mkdir', ['-p', duneConfigDir])

  // Write config to disable cache
  const fs = await import('fs/promises')
  await fs.writeFile(duneConfigPath, '(cache disabled)\n')
}
