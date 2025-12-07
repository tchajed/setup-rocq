import * as core from '@actions/core'
import * as os from 'os'
import path from 'path'

export const OCAML_VERSION = '5.4.0'

export const OPAM_VERSION = '2.5.0'

export const DUNE_VERSION = '3.20.2'

export const ROCQ_VERSION = core.getInput('rocq-version')

export const PLATFORM = os.platform()

export const ARCHITECTURE = os.arch()

export const DUNE_MAX_CACHE_SIZE = '1000MB'

export const DUNE_CACHE_ROOT = (() => {
  const xdgCacheHome = process.env.XDG_CACHE_HOME
  if (xdgCacheHome) {
    return path.join(xdgCacheHome, 'dune')
  }
  if (PLATFORM === 'win32') {
    return path.join('C:', 'dune')
  }
  return path.join(os.homedir(), '.cache', 'dune')
})()

export const APT_CACHE_DIR = path.join(os.homedir(), '.apt-cache')

export const GITHUB_TOKEN = process.env.GITHUB_TOKEN || ''

export const IS_WINDOWS = PLATFORM === 'win32'
export const IS_MACOS = PLATFORM === 'darwin'
export const IS_LINUX = PLATFORM === 'linux'

// keys for action state
export enum State {
  CachePrimaryKey = 'CACHE_KEY',
  CacheMatchedKey = 'CACHE_RESULT',
}
