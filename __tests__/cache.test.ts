import { jest } from '@jest/globals'
import * as fs from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import * as core from '../__fixtures__/core.js'

const mockCacheRestore =
  jest.fn<
    (
      paths: string[],
      key: string,
      restoreKeys?: string[],
    ) => Promise<string | undefined>
  >()
const mockCache = {
  isFeatureAvailable: jest.fn(() => true),
  restoreCache: mockCacheRestore,
  saveCache: jest.fn(),
}

jest.unstable_mockModule('@actions/core', () => core)
jest.unstable_mockModule('@actions/cache', () => mockCache)

core.getInput.mockImplementation((name: string) => {
  if (name === 'rocq-version') {
    return 'latest'
  }
  if (name === 'cache-key-opam-files') {
    return path.join(os.tmpdir(), 'setup-rocq-empty', '*.opam')
  }
  return ''
})

const { restoreCache } = await import('../src/cache.js')

describe('cache.ts', () => {
  beforeEach(() => {
    mockCacheRestore.mockResolvedValue(undefined)
    core.getInput.mockImplementation((name: string) => {
      if (name === 'rocq-version') {
        return 'latest'
      }
      if (name === 'cache-key-opam-files') {
        return path.join(os.tmpdir(), 'setup-rocq-empty', '*.opam')
      }
      return ''
    })
  })

  afterEach(() => {
    jest.resetAllMocks()
    mockCache.isFeatureAvailable.mockReturnValue(true)
  })

  it('uses pinned Rocq targets in the cache restore prefix', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'rocq-cache-'))
    const opamFile = path.join(tempDir, 'project.opam')
    await fs.writeFile(
      opamFile,
      `opam-version: "2.0"
pin-depends: [
  ["coq" "git+https://github.com/example/rocq.git#abcdef"]
]
`,
    )

    core.getInput.mockImplementation((name: string) => {
      if (name === 'rocq-version') {
        return 'latest'
      }
      if (name === 'cache-key-opam-files') {
        return opamFile
      }
      return ''
    })

    await restoreCache()

    expect(mockCacheRestore).toHaveBeenCalledTimes(1)
    const [, cacheKey, restoreKeys] = mockCacheRestore.mock.calls[0]
    expect(cacheKey).toContain('-rocq-pinned-')
    expect(restoreKeys?.[0]).toContain('-rocq-pinned-')
  })
})

it('does not use sub-package pins in the cache key', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'rocq-cache-'))
  const opamFile = path.join(tempDir, 'project.opam')
  await fs.writeFile(
    opamFile,
    `opam-version: "2.0"
pin-depends: [
  ["rocq-runtime.dev" "git+https://github.com/rocq-prover/rocq.git#main"]
  ["rocq-core.dev" "git+https://github.com/rocq-prover/rocq.git#main"]
  ["rocq-stdlib.dev" "git+https://github.com/rocq-prover/rocq.git#main"]
]
`,
  )

  core.getInput.mockImplementation((name: string) => {
    if (name === 'rocq-version') {
      return 'latest'
    }
    if (name === 'cache-key-opam-files') {
      return opamFile
    }
    return ''
  })

  await restoreCache()

  expect(mockCacheRestore).toHaveBeenCalledTimes(1)
  const [, cacheKey] = mockCacheRestore.mock.calls[0]
  expect(cacheKey).not.toContain('-rocq-pinned-')
})
