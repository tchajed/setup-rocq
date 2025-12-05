/**
 * Unit tests for the action's main functionality, src/main.ts
 */
import { jest } from '@jest/globals'
import * as core from '../__fixtures__/core.js'

// Mock cache module
const mockRestoreCache = jest.fn<() => Promise<boolean>>()
const mockCache = {
  restoreCache: mockRestoreCache,
}

// Mock opam module
const mockSetupOpam = jest.fn<() => Promise<void>>()
const mockSetupOpamRepositories = jest.fn<() => Promise<void>>()
const mockCreateSwitch = jest.fn<() => Promise<void>>()
const mockSetupOpamEnv = jest.fn<() => Promise<void>>()
const mockOpamList = jest.fn<() => Promise<void>>()
const mockOpamUpdate = jest.fn<() => Promise<void>>()
const mockOpam = {
  setupOpam: mockSetupOpam,
  setupOpamRepositories: mockSetupOpamRepositories,
  createSwitch: mockCreateSwitch,
  setupOpamEnv: mockSetupOpamEnv,
  opamList: mockOpamList,
  opamUpdate: mockOpamUpdate,
}

// Mock rocq module
const mockInstallRocq = jest.fn<(version: string) => Promise<void>>()
const mockRocq = {
  installRocq: mockInstallRocq,
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
    mockRestoreCache.mockResolvedValue(false)
    mockInstallSystemPackages.mockResolvedValue(undefined)
    mockSetupOpam.mockResolvedValue(undefined)
    mockOpamList.mockResolvedValue(undefined)
    mockSetupOpamRepositories.mockResolvedValue(undefined)
    mockCreateSwitch.mockResolvedValue(undefined)
    mockSetupOpamEnv.mockResolvedValue(undefined)
    mockOpamUpdate.mockResolvedValue(undefined)
    mockInstallRocq.mockResolvedValue(undefined)
  })

  afterEach(() => {
    jest.resetAllMocks()
  })

  it('Installs OCaml when cache is not restored', async () => {
    mockRestoreCache.mockResolvedValue(false)

    await run()

    // Verify all setup steps were called
    expect(mockRestoreCache).toHaveBeenCalled()
    expect(mockInstallSystemPackages).toHaveBeenCalled()
    expect(mockSetupOpam).toHaveBeenCalled()
    expect(mockSetupOpamRepositories).toHaveBeenCalled()
    expect(mockCreateSwitch).toHaveBeenCalled()
    expect(mockSetupOpamEnv).toHaveBeenCalled()
    expect(mockOpamUpdate).not.toHaveBeenCalled()
    expect(mockInstallRocq).toHaveBeenCalledWith('latest')
    expect(core.setFailed).not.toHaveBeenCalled()
  })

  it('Skips OCaml installation when cache is restored', async () => {
    mockRestoreCache.mockResolvedValue(true)

    await run()

    // Verify cache restore was checked
    expect(mockRestoreCache).toHaveBeenCalled()

    // System packages and opam setup should always run
    expect(mockInstallSystemPackages).toHaveBeenCalled()
    expect(mockSetupOpam).toHaveBeenCalled()
    expect(mockSetupOpamRepositories).toHaveBeenCalled()

    // OCaml installation should be skipped
    expect(mockCreateSwitch).not.toHaveBeenCalled()

    // But opam update should run on cache restore
    expect(mockOpamUpdate).toHaveBeenCalled()

    // And environment setup should still run
    expect(mockSetupOpamEnv).toHaveBeenCalled()
    expect(mockInstallRocq).toHaveBeenCalledWith('latest')
    expect(core.setFailed).not.toHaveBeenCalled()
  })

  it('Sets failed status on error', async () => {
    const errorMessage = 'Failed to set up opam'
    mockSetupOpam.mockRejectedValue(new Error(errorMessage))

    await run()

    // Verify that the action was marked as failed
    expect(core.setFailed).toHaveBeenCalledWith(errorMessage)
  })
})
