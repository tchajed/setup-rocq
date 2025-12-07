import * as core from '@actions/core'
import * as exec from '@actions/exec'
import * as path from 'path'
import * as os from 'os'
import { opamPin, opamInstall, configureDune } from './opam.js'
import { getMondayDate } from './weekly.js'

// Get the directory containing weekly rocq clones
export function getRocqWeeklyDir(): string {
  return path.join(os.homedir(), 'rocq-weekly')
}

// Get the path to the rocq repository
function getRocqRepoPath(): string {
  return path.join(getRocqWeeklyDir(), 'rocq')
}

// Get the path to the stdlib repository
function getStdlibRepoPath(): string {
  return path.join(getRocqWeeklyDir(), 'stdlib')
}

// Clone or update a git repository
async function cloneOrUpdateRepo(
  repoUrl: string,
  repoPath: string,
): Promise<void> {
  const fs = await import('fs/promises')

  try {
    await fs.access(repoPath)
    // Repository exists, update it
    core.info(`Updating repository at ${repoPath}`)
    await exec.exec('git', ['-C', repoPath, 'fetch', 'origin'])
  } catch {
    // Repository doesn't exist, clone it
    core.info(`Cloning ${repoUrl} to ${repoPath}`)
    const retCode = await exec.exec(
      'git',
      [
        'clone',
        '--shallow-since=8.days.ago',
        '--no-checkout',
        repoUrl,
        repoPath,
      ],
      {
        ignoreReturnCode: true,
      },
    )
    if (retCode == 128) {
      // shallow clones fail if there are no commits in the provided range
      await exec.exec('git', [
        'clone',
        '--depth=10',
        '--no-checkout',
        repoUrl,
        repoPath,
      ])
    }
  }
}

// Get the most recent commit before Monday midnight Central Time
async function getMondayCommitHash(repoPath: string): Promise<string> {
  const cutoffDate = getMondayDate().toISOString()

  core.info(`Finding commit before Monday midnight CT: ${cutoffDate}`)

  // Get the commit hash
  const hashResult = await exec.getExecOutput('git', [
    '-C',
    repoPath,
    'log',
    '-1',
    '--before',
    cutoffDate,
    '--format=%H',
  ])

  let commitHash = hashResult.stdout.trim()

  if (!commitHash) {
    // no earlier commit; get HEAD commit
    const headResult = await exec.getExecOutput('git', [
      '-C',
      repoPath,
      'rev-parse',
      'HEAD',
    ])
    commitHash = headResult.stdout.trim()
  }

  // Show commit info (date and message)
  await exec.exec('git', [
    '-C',
    repoPath,
    'log',
    '-1',
    commitHash,
    '--format=%ci - %s',
  ])
  return commitHash
}

async function installRocqWeekly(): Promise<void> {
  core.info('Installing Rocq weekly version')

  const rocqRepoPath = getRocqRepoPath()
  const stdlibRepoPath = getStdlibRepoPath()

  // Clone or update repositories
  await cloneOrUpdateRepo('https://github.com/rocq-prover/rocq', rocqRepoPath)
  await cloneOrUpdateRepo(
    'https://github.com/rocq-prover/stdlib',
    stdlibRepoPath,
  )

  // Get commit hashes for Monday midnight
  const rocqCommit = await getMondayCommitHash(rocqRepoPath)
  const stdlibCommit = await getMondayCommitHash(stdlibRepoPath)

  core.info(`Using rocq commit: ${rocqCommit}`)
  core.info(`Using stdlib commit: ${stdlibCommit}`)

  // Pin dev packages to specific commits
  await opamPin('rocq-runtime.dev', `git+file://${rocqRepoPath}#${rocqCommit}`)
  await opamPin('rocq-core.dev', `git+file://${rocqRepoPath}#${rocqCommit}`)
  await opamPin('coqide-server.dev', `git+file://${rocqRepoPath}#${rocqCommit}`)
  await opamPin('coq-core.dev', `git+file://${rocqRepoPath}#${rocqCommit}`)
  await opamPin(
    'coq-stdlib.dev',
    `git+file://${stdlibRepoPath}#${stdlibCommit}`,
  )
  await opamPin('coq.dev', '--dev-repo')

  // Install the pinned packages
  await opamInstall('coq.dev', ['--unset-root'])
}

async function installRocqDev(): Promise<void> {
  core.info('Installing Rocq dev version')

  const rocqUrl = 'git+https://github.com/rocq-prover/rocq.git'
  const stdlibUrl = 'git+https://github.com/rocq-prover/stdlib.git'

  // Pin dev packages from git repositories
  await opamPin('rocq-runtime.dev', rocqUrl)
  await opamPin('rocq-core.dev', rocqUrl)
  await opamPin('coqide-server.dev', rocqUrl)
  await opamPin('coq-core.dev', rocqUrl)
  await opamPin('coq-stdlib.dev', stdlibUrl)
  // NOTE: this meta package is not in any rocq source repo; only found in rocq
  // core-dev opam repo
  await opamPin('coq.dev', '--dev-repo')

  // Install the pinned packages
  await opamInstall('coq.dev', ['--unset-root'])
}

async function installRocqLatest(): Promise<void> {
  core.info('Installing latest Rocq version')
  await opamInstall('coq', ['--unset-root'])
}

async function installRocqVersion(version: string): Promise<void> {
  core.info(`Installing Rocq version ${version}`)
  await opamInstall(`coq.${version}`, ['--unset-root'])
}

export async function installRocq(version: string): Promise<void> {
  await core.group('Installing Rocq', async () => {
    if (version === 'dev') {
      await installRocqDev()
    } else if (version === 'weekly') {
      await installRocqWeekly()
    } else if (version === 'latest') {
      await installRocqLatest()
    } else {
      await installRocqVersion(version)
    }
    await configureDune()
  })
}
