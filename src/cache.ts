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
  let cacheKey = getRocqVersionCacheKey()
  const depHash = await glob.hashFiles('*.opam')
  cacheKey += `-${depHash}`
  return cacheKey
}

function getOpamRoot(): string {
  return path.join(os.homedir(), '.opam')
}

function getAptCacheDir(): string {
  return path.join(os.homedir(), '.apt-cache')
}

function getCachePaths(): string[] {
  const paths = [getOpamRoot()]

  // For weekly version, also cache the directory with cloned repositories
  if (ROCQ_VERSION === 'weekly') {
    paths.push(getRocqWeeklyDir())
  }

  // On Linux, cache apt packages in user-accessible directory
  if (IS_LINUX) {
    paths.push(getAptCacheDir())
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

  const aptCacheDir = getAptCacheDir()
  const archivesDir = path.join(aptCacheDir, 'archives')
  const listsDir = path.join(aptCacheDir, 'lists')

  try {
    // Create cache directories
    await fs.mkdir(aptCacheDir, { recursive: true })

    // Ensure system directories exist and copy apt archives
    try {
      await fs.access('/var/cache/apt/archives')
    } catch {
      core.info('Creating /var/cache/apt/archives')
      await exec.exec('sudo', ['mkdir', '-p', '/var/cache/apt/archives'])
    }
    await copyDirectory('/var/cache/apt/archives', archivesDir, [
      'lock',
      'partial',
    ])

    // Ensure system directories exist and copy apt lists
    try {
      await fs.access('/var/lib/apt/lists')
    } catch {
      core.info('Creating /var/lib/apt/lists')
      await exec.exec('sudo', ['mkdir', '-p', '/var/lib/apt/lists'])
    }
    await copyDirectory('/var/lib/apt/lists', listsDir, ['lock', 'partial'])

    core.info('Copied apt cache to user directory')
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

  const aptCacheDir = getAptCacheDir()
  const archivesDir = path.join(aptCacheDir, 'archives')
  const listsDir = path.join(aptCacheDir, 'lists')

  try {
    // Check if cached directories exist
    try {
      await fs.access(archivesDir)
    } catch {
      core.info('No cached apt archives found')
      return
    }

    // Ensure /var/cache/apt/archives exists
    await exec.exec('sudo', ['mkdir', '-p', '/var/cache/apt/archives'])

    // Restore archives
    await exec.exec('sudo', [
      'cp',
      '-r',
      archivesDir + '/.',
      '/var/cache/apt/archives/',
    ])

    // Ensure /var/lib/apt/lists exists
    await exec.exec('sudo', ['mkdir', '-p', '/var/lib/apt/lists'])

    // Restore lists
    await exec.exec('sudo', [
      'cp',
      '-r',
      listsDir + '/.',
      '/var/lib/apt/lists/',
    ])

    core.info('Restored apt cache from user directory')
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
    const restoredKey = await cache.restoreCache(cachePaths, cacheKey, [
      `${getRocqVersionCacheKey()}-`,
      `${CACHE_PLATFORM_PREFIX}-`,
    ])

    if (restoredKey) {
      core.info(`Cache restored from key: ${restoredKey}`)
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
