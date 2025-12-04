import * as core from '@actions/core'
import * as cache from '@actions/cache'
import * as path from 'path'
import * as os from 'os'
import { OCAML_VERSION, PLATFORM, ARCHITECTURE } from './constants.js'
import { opamClean } from './opam.js'

export const CACHE_VERSION = 'v1'

function getCacheKey(): string {
  return `setup-rocq-${CACHE_VERSION}-${PLATFORM}-${ARCHITECTURE}-ocaml-${OCAML_VERSION}`
}

function getOpamRoot(): string {
  return path.join(os.homedir(), '.opam')
}

export async function restoreCache(): Promise<boolean> {
  const opamRoot = getOpamRoot()
  const cacheKey = getCacheKey()

  core.info(`Attempting to restore cache with key: ${cacheKey}`)
  core.info(`Cache paths: ${opamRoot}`)

  try {
    const restoredKey = await cache.restoreCache([opamRoot], cacheKey, [
      `setup-rocq-${CACHE_VERSION}-${PLATFORM}-${ARCHITECTURE}-`,
      `setup-rocq-${CACHE_VERSION}-${PLATFORM}-`,
      `setup-rocq-${CACHE_VERSION}-`
    ])

    if (restoredKey) {
      core.info(`Cache restored from key: ${restoredKey}`)
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
  const opamRoot = getOpamRoot()

  core.info(`Saving cache with key: ${cacheKey}`)
  core.info(`Cache paths: ${opamRoot}`)

  try {
    await cache.saveCache([opamRoot], cacheKey)
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
