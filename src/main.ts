import * as core from '@actions/core'
import { restoreCache } from './cache.js'
import {
  setupOpam,
  setupOpamRepositories,
  createSwitch,
  setupOpamEnv,
  opamList,
  opamUpdate,
} from './opam.js'
import { installRocq } from './rocq.js'
import { installSystemPackages } from './unix.js'
import { ROCQ_VERSION } from './constants.js'

export async function run(): Promise<void> {
  try {
    core.info('Setting up Rocq development environment')

    core.startGroup('Restoring opam cache')
    const cacheRestored = await restoreCache()
    core.endGroup()

    await installSystemPackages()
    await setupOpam()
    await setupOpamRepositories()

    if (!cacheRestored) {
      core.info('No cache, initializing')
      await createSwitch()
    } else {
      core.info('Restored from cache')
      await opamUpdate()
    }
    await setupOpamEnv()
    await opamList()

    // Install Rocq
    await installRocq(ROCQ_VERSION)

    core.info('Rocq development environment set up successfully')
  } catch (error) {
    if (error instanceof Error) {
      core.setFailed(error.message)
    } else {
      core.setFailed('An unknown error occurred')
    }
  }
}
