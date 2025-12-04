import * as core from '@actions/core'
import * as cache from '@actions/cache'
import * as exec from '@actions/exec'
import * as path from 'path'
import * as os from 'os'
import { PLATFORM, ARCHITECTURE, ROCQ_VERSION, IS_LINUX } from './constants.js'
import { opamClean } from './opam.js'
import { getRocqWeeklyDir } from './rocq.js'

export const CACHE_VERSION = 'v1'

function getCacheKey(): string {
  return `setup-rocq-${CACHE_VERSION}-${PLATFORM}-${ARCHITECTURE}-rocq-${ROCQ_VERSION}`
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

async function copyAptCache(): Promise<void> {
  if (!IS_LINUX) {
    return
  }

  const aptCacheDir = getAptCacheDir()
  const archivesDir = path.join(aptCacheDir, 'archives')
  const listsDir = path.join(aptCacheDir, 'lists')

  try {
    // Create cache directories
    await exec.exec('mkdir', ['-p', archivesDir, listsDir])

    // Copy apt archives (excluding lock and partial directories)
    await exec.exec('sudo', [
      'rsync',
      '-a',
      '--exclude=lock',
      '--exclude=partial',
      '/var/cache/apt/archives/',
      archivesDir,
    ])

    // Copy apt lists (excluding lock and partial directories)
    await exec.exec('sudo', [
      'rsync',
      '-a',
      '--exclude=lock',
      '--exclude=partial',
      '/var/lib/apt/lists/',
      listsDir,
    ])

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
    // Restore archives if they exist
    await exec.exec('sudo', [
      'rsync',
      '-a',
      archivesDir + '/',
      '/var/cache/apt/archives/',
    ])

    // Restore lists if they exist
    await exec.exec('sudo', [
      'rsync',
      '-a',
      listsDir + '/',
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
  const cachePaths = getCachePaths()
  const cacheKey = getCacheKey()

  core.info(`Attempting to restore cache with key: ${cacheKey}`)
  core.info(`Cache paths: ${cachePaths.join(', ')}`)

  try {
    const restoredKey = await cache.restoreCache(cachePaths, cacheKey, [
      `setup-rocq-${CACHE_VERSION}-${PLATFORM}-${ARCHITECTURE}-`,
    ])

    if (restoredKey) {
      core.info(`Cache restored from key: ${restoredKey}`)
      // Restore apt cache to system directories
      await restoreAptCache()
      // Set a state variable to indicate cache was restored
      core.saveState('CACHE_RESTORED', 'true')
      core.saveState('CACHE_KEY', cacheKey)
      return true
    } else {
      core.info('Cache not found')
      core.saveState('CACHE_RESTORED', 'false')
      core.saveState('CACHE_KEY', cacheKey)
      return false
    }
  } catch (error) {
    if (error instanceof Error) {
      core.warning(`Failed to restore cache: ${error.message}`)
    }
    core.saveState('CACHE_RESTORED', 'false')
    core.saveState('CACHE_KEY', cacheKey)
    return false
  }
}

export async function saveCache(): Promise<void> {
  const cacheKey = core.getState('CACHE_KEY')

  if (!cacheKey) {
    core.warning('No cache key found, skipping save')
    return
  }

  await opamClean()

  // Copy apt cache from system directories before saving
  await copyAptCache()

  const cachePaths = getCachePaths()

  core.info(`Saving cache with key: ${cacheKey}`)
  core.info(`Cache paths: ${cachePaths.join(', ')}`)

  try {
    await cache.saveCache(cachePaths, cacheKey)
    core.info('Cache saved successfully')
  } catch (error) {
    if (error instanceof Error) {
      if (error.message.includes('already exists')) {
        core.info('Cache already exists, skipping save')
      } else {
        core.warning(`Failed to save cache: ${error.message}`)
      }
    }
  }
}
