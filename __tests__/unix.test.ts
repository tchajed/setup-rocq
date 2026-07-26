import { jest } from '@jest/globals'
import type * as exec from '@actions/exec'
import * as core from '../__fixtures__/core.js'

const mockExec = jest.fn<typeof exec.exec>()

// unix.ts branches on constants that are fixed at import time, so load a fresh
// copy of the module per platform rather than trying to mutate them.
async function loadUnix(platform: 'linux' | 'darwin' | 'win32') {
  jest.resetModules()
  jest.unstable_mockModule('@actions/core', () => core)
  jest.unstable_mockModule('@actions/exec', () => ({ exec: mockExec }))
  jest.unstable_mockModule('../src/constants.js', () => ({
    IS_LINUX: platform === 'linux',
    IS_MACOS: platform === 'darwin',
  }))
  core.group.mockImplementation(async (_name, fn) => fn())
  return import('../src/unix.js')
}

beforeEach(() => {
  mockExec.mockReset()
  mockExec.mockResolvedValue(0)
})

afterEach(() => {
  jest.resetAllMocks()
})

describe('installSystemPackages', () => {
  it('installs apt packages on Linux', async () => {
    const { installSystemPackages } = await loadUnix('linux')

    await installSystemPackages()

    expect(mockExec).toHaveBeenCalledTimes(1)
    const [cmd, args] = mockExec.mock.calls[0]
    expect(cmd).toBe('sudo')
    expect(args?.slice(0, 3)).toEqual(['apt-get', 'install', '-y'])
    expect(args).toEqual(expect.arrayContaining(['rsync', 'libgmp-dev']))
  })

  // A runner image whose package lists are stale fails to resolve the
  // packages; apt-get update is the recovery, and it must actually be tried.
  it('retries after apt-get update when the first install fails', async () => {
    const { installSystemPackages } = await loadUnix('linux')
    mockExec.mockRejectedValueOnce(new Error('unable to locate package'))

    await installSystemPackages()

    expect(mockExec).toHaveBeenCalledTimes(3)
    expect(mockExec.mock.calls[1][1]).toEqual(['apt-get', 'update'])
    expect(mockExec.mock.calls[2][1]?.slice(0, 3)).toEqual([
      'apt-get',
      'install',
      '-y',
    ])
  })

  it('propagates a failure that survives the retry', async () => {
    const { installSystemPackages } = await loadUnix('linux')
    mockExec.mockRejectedValue(new Error('apt is broken'))

    await expect(installSystemPackages()).rejects.toThrow('apt is broken')
  })

  it('installs brew packages on macOS', async () => {
    const { installSystemPackages } = await loadUnix('darwin')

    await installSystemPackages()

    expect(mockExec).toHaveBeenCalledWith('brew', [
      'install',
      'darcs',
      'mercurial',
    ])
  })

  it('installs nothing on an unrecognized platform', async () => {
    const { installSystemPackages } = await loadUnix('win32')

    await installSystemPackages()

    expect(mockExec).not.toHaveBeenCalled()
  })
})
