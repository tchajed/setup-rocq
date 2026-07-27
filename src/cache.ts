import * as core from '@actions/core'
import * as glob from '@actions/glob'
import * as cache from '@actions/cache'
import * as exec from '@actions/exec'
import * as path from 'path'
import * as os from 'os'
import * as fs from 'fs/promises'
import {
  PLATFORM,
  ARCHITECTURE,
  ROCQ_VERSION,
  OCAML_VERSION,
  OPAM_VERSION,
  DUNE_VERSION,
  DEFAULT_DUNE_VERSION,
  IS_LINUX,
  State,
  DUNE_CACHE_ROOT,
  APT_CACHE_DIR,
} from './constants.js'
import { opamClean } from './opam.js'
import { getPinnedRocqCacheKeyPart, getPinnedRocqPackages } from './rocq-pin.js'
import { getRocqWeeklyDir } from './rocq.js'
import { getMondayDate } from './weekly.js'

export const CACHE_VERSION = 'v4'

// The opam root's on-disk format is tied to opam's major.minor, so a cache
// saved by a different opam series should not be restored into this one.
const OPAM_SERIES = OPAM_VERSION.split('.').slice(0, 2).join('.')

// The switch's compiler and the opam root format both have to be part of every
// key, including the fallback prefixes.  main.ts only creates a switch on a
// cache miss, so a cache that is allowed to match across OCaml versions pins
// the switch to whatever compiler it was built with -- bumping OCAML_VERSION
// would then have no effect at all.
// The requested dune floor, for the same reason the OCaml version is in the
// key: installDune() keeps a restored switch's dune when it already meets the
// floor, so a key that matched across dune versions would let an old cache
// pin dune to whatever it was built with and make raising `dune-version` a
// no-op.  It has to be in the fallback prefixes too, not just the primary key.
//
// The default is spelled as no segment at all rather than `-dune-3.22.1`.
// Every cache in existence was written by a run whose floor was the default,
// so this keeps them all restorable; naming the default explicitly would
// invalidate every cache in every repository using this action, which is a
// steep price for a cosmetically more uniform key.
export function duneCacheKeyPart(duneVersion: string): string {
  return duneVersion === DEFAULT_DUNE_VERSION ? '' : `-dune-${duneVersion}`
}

export const CACHE_PLATFORM_PREFIX = `setup-rocq-${CACHE_VERSION}-${PLATFORM}-${ARCHITECTURE}-ocaml-${OCAML_VERSION}-opam-${OPAM_SERIES}${duneCacheKeyPart(DUNE_VERSION)}`

async function getRocqVersionCacheKey(): Promise<string> {
  const pinnedRocqCacheKey = await getPinnedRocqCacheKeyPart()
  if (pinnedRocqCacheKey) {
    return `${CACHE_PLATFORM_PREFIX}-rocq-pinned-${pinnedRocqCacheKey}`
  }

  let cacheKey = `${CACHE_PLATFORM_PREFIX}-rocq-${ROCQ_VERSION}`
  if (ROCQ_VERSION === 'weekly') {
    const date = getMondayDate().toISOString().split('T')[0]
    cacheKey += `-${date}`
  }
  return cacheKey
}

async function getCacheKey(): Promise<string> {
  const cacheKeyFiles = core.getInput('cache-key-opam-files')
  let cacheKey = await getRocqVersionCacheKey()
  const depHash = await glob.hashFiles(cacheKeyFiles)
  cacheKey += `-${depHash}`
  return cacheKey
}

function getOpamRoot(): string {
  return path.join(os.homedir(), '.opam')
}

async function getCachePaths(): Promise<string[]> {
  const paths = [getOpamRoot(), DUNE_CACHE_ROOT]
  const pinnedRocqPackages = await getPinnedRocqPackages()

  // For weekly version, also cache the directory with cloned repositories
  if (ROCQ_VERSION === 'weekly' && pinnedRocqPackages.length === 0) {
    paths.push(getRocqWeeklyDir())
  }

  // On Linux, cache apt packages in user-accessible directory
  if (IS_LINUX) {
    paths.push(APT_CACHE_DIR)
  }

  return paths
}

async function copyDirectory(
  src: string,
  dest: string,
  excludes: string[] = [],
): Promise<void> {
  await fs.mkdir(dest, { recursive: true })

  const entries = await fs.readdir(src, { withFileTypes: true })

  for (const entry of entries) {
    if (excludes.includes(entry.name)) {
      continue
    }

    const srcPath = path.join(src, entry.name)
    const destPath = path.join(dest, entry.name)

    if (entry.isDirectory()) {
      await copyDirectory(srcPath, destPath, excludes)
    } else if (entry.isFile() || entry.isSymbolicLink()) {
      try {
        await fs.copyFile(srcPath, destPath)
      } catch (error) {
        // Skip files we can't copy (permission issues)
        core.debug(`Skipped copying ${srcPath}: ${error}`)
      }
    }
  }
}

