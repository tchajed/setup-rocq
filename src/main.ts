import * as core from '@actions/core'
import { restoreCache } from './cache.js'
import {
  acquireOpam,
  initializeOpam,
  createSwitch,
  setupOpamEnv,
  disableDuneCache
} from './opam.js'
import { OCAML_VERSION } from './constants.js'

export async function run(): Promise<void> {
  try {
    core.info('Setting up Rocq development environment')

    // Step 1: Restore cache (before setting up opam)
    core.startGroup('Restoring opam cache')
    const cacheRestored = await restoreCache()
    core.endGroup()

    if (cacheRestored) {
      core.info('Cache restored, skipping opam installation')
      // Still need to set up the environment variables
      await setupOpamEnv()
    } else {
      // Step 2: Acquire opam
      core.startGroup('Downloading and installing opam')
      await acquireOpam()
      core.endGroup()

      // Step 3: Initialize opam
      core.startGroup('Initializing opam')
      await initializeOpam()
      core.endGroup()

      // Step 4: Create OCaml switch
      core.startGroup(`Installing OCaml ${OCAML_VERSION}`)
      await createSwitch()
      core.endGroup()

      // Step 5: Set up opam environment
      core.startGroup('Setting up opam environment')
      await setupOpamEnv()
      core.endGroup()
    }

    // Step 6: Disable dune cache
    core.startGroup('Disabling dune cache')
    await disableDuneCache()
    core.endGroup()

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
