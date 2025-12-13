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
  IS_LINUX,
  State,
  DUNE_CACHE_ROOT,
  APT_CACHE_DIR,
} from './constants.js'
import { opamClean } from './opam.js'
import { getRocqWeeklyDir } from './rocq.js'
import { getMondayDate } from './weekly.js'

export const CACHE_VERSION = 'v2'

const CACHE_PLATFORM_PREFIX = `setup-rocq-${CACHE_VERSION}-${PLATFORM}-${ARCHITECTURE}`

function getRocqVersionCacheKey(): string {
  let cacheKey = `${CACHE_PLATFORM_PREFIX}-rocq-${ROCQ_VERSION}`
  if (ROCQ_VERSION === 'weekly') {
    const date = getMondayDate().toISOString().split('T')[0]
    cacheKey += `-${date}`
  }
  return cacheKey
}

async function getCacheKey(): Promise<string> {
  const cacheKeyFiles = core.getInput('cache-key-opam-files')
  let cacheKey = getRocqVersionCacheKey()
  const depHash = await glob.hashFiles(cacheKeyFiles)
  cacheKey += `-${depHash}`
  return cacheKey
}

function getOpamRoot(): string {
  return path.join(os.homedir(), '.opam')
}

function getCachePaths(): string[] {
  const paths = [getOpamRoot(), DUNE_CACHE_ROOT]

  // For weekly version, also cache the directory with cloned repositories
  if (ROCQ_VERSION === 'weekly') {
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

export async function restoreCache(): Promise<boolean> {
  if (!cache.isFeatureAvailable()) {
    core.warning('cache feature is not available, not restoring')
    return false
  }

  const cachePaths = getCachePaths()
  const cacheKey = await getCacheKey()
  // remember key used to later save cache
  core.saveState(State.CachePrimaryKey, cacheKey)

  core.info(`Attempting to restore cache with key: ${cacheKey}`)
  core.info(`Cache paths: ${cachePaths.join(', ')}`)

  try {
    const start = Date.now()
    const restoredKey = await cache.restoreCache(cachePaths, cacheKey, [
      `${getRocqVersionCacheKey()}-`,
      `${CACHE_PLATFORM_PREFIX}-`,
    ])
    const elapsedMs = Date.now() - start
    const elapsedSec = Math.floor(elapsedMs / 1000)

    if (restoredKey) {
      core.info(`Cache restored from key: ${restoredKey} (took ${elapsedSec}s)`)
      core.saveState(State.CacheMatchedKey, restoredKey)
      // Restore apt cache to system directories
      await restoreAptCache()
      return true
    } else {
      core.info('Cache not found')
      return false
    }
  } catch (error) {
    if (error instanceof Error) {
      core.warning(`Failed to restore cache: ${error.message}`)
    }
    return false
  }
}

export async function saveCache(): Promise<void> {
  const cacheKey = core.getState(State.CachePrimaryKey)
  const restoredKey = core.getState(State.CacheMatchedKey)

  if (!cacheKey) {
    core.warning('No cache key found, skipping save')
    return
  }

  if (restoredKey === cacheKey) {
    core.info('Cache matched exactly, skipping save')
    return
  }

  await opamClean()
  await fs.mkdir(DUNE_CACHE_ROOT, { recursive: true })

  // Copy apt cache from system directories before saving
  await copyAptCache()

  const cachePaths = getCachePaths()

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
