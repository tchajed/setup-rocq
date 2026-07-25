import * as core from '@actions/core'
import * as exec from '@actions/exec'
import * as path from 'path'
import * as os from 'os'
import {
  opamPin,
  opamInstall,
  opamInstalledVersion,
  configureDune,
  setupOpamEnv,
} from './opam.js'
import { getMondayDate } from './weekly.js'
import { DUNE_VERSION } from './constants.js'
import {
  getPinnedRocqInstallPackages,
  getPinnedRocqPackages,
  type RocqPin,
} from './rocq-pin.js'

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

  // Pin every dev package in the cone to a commit.  rocq-stdlib was the
  // omission: coq-stdlib was pinned to Monday's stdlib commit while
  // rocq-stdlib -- the package that actually holds the library -- was
  // left to resolve from the dev repo, whose branch moves.  So a
  // "weekly" switch was not pinned to Monday for that package, and the
  // two stdlib packages could come from different commits.  An unpinned
  // dev package is also perpetually out of date as far as opam is
  // concerned, so any dev sync marks it -- and coq-stdlib, which uses
  // it, and the coq metapackage above that -- for recompilation.
  await opamPin('rocq-runtime.dev', `git+file://${rocqRepoPath}#${rocqCommit}`)
  await opamPin('rocq-core.dev', `git+file://${rocqRepoPath}#${rocqCommit}`)
  await opamPin('coqide-server.dev', `git+file://${rocqRepoPath}#${rocqCommit}`)
  await opamPin('coq-core.dev', `git+file://${rocqRepoPath}#${rocqCommit}`)
  await opamPin(
    'rocq-stdlib.dev',
    `git+file://${stdlibRepoPath}#${stdlibCommit}`,
  )
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
  await opamPin('rocq-stdlib.dev', stdlibUrl)
  await opamPin('coq-stdlib.dev', stdlibUrl)
  // NOTE: this meta package is not in any rocq source repo; only found in rocq
  // core-dev opam repo
  await opamPin('coq.dev', '--dev-repo')

  // Install the pinned packages
  await opamInstall('coq.dev', ['--unset-root'])
}

async function installRocqLatest(): Promise<void> {
  core.info('Installing latest Rocq version')
  // the coq compat metapackage lags behind releases (and may stop being
  // published), so install the real packages instead
  await opamInstall(['rocq-core', 'rocq-stdlib'], ['--unset-root'])
}

async function installRocqVersion(version: string): Promise<void> {
  core.info(`Installing Rocq version ${version}`)
  if (version.startsWith('8.')) {
    // rocq-core only exists for 9.0+
    await opamInstall(`coq.${version}`, ['--unset-root'])
    return
  }
  // rocq-stdlib is versioned independently of rocq-core, so leave it
  // unconstrained and let the solver pick a compatible version
  await opamInstall([`rocq-core.${version}`, 'rocq-stdlib'], ['--unset-root'])
}

async function installPinnedRocq(pins: RocqPin[]): Promise<void> {
  const installPackages = getPinnedRocqInstallPackages(pins)
  core.info(
    `Installing Rocq from pin-depends using ${installPackages.join(', ')} (${pins.length} pinned package${pins.length === 1 ? '' : 's'})`,
  )

  for (const pin of pins) {
    await opamPin(pin.pkg, pin.target)
  }

  await opamInstall(installPackages, ['--unset-root'])
}

// Compare two dotted-numeric versions.  Returns a negative number if a <
// b, zero if they are equal, and a positive number if a > b.  Returns
// null if either is not purely dotted-numeric, which is the caller's
// signal that it cannot decide.
export function compareDottedVersions(a: string, b: string): number | null {
  const parse = (v: string): number[] | null => {
    const parts = v.split('.')
    const nums = parts.map((p) => (/^\d+$/.test(p) ? Number(p) : NaN))
    return nums.some(Number.isNaN) ? null : nums
  }
  const av = parse(a)
  const bv = parse(b)
  if (av === null || bv === null) {
    return null
  }
  for (let i = 0; i < Math.max(av.length, bv.length); i++) {
    const diff = (av[i] ?? 0) - (bv[i] ?? 0)
    if (diff !== 0) {
      return diff
    }
  }
  return 0
}

// Install dune, treating DUNE_VERSION as a floor rather than a pin.
//
// A restored cache can hold a switch whose dune the project's own
// `opam install` already upgraded past DUNE_VERSION.  Asking for
// `dune.DUNE_VERSION` there is a downgrade, and opam responds by
// recompiling every package that uses dune -- all of Rocq -- twice per
// run, once down and once back up when the project's dependencies are
// installed.  It also uninstalls any package whose constraint the older
// dune violates.  So keep a dune that is already new enough.
export async function installDune(): Promise<void> {
  const installed = await opamInstalledVersion('dune')
  if (installed !== null) {
    const cmp = compareDottedVersions(installed, DUNE_VERSION)
    if (cmp !== null && cmp >= 0) {
      core.info(
        `dune ${installed} is already installed and is at least ${DUNE_VERSION}; keeping it`,
      )
      return
    }
  }
  await opamInstall(`dune.${DUNE_VERSION}`)
}

export async function installRocq(version: string): Promise<void> {
  await core.group('Installing Rocq', async () => {
    await installDune()
    const pinnedRocqPackages = await getPinnedRocqPackages()
    if (pinnedRocqPackages.length > 0) {
      await installPinnedRocq(pinnedRocqPackages)
    } else if (version === 'dev') {
      await installRocqDev()
    } else if (version === 'weekly') {
      await installRocqWeekly()
    } else if (version === 'latest') {
      await installRocqLatest()
    } else {
      await installRocqVersion(version)
    }
    await setupOpamEnv()
    await configureDune()
  })
}
