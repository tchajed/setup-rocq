import { jest } from '@jest/globals'
import * as core from '../__fixtures__/core.js'

// constants.ts reads its inputs at import time, so the `dune-version` mock has
// to be in place before anything that imports it is loaded.  That is also why
// this lives in its own file: rocq.test.ts covers the floor logic with the
// default, and a module registry can only hold one value per file.
const mockOpamInstall =
  jest.fn<(pkg: string, options?: string[]) => Promise<void>>()
const mockOpamInstalledVersion =
  jest.fn<(pkg: string) => Promise<string | null>>()

jest.unstable_mockModule('@actions/core', () => core)
jest.unstable_mockModule('../src/opam.js', () => ({
  opamInstall: mockOpamInstall,
  opamInstalledVersion: mockOpamInstalledVersion,
  opamPin: jest.fn(),
  opamClean: jest.fn(),
  configureDune: jest.fn(),
  setupOpamEnv: jest.fn(),
}))
// Only CACHE_PLATFORM_PREFIX is read below, but importing cache.ts pulls in
// the real @actions/cache, which wants more of @actions/core than the fixture
// provides.
jest.unstable_mockModule('@actions/cache', () => ({
  isFeatureAvailable: jest.fn(() => true),
  restoreCache: jest.fn(),
  saveCache: jest.fn(),
}))
jest.unstable_mockModule('@actions/exec', () => ({
  exec: jest.fn<() => Promise<number>>().mockResolvedValue(0),
  getExecOutput: jest.fn(),
}))

core.getInput.mockImplementation((name: string) => {
  if (name === 'dune-version') {
    return '3.23.1'
  }
  return ''
})
core.group.mockImplementation(
  async (_name: string, fn: () => Promise<void>) => {
    await fn()
  },
)

const { installRocq } = await import('../src/rocq.js')
const { CACHE_PLATFORM_PREFIX } = await import('../src/cache.js')

describe('dune-version input', () => {
  beforeEach(() => {
    mockOpamInstall.mockResolvedValue(undefined)
    mockOpamInstalledVersion.mockResolvedValue(null)
  })

  // Without this the project's own `opam install` upgrades dune afterwards,
  // which recompiles every package built with dune -- all of Rocq.
  it('raises the floor dune installed into a fresh switch', async () => {
    await installRocq('latest')

    expect(mockOpamInstall).toHaveBeenNthCalledWith(1, 'dune.3.23.1')
  })

  it('still keeps an installed dune that already meets the raised floor', async () => {
    mockOpamInstalledVersion.mockResolvedValue('3.23.1')

    await installRocq('latest')

    expect(mockOpamInstall).not.toHaveBeenCalledWith('dune.3.23.1')
  })

  // A cache written under the default floor must not satisfy a raised one:
  // installDune() would keep its older dune and the input would do nothing.
  it('appears in the cache prefix, and so in every fallback key', () => {
    expect(CACHE_PLATFORM_PREFIX).toContain('-dune-3.23.1')
  })
})
