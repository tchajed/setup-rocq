import * as core from '@actions/core'
import { restoreCache } from './cache.js'
import {
  setupOpam,
  setupRepositories,
  createSwitch,
  setupOpamEnv,
  disableDuneCache
} from './opam.js'

export async function run(): Promise<void> {
  try {
    core.info('Setting up Rocq development environment')

    core.startGroup('Restoring opam cache')
    const cacheRestored = await restoreCache()
    core.endGroup()

    await setupOpam()

    // Set up repositories (rocq-released + any additional ones)
    await setupRepositories()

    if (!cacheRestored) {
      core.info('No cache, initializing')
      await createSwitch()
    } else {
      core.info('Restored from cache')
    }
    await setupOpamEnv()

    await disableDuneCache()

    core.info('Rocq development environment set up successfully')

    // Get the rocq-version input for future use
    const rocqVersion = core.getInput('rocq-version')
    core.info(`Rocq version requested: ${rocqVersion}`)
    // TODO: Install Rocq in a future update
  } catch (error) {
    if (error instanceof Error) {
      core.setFailed(error.message)
    } else {
      core.setFailed('An unknown error occurred')
    }
  }
}
