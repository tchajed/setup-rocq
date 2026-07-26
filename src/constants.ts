import * as core from '@actions/core'
import * as os from 'os'
import path from 'path'

export const DEFAULT_OCAML_VERSION = '5.4.0'

export const OCAML_VERSION =
  core.getInput('ocaml-version') || DEFAULT_OCAML_VERSION

export const OPAM_VERSION = '2.5.2'

// The dune version installed into a fresh switch.  This is a floor, not
// a pin: a restored cache whose switch already has a newer dune keeps
// that dune, because a downgrade forces a recompile of every package
// built with dune -- all of Rocq.  See installDune() in rocq.ts.
export const DUNE_VERSION = '3.22.1'

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
  // Set by the main action once the switch is fully set up and Rocq is
  // installed.  The post action refuses to save a cache without it.
  SetupComplete = 'SETUP_COMPLETE',
}

// action outputs
export enum Output {
  CacheHit = 'cache-hit',
  CachePrimaryKey = 'cache-primary-key',
  CacheMatchedKey = 'cache-matched-key',
  RocqVersion = 'rocq-version',
  OCamlVersion = 'ocaml-version',
  OpamSwitchPrefix = 'opam-switch-prefix',
}
