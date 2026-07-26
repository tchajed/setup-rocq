import { jest } from '@jest/globals'
import * as core from '../__fixtures__/core.js'

const mockSaveCache = jest.fn<() => Promise<void>>()

jest.unstable_mockModule('@actions/core', () => core)
jest.unstable_mockModule('../src/cache.js', () => ({
  saveCache: mockSaveCache,
}))

describe('post.ts', () => {
  afterEach(() => {
    jest.resetModules()
    jest.resetAllMocks()
  })

  it('saves the cache', async () => {
    mockSaveCache.mockResolvedValue(undefined)

    await import('../src/post.js')

    expect(mockSaveCache).toHaveBeenCalled()
  })

  // The post action runs with post-if: always().  A cache save that throws
  // must not turn an otherwise-green job red, nor mask the real failure of a
  // job that already failed.
  it('warns rather than failing when the save throws', async () => {
    mockSaveCache.mockRejectedValue(new Error('cache service unavailable'))

    await import('../src/post.js')
    // let the floating promise in post.ts settle
    await new Promise((resolve) => setImmediate(resolve))

    expect(core.warning).toHaveBeenCalledWith(
      expect.stringContaining('cache service unavailable'),
    )
    expect(core.setFailed).not.toHaveBeenCalled()
  })
})
