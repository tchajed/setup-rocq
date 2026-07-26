/**
 * Unit tests for the action's main functionality, src/main.ts
 */
import { jest } from '@jest/globals'
import * as core from '../__fixtures__/core.js'

// Mock cache module
type CacheRestoreResult = {
  restored: boolean
  primaryKey: string
  matchedKey: string
}
const mockRestoreCache = jest.fn<() => Promise<CacheRestoreResult>>()
const restoreResult = (
  restored: boolean,
  primaryKey = 'primary-key',
  matchedKey = restored ? 'primary-key' : '',
): CacheRestoreResult => ({ restored, primaryKey, matchedKey })
const mockCache = {
  restoreCache: mockRestoreCache,
}

// Mock opam module
const mockSetupOpam = jest.fn<() => Promise<void>>()
const mockSetupOpamRepositories = jest.fn<() => Promise<void>>()
const mockOpamSwitchCreate = jest.fn<() => Promise<void>>()
const mockOpamList = jest.fn<() => Promise<void>>()
const mockOpamUpdate = jest.fn<() => Promise<void>>()
const mockEnsureSwitch = jest.fn<() => Promise<void>>()
const mockOpamInstalledVersion =
  jest.fn<(pkg: string, switchName?: string) => Promise<string | null>>()
const mockOpam = {
  setupOpam: mockSetupOpam,
  setupOpamRepositories: mockSetupOpamRepositories,
  opamSwitchCreate: mockOpamSwitchCreate,
  opamList: mockOpamList,
  opamUpdate: mockOpamUpdate,
  ensureSwitch: mockEnsureSwitch,
  opamInstalledVersion: mockOpamInstalledVersion,
}

// Mock rocq module
const mockInstallRocq = jest.fn<(version: string) => Promise<void>>()
const mockGetInstalledRocqVersion = jest.fn<() => Promise<string | null>>()
const mockRocq = {
  installRocq: mockInstallRocq,
  getInstalledRocqVersion: mockGetInstalledRocqVersion,
}

// Mock unix module
const mockInstallSystemPackages = jest.fn<() => Promise<void>>()
const mockUnix = {
  installSystemPackages: mockInstallSystemPackages,
}

// Mocks should be declared before the module being tested is imported.
jest.unstable_mockModule('@actions/core', () => core)
jest.unstable_mockModule('../src/cache.js', () => mockCache)
jest.unstable_mockModule('../src/opam.js', () => mockOpam)
jest.unstable_mockModule('../src/rocq.js', () => mockRocq)
jest.unstable_mockModule('../src/unix.js', () => mockUnix)

// Set the inputs before loading the module, so they can be used in constants.ts
core.getInput.mockImplementation((name: string) => {
  if (name === 'rocq-version') return 'latest'
  return ''
})

// The module being tested should be imported dynamically.
const { run } = await import('../src/main.js')

