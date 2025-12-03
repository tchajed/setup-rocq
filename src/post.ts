import * as core from '@actions/core'
import { saveCache } from './cache.js'

async function post(): Promise<void> {
  try {
    core.info('Running post action to save cache')
    await saveCache()
  } catch (error) {
    if (error instanceof Error) {
      core.warning(`Failed to save cache: ${error.message}`)
    }
  }
}

post()
