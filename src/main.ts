import * as core from '@actions/core'
import { restoreCache } from './cache.js'
import {
  setupOpam,
  setupRepositories,
  createSwitch,
  setupOpamEnv,
  installRocq
} from './opam.js'
import { installSystemPackages } from './unix.js'
import { ROCQ_VERSION } from './constants.js'
import * as exec from '@actions/exec'

export async function run(): Promise<void> {
  try {
    core.info('Setting up Rocq development environment')

    core.startGroup('Restoring opam cache')
    const cacheRestored = await restoreCache()
    core.endGroup()

    await installSystemPackages()

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
    core.group('list installed opam packages', async () => {
      await exec.exec('opam', ['list'])
    })

    // Install Rocq
    await installRocq(ROCQ_VERSION())

    core.info('Rocq development environment set up successfully')
  } catch (error) {
    if (error instanceof Error) {
      core.setFailed(error.message)
    } else {
      core.setFailed('An unknown error occurred')
    }
  }
}
