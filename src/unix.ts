import * as core from '@actions/core'
import * as exec from '@actions/exec'
import { IS_LINUX, IS_MACOS } from './constants.js'

const MANDATORY_LINUX_PACKAGES = [
  // NOTE: sandboxing is disabled so we don't need to install bubblewrap
  // 'bubblewrap',
  // NOTE: not sure why setup-ocaml installs musl-tools
  // 'musl-tools',
  'rsync',
  'libgmp-dev',
  'sqlite3',
]

const MACOS_PACKAGES = ['darcs', 'mercurial']

async function installLinuxPackages(): Promise<void> {
  const packagesToInstall = [...MANDATORY_LINUX_PACKAGES]

  if (packagesToInstall.length > 0) {
    core.info(`Installing packages: ${packagesToInstall.join(', ')}`)
    try {
      await exec.exec('sudo', [
        'apt-get',
        'install',
        '-y',
        ...packagesToInstall,
      ])
    } catch {
      core.info(
        'Package installation failed, updating package lists and retrying',
      )
      await exec.exec('sudo', ['apt-get', 'update'])
      await exec.exec('sudo', [
        'apt-get',
        'install',
        '-y',
        ...packagesToInstall,
      ])
    }
  }
}

async function installMacOSPackages(): Promise<void> {
  if (MACOS_PACKAGES.length > 0) {
    core.info(`Installing packages: ${MACOS_PACKAGES.join(', ')}`)
    await exec.exec('brew', ['install', ...MACOS_PACKAGES])
  }
}

export async function installSystemPackages(): Promise<void> {
  await core.group('Installing system packages', async () => {
    if (IS_LINUX) {
      await installLinuxPackages()
    } else if (IS_MACOS) {
      await installMacOSPackages()
    }
    core.info('System packages installed')
  })
}
