import * as os from 'os'

export const OCAML_VERSION = '5.4.0'

export const OPAM_DISABLE_SANDBOXING = true

export const DUNE_CACHE = false

export const PLATFORM = os.platform()

export const ARCHITECTURE = os.arch()

export const GITHUB_TOKEN = process.env.GITHUB_TOKEN || ''

export const IS_WINDOWS = PLATFORM === 'win32'
export const IS_MACOS = PLATFORM === 'darwin'
export const IS_LINUX = PLATFORM === 'linux'