async function copyAptCache(): Promise<void> {
  if (!IS_LINUX) {
    return
  }

  const archivesDir = path.join(APT_CACHE_DIR, 'archives')
  const listsDir = path.join(APT_CACHE_DIR, 'lists')
  await fs.mkdir(APT_CACHE_DIR, { recursive: true })

  try {
    // Copy from user-accessible cache to system cache. Copies with mkdir and cp
    // -r rather than using node libraries in order to run with sudo.
    try {
      await fs.access('/var/cache/apt/archives')
    } catch {
      await exec.exec('sudo', ['mkdir', '-p', '/var/cache/apt/archives'], {
        silent: true,
      })
    }
    await copyDirectory('/var/cache/apt/archives', archivesDir, [
      'lock',
      'partial',
    ])

    // Ensure system directories exist and copy apt lists
    try {
      await fs.access('/var/lib/apt/lists')
    } catch {
      await exec.exec('sudo', ['mkdir', '-p', '/var/lib/apt/lists'], {
        silent: true,
      })
    }
    await copyDirectory('/var/lib/apt/lists', listsDir, ['lock', 'partial'])
  } catch (error) {
    if (error instanceof Error) {
      core.warning(`Failed to copy apt cache: ${error.message}`)
    }
  }
}

async function restoreAptCache(): Promise<void> {
  if (!IS_LINUX) {
    return
  }

  const archivesDir = path.join(APT_CACHE_DIR, 'archives')
  const listsDir = path.join(APT_CACHE_DIR, 'lists')

  try {
    // Check if cached directories exist
    try {
      await fs.access(archivesDir)
    } catch {
      core.info('No cached apt archives found')
      return
    }

    // Ensure /var/cache/apt/archives exists
    await exec.exec('sudo', ['mkdir', '-p', '/var/cache/apt/archives'], {
      silent: true,
    })

    // Restore archives
    await exec.exec('sudo', [
      'cp',
      '-r',
      archivesDir + '/.',
      '/var/cache/apt/archives/',
    ])

    // Ensure /var/lib/apt/lists exists
    await exec.exec('sudo', ['mkdir', '-p', '/var/lib/apt/lists'], {
      silent: true,
    })

    // Restore lists
    await exec.exec('sudo', [
      'cp',
      '-r',
      listsDir + '/.',
      '/var/lib/apt/lists/',
    ])
  } catch (error) {
    if (error instanceof Error) {
      core.warning(`Failed to restore apt cache: ${error.message}`)
    }
  }
}

export interface CacheRestoreResult {
  /** Whether any cache was restored, by exact key or by a fallback prefix. */
  restored: boolean
  /** The key this run computed and will save under; '' if none was computed. */
  primaryKey: string
  /** The key actually restored; '' on a miss. */
  matchedKey: string
}

/**
 * Restore the opam cache.
 *
 * The keys are returned rather than left for the caller to read back with
 * core.getState().  saveState() writes to the state file, but getState() reads
 * environment variables the runner populates at step *start*, so state written
 * during this step reads back empty until the post step.  The caller needs
 * these values now, to report them as outputs.
 */
export async function restoreCache(): Promise<CacheRestoreResult> {
  if (!cache.isFeatureAvailable()) {
    core.warning('cache feature is not available, not restoring')
    return { restored: false, primaryKey: '', matchedKey: '' }
  }

  const cachePaths = await getCachePaths()
  const cacheKey = await getCacheKey()
  const rocqVersionCacheKey = await getRocqVersionCacheKey()
  // remember key used to later save cache
  core.saveState(State.CachePrimaryKey, cacheKey)

  core.info(`Attempting to restore cache with key: ${cacheKey}`)
  core.info(`Cache paths: ${cachePaths.join(', ')}`)

  try {
    const start = Date.now()
    const restoredKey = await cache.restoreCache(cachePaths, cacheKey, [
      `${rocqVersionCacheKey}-`,
      `${CACHE_PLATFORM_PREFIX}-`,
    ])
    const elapsedMs = Date.now() - start
    const elapsedSec = Math.floor(elapsedMs / 1000)

    if (restoredKey) {
      core.info(`Cache restored from key: ${restoredKey} (took ${elapsedSec}s)`)
      core.saveState(State.CacheMatchedKey, restoredKey)
      // Restore apt cache to system directories
      await restoreAptCache()
      return { restored: true, primaryKey: cacheKey, matchedKey: restoredKey }
    } else {
      core.info('Cache not found')
      return { restored: false, primaryKey: cacheKey, matchedKey: '' }
    }
  } catch (error) {
    if (error instanceof Error) {
      core.warning(`Failed to restore cache: ${error.message}`)
    }
    return { restored: false, primaryKey: cacheKey, matchedKey: '' }
  }
}

/**
 * Decide whether the post step should save a cache, from the `save-if` input.
 *
 * GitHub scopes a cache write to the ref that made it.  A `pull_request` run
 * writes under `refs/pull/N/merge`, which no other branch -- including the
 * base branch and every sibling PR -- can ever read.  Such a cache is
 * therefore pure cost: it counts against the repository's 10GB quota and
 * evicts, least-recently-used, the branch caches that PRs actually restore
 * from.  A repository with enough concurrent PRs evicts its default-branch
 * cache and every run from then on is a cold start.
 *
 * So under `auto` we restore on pull_request but do not save.
 */
