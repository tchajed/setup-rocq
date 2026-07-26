import * as core from '@actions/core'
import { restoreCache } from './cache.js'
import {
  setupOpam,
  setupOpamRepositories,
  opamSwitchCreate,
  opamList,
  opamUpdate,
  ensureSwitch,
  opamInstalledVersion,
} from './opam.js'
import { installRocq, getInstalledRocqVersion } from './rocq.js'
import { installSystemPackages } from './unix.js'
import { ROCQ_VERSION, Output, State } from './constants.js'

// Report what was actually installed.  For `latest`, `dev`, and a partial
// version input the resolver's choice is not something the caller can predict,
// so it has to be read back out of the switch.
async function setOutputs(): Promise<void> {
  const rocqVersion = await getInstalledRocqVersion()
  if (rocqVersion === null) {
    core.warning('Could not determine the installed Rocq version')
  } else {
    core.info(`Installed Rocq ${rocqVersion}`)
  }
  core.setOutput(Output.RocqVersion, rocqVersion ?? '')

  const ocamlVersion = await opamInstalledVersion('ocaml')
  core.setOutput(Output.OCamlVersion, ocamlVersion ?? '')

  // setupOpamEnv() ran inside installRocq(), so opam env's variables are in
  // process.env by now.
  core.setOutput(Output.OpamSwitchPrefix, process.env.OPAM_SWITCH_PREFIX ?? '')
}

export async function run(): Promise<void> {
  try {
    core.info('Setting up Rocq development environment')

    core.startGroup('Restoring opam cache')
    const cacheResult = await restoreCache()
    const cacheRestored = cacheResult.restored
    core.endGroup()
    core.setOutput(Output.CacheHit, String(cacheRestored))
    // The keys themselves, not just whether something matched.  A fallback
    // key is a prefix match, so "restored a cache" does not say *which* one:
    // only the matched key distinguishes a compatible archive from one that
    // should never have been eligible.  Empty when nothing was restored.
    //
    // These come back from restoreCache() rather than core.getState(), which
    // cannot see state written during this same step.
    core.setOutput(Output.CachePrimaryKey, cacheResult.primaryKey)
    core.setOutput(Output.CacheMatchedKey, cacheResult.matchedKey)

    await installSystemPackages()
    await setupOpam()
    await setupOpamRepositories()

    if (!cacheRestored) {
      await opamSwitchCreate()
    } else {
      await ensureSwitch()
      await opamUpdate()
    }
    await opamList()

    // Install Rocq
    await installRocq(ROCQ_VERSION)

    await setOutputs()

    // Only now is the switch complete enough to be worth caching.  The post
    // action runs even when the job failed and checks this state.
    core.saveState(State.SetupComplete, 'true')

    core.info('Rocq development environment set up successfully')
  } catch (error) {
    if (error instanceof Error) {
      core.setFailed(error.message)
    } else {
      core.setFailed('An unknown error occurred')
    }
  }
}