describe('main.ts', () => {
  beforeEach(() => {
    // Mock all functions to succeed by default
    mockRestoreCache.mockResolvedValue(restoreResult(false))
    mockInstallSystemPackages.mockResolvedValue(undefined)
    mockSetupOpam.mockResolvedValue(undefined)
    mockOpamList.mockResolvedValue(undefined)
    mockSetupOpamRepositories.mockResolvedValue(undefined)
    mockOpamSwitchCreate.mockResolvedValue(undefined)
    mockOpamUpdate.mockResolvedValue(undefined)
    mockEnsureSwitch.mockResolvedValue(undefined)
    mockInstallRocq.mockResolvedValue(undefined)
    mockGetInstalledRocqVersion.mockResolvedValue('9.1.0')
    mockOpamInstalledVersion.mockResolvedValue('5.4.0')
  })

  afterEach(() => {
    jest.resetAllMocks()
  })

  it('Installs OCaml when cache is not restored', async () => {
    mockRestoreCache.mockResolvedValue(restoreResult(false))

    await run()

    // Verify all setup steps were called
    expect(mockRestoreCache).toHaveBeenCalled()
    expect(mockInstallSystemPackages).toHaveBeenCalled()
    expect(mockSetupOpam).toHaveBeenCalled()
    expect(mockSetupOpamRepositories).toHaveBeenCalled()
    expect(mockOpamSwitchCreate).toHaveBeenCalled()
    expect(mockOpamUpdate).not.toHaveBeenCalled()
    expect(mockEnsureSwitch).not.toHaveBeenCalled()
    expect(mockInstallRocq).toHaveBeenCalledWith('latest')
    expect(core.setFailed).not.toHaveBeenCalled()
  })

  it('Skips OCaml installation when cache is restored', async () => {
    mockRestoreCache.mockResolvedValue(restoreResult(true))

    await run()

    // Verify cache restore was checked
    expect(mockRestoreCache).toHaveBeenCalled()

    // System packages and opam setup should always run
    expect(mockInstallSystemPackages).toHaveBeenCalled()
    expect(mockSetupOpam).toHaveBeenCalled()
    expect(mockSetupOpamRepositories).toHaveBeenCalled()

    // OCaml installation should be skipped
    expect(mockOpamSwitchCreate).not.toHaveBeenCalled()

    // But opam update should run on cache restore
    expect(mockOpamUpdate).toHaveBeenCalled()

    // And environment setup should still run
    expect(mockInstallRocq).toHaveBeenCalledWith('latest')
    expect(core.setFailed).not.toHaveBeenCalled()
  })

  it('Verifies the restored switch before trusting a cache hit', async () => {
    mockRestoreCache.mockResolvedValue(restoreResult(true))

    await run()

    // A restored archive can be partial or built by an older version of the
    // action, so the switch has to be checked rather than assumed.
    expect(mockEnsureSwitch).toHaveBeenCalled()
  })

  it('Reports the cache hit as an output', async () => {
    mockRestoreCache.mockResolvedValue(restoreResult(true))
    await run()
    expect(core.setOutput).toHaveBeenCalledWith('cache-hit', 'true')

    jest.clearAllMocks()
    mockRestoreCache.mockResolvedValue(restoreResult(false))
    mockGetInstalledRocqVersion.mockResolvedValue('9.1.0')
    mockOpamInstalledVersion.mockResolvedValue('5.4.0')
    await run()
    expect(core.setOutput).toHaveBeenCalledWith('cache-hit', 'false')
  })

  // "restored a cache" does not say which one: the fallback keys are prefix
  // matches, so a hit can come from an archive saved by an unrelated run.
  // Only the matched key tells them apart.
  // Deliberately not read back with core.getState(): getState() sees only
  // state the runner put in the environment before this step started, so
  // state saved earlier in this same step reads back empty.  Returning the
  // keys from restoreCache() is what makes these outputs work at all.
  it('Reports the cache keys as outputs', async () => {
    mockRestoreCache.mockResolvedValue(
      restoreResult(true, 'primary-key', 'fallback-key'),
    )
    core.getState.mockReturnValue('')

    await run()

    expect(core.setOutput).toHaveBeenCalledWith(
      'cache-primary-key',
      'primary-key',
    )
    expect(core.setOutput).toHaveBeenCalledWith(
      'cache-matched-key',
      'fallback-key',
    )
  })

  it('Reports an empty matched key on a cache miss', async () => {
    mockRestoreCache.mockResolvedValue(restoreResult(false))
    core.getState.mockReturnValue('')

    await run()

    expect(core.setOutput).toHaveBeenCalledWith('cache-matched-key', '')
  })

  it('Reports the installed versions as outputs', async () => {
    process.env.OPAM_SWITCH_PREFIX = '/home/runner/.opam/default'
    mockGetInstalledRocqVersion.mockResolvedValue('9.1.0')
    mockOpamInstalledVersion.mockResolvedValue('5.4.0')

    await run()

    expect(core.setOutput).toHaveBeenCalledWith('rocq-version', '9.1.0')
    expect(core.setOutput).toHaveBeenCalledWith('ocaml-version', '5.4.0')
    expect(core.setOutput).toHaveBeenCalledWith(
      'opam-switch-prefix',
      '/home/runner/.opam/default',
    )
    delete process.env.OPAM_SWITCH_PREFIX
  })

  it('Warns but does not fail when the Rocq version cannot be read', async () => {
    mockGetInstalledRocqVersion.mockResolvedValue(null)

    await run()

    expect(core.warning).toHaveBeenCalledWith(
      expect.stringContaining('Could not determine'),
    )
    expect(core.setOutput).toHaveBeenCalledWith('rocq-version', '')
    expect(core.setFailed).not.toHaveBeenCalled()
  })

  it('Records that setup completed so the post action may save a cache', async () => {
    await run()

    expect(core.saveState).toHaveBeenCalledWith('SETUP_COMPLETE', 'true')
  })

  it('Does not record completion when setup fails', async () => {
    mockInstallRocq.mockRejectedValue(new Error('rocq install blew up'))

    await run()

    expect(core.setFailed).toHaveBeenCalledWith('rocq install blew up')
    // Otherwise the post action, which now runs with post-if: always(), would
    // save a switch that has no working Rocq in it.
    expect(core.saveState).not.toHaveBeenCalledWith('SETUP_COMPLETE', 'true')
  })

  it('Sets failed status on error', async () => {
    const errorMessage = 'Failed to set up opam'
    mockSetupOpam.mockRejectedValue(new Error(errorMessage))

    await run()

    // Verify that the action was marked as failed
    expect(core.setFailed).toHaveBeenCalledWith(errorMessage)
  })

  it('Sets failed status for a non-Error throw', async () => {
    mockSetupOpam.mockRejectedValue('a bare string')

    await run()

    expect(core.setFailed).toHaveBeenCalledWith('An unknown error occurred')
  })
})