export function shouldSaveCache(): boolean {
  const saveIf = core.getInput('save-if').trim().toLowerCase()

  if (saveIf === 'false') {
    core.info('save-if is false, skipping save')
    return false
  }

  // Treat anything explicitly truthy as "always save"; `auto` (the default)
  // and an empty input fall through to the event check.
  if (saveIf === 'true') {
    return true
  }

  if (saveIf !== 'auto' && saveIf !== '') {
    core.warning(
      `Unrecognized save-if value '${saveIf}', expected true, false, or auto; treating as auto`,
    )
  }

  const eventName = process.env.GITHUB_EVENT_NAME ?? ''
  if (eventName === 'pull_request' || eventName === 'pull_request_target') {
    core.info(
      `Not saving cache: a ${eventName} run's cache is scoped to the PR and ` +
        'cannot be restored by any other branch. Pass save-if: true to ' +
        'override (needed if your workflow only runs on pull requests).',
    )
    return false
  }

  return true
}

/**
 * Delete OCaml binary annotation files from the opam root before uploading.
 *
 * `.cmt`/`.cmti` are what merlin, ocaml-lsp and odoc read to answer
 * questions about source; `ocamlfind`, `dune`, `ocamlopt` and Rocq itself
 * never look at them, so a switch that only has to *build* projects does
 * not need them.  They are around a fifth of the compressed switch, which
 * makes this the single biggest saving available.
 *
 * Deleting them does not disturb opam's bookkeeping: opam tracks which
 * packages are installed, not a checksum over their files, so an
 * incremental `opam install` against the restored switch still sees every
 * package as present.
 *
 * The tradeoff is that a workflow which runs merlin, ocaml-lsp or odoc
 * against the restored switch will find those tools degraded.  Set
 * `strip-binary-annotations: false` in that case.
 */
export async function stripBinaryAnnotations(
  // Takes the root explicitly so tests can point it at a scratch directory.
  // This deletes files, so it must never depend on ambient state to decide
  // where it operates.
  opamRoot: string = getOpamRoot(),
): Promise<void> {
  if (
    core.getInput('strip-binary-annotations').trim().toLowerCase() === 'false'
  ) {
    core.info('strip-binary-annotations is false, keeping .cmt/.cmti files')
    return
  }

  const globber = await glob.create(
    [`${opamRoot}/**/*.cmt`, `${opamRoot}/**/*.cmti`].join('\n'),
    { followSymbolicLinks: false },
  )
  const files = await globber.glob()

  let bytes = 0
  let removed = 0
  for (const file of files) {
    try {
      const stat = await fs.stat(file)
      await fs.rm(file, { force: true })
      bytes += stat.size
      removed += 1
    } catch (error) {
      // A file that vanished under us costs nothing; keep going rather
      // than fail the whole post step over a stray annotation file.
      if (error instanceof Error) {
        core.debug(`Could not remove ${file}: ${error.message}`)
      }
    }
  }

  const megabytes = Math.round(bytes / (1024 * 1024))
  core.info(
    `Stripped ${removed} .cmt/.cmti files (${megabytes}MB uncompressed) before saving`,
  )
}

export async function saveCache(): Promise<void> {
  const cacheKey = core.getState(State.CachePrimaryKey)
  const restoredKey = core.getState(State.CacheMatchedKey)

  if (!cacheKey) {
    core.warning('No cache key found, skipping save')
    return
  }

  // The post action runs with post-if: always(), so it also runs when the main
  // action failed.  A switch left half-built by a failed setup must not be
  // saved: it would be restored on every later run, and main.ts skips switch
  // creation whenever a cache is restored.
  //
  // This is checked before save-if, because "setup never finished" is a
  // stronger reason not to save than any policy the input can express.
  if (core.getState(State.SetupComplete) !== 'true') {
    core.info('Setup did not complete, skipping cache save')
    return
  }

  if (!shouldSaveCache()) {
    return
  }

  if (restoredKey === cacheKey) {
    core.info('Cache matched exactly, skipping save')
    return
  }

  await opamClean()
  await stripBinaryAnnotations()
  await fs.mkdir(DUNE_CACHE_ROOT, { recursive: true })

  // Copy apt cache from system directories before saving
  await copyAptCache()

  const cachePaths = await getCachePaths()

  core.info(`Saving cache with key: ${cacheKey}`)
  core.info(`Cache paths: ${cachePaths.join(', ')}`)

  try {
    const cacheId = await cache.saveCache(cachePaths, cacheKey)
    if (cacheId < 0) {
      return
    }
    core.info('Cache saved successfully')
  } catch (error) {
    if (error instanceof Error) {
      core.warning(`Failed to save cache: ${error.message}`)
    }
  }
}
