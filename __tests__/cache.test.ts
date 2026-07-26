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
const mockCacheSave =
  jest.fn<(paths: string[], key: string) => Promise<number>>()
const mockCache = {
  isFeatureAvailable: jest.fn(() => true),
  restoreCache: mockCacheRestore,
  saveCache: mockCacheSave,
}

const mockOpamClean = jest.fn<() => Promise<void>>()

jest.unstable_mockModule('@actions/core', () => core)
jest.unstable_mockModule('@actions/cache', () => mockCache)
// cache.ts pulls in rocq.ts for getRocqWeeklyDir(), so the opam mock has to
// cover everything rocq.ts imports too.
jest.unstable_mockModule('../src/opam.js', () => ({
  opamClean: mockOpamClean,
  opamPin: jest.fn(),
  opamInstall: jest.fn(),
  opamInstalledVersion: jest.fn(),
  configureDune: jest.fn(),
  setupOpamEnv: jest.fn(),
}))

const emptyOpamGlob = path.join(os.tmpdir(), 'setup-rocq-empty', '*.opam')

const defaultInputs = (name: string) => {
  if (name === 'rocq-version') {
    return 'latest'
  }
  if (name === 'cache-key-opam-files') {
    return emptyOpamGlob
  }
  return ''
}

core.getInput.mockImplementation(defaultInputs)

// Load the real constants (they read inputs, which are mocked above), then
// override the two that would otherwise have these tests touch the machine:
// the apt cache path, and the dune cache root.
//
// Note that nothing here calls saveCache().  saveCache() invokes
// stripBinaryAnnotations() with its default root, which *deletes* every
// .cmt/.cmti under ~/.opam -- on the machine running the tests.  Guarding that
// with a mocked strip-binary-annotations input works only for as long as
// nobody edits the mock, which is too sharp an edge for the coverage it buys.
// stripBinaryAnnotations is tested below against a temp directory, and the
// save path end to end by the cache workflows in setup-rocq-test.
const realConstants = await import('../src/constants.js')
const duneCacheRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'rocq-dune-'))
jest.unstable_mockModule('../src/constants.js', () => ({
  ...realConstants,
  IS_LINUX: false,
  DUNE_CACHE_ROOT: duneCacheRoot,
}))

const {
  restoreCache,
  shouldSaveCache,
  stripBinaryAnnotations,
  CACHE_PLATFORM_PREFIX,
} = await import('../src/cache.js')

async function opamFileWith(contents: string): Promise<string> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'rocq-cache-'))
  const opamFile = path.join(tempDir, 'project.opam')
  await fs.writeFile(opamFile, contents)
  return opamFile
}

function useOpamFile(opamFile: string, rocqVersion = 'latest') {
  core.getInput.mockImplementation((name: string) => {
    if (name === 'rocq-version') {
      return rocqVersion
    }
    if (name === 'cache-key-opam-files') {
      return opamFile
    }
    return ''
  })
}

describe('cache.ts', () => {
  beforeEach(() => {
    mockCacheRestore.mockResolvedValue(undefined)
    mockCacheSave.mockResolvedValue(1)
    mockOpamClean.mockResolvedValue(undefined)
    mockCache.isFeatureAvailable.mockReturnValue(true)
    core.getInput.mockImplementation(defaultInputs)
    core.getState.mockReturnValue('')
  })

  afterEach(() => {
    jest.resetAllMocks()
    mockCache.isFeatureAvailable.mockReturnValue(true)
  })

  it('uses pinned Rocq targets in the cache restore prefix', async () => {
    const opamFile = await opamFileWith(
      `opam-version: "2.0"
pin-depends: [
  ["coq" "git+https://github.com/example/rocq.git#abcdef"]
]
`,
    )
    useOpamFile(opamFile)

    await restoreCache()

    expect(mockCacheRestore).toHaveBeenCalledTimes(1)
    const [, cacheKey, restoreKeys] = mockCacheRestore.mock.calls[0]
    expect(cacheKey).toContain('-rocq-pinned-')
    expect(restoreKeys?.[0]).toContain('-rocq-pinned-')
  })

  it('uses rocq-* package pins in the cache key', async () => {
    const opamFile = await opamFileWith(
      `opam-version: "2.0"
pin-depends: [
  ["rocq-runtime.dev" "git+https://github.com/rocq-prover/rocq.git#main"]
  ["rocq-core.dev" "git+https://github.com/rocq-prover/rocq.git#main"]
  ["rocq-stdlib.dev" "git+https://github.com/rocq-prover/rocq.git#main"]
]
`,
    )
    useOpamFile(opamFile)

    await restoreCache()

    expect(mockCacheRestore).toHaveBeenCalledTimes(1)
    const [, cacheKey] = mockCacheRestore.mock.calls[0]
    expect(cacheKey).toContain('-rocq-pinned-')
  })

  // main.ts only creates a switch on a cache miss.  A key that can match
  // across compilers therefore pins the switch to whatever OCaml it was first
  // built with, and bumping OCAML_VERSION has no effect whatsoever.
  it('includes the OCaml version in the key and in every fallback', async () => {
    await restoreCache()

    const [, cacheKey, restoreKeys] = mockCacheRestore.mock.calls[0]
    expect(cacheKey).toContain(`-ocaml-${realConstants.OCAML_VERSION}-`)
    for (const key of restoreKeys ?? []) {
      expect(key).toContain(`-ocaml-${realConstants.OCAML_VERSION}-`)
    }
  })

  // The opam root's on-disk format is tied to opam's major.minor.
  it('includes the opam series in the key', async () => {
    await restoreCache()

    const [, cacheKey] = mockCacheRestore.mock.calls[0]
    const series = realConstants.OPAM_VERSION.split('.').slice(0, 2).join('.')
    expect(cacheKey).toContain(`-opam-${series}-`)
    expect(CACHE_PLATFORM_PREFIX).toContain(`-opam-${series}`)
  })

  it('orders fallback keys from most to least specific', async () => {
    await restoreCache()

    const [, , restoreKeys] = mockCacheRestore.mock.calls[0]
    expect(restoreKeys).toHaveLength(2)
    expect(restoreKeys?.[0]).toContain('-rocq-latest-')
    expect(restoreKeys?.[1]).toBe(`${CACHE_PLATFORM_PREFIX}-`)
  })

  it('records the primary key so the post action can save it', async () => {
    await restoreCache()

    expect(core.saveState).toHaveBeenCalledWith(
      'CACHE_KEY',
      expect.stringContaining(CACHE_PLATFORM_PREFIX),
    )
  })

  it('reports a hit and records the matched key', async () => {
    mockCacheRestore.mockResolvedValue('some-restored-key')

    const result = await restoreCache()
    expect(result.restored).toBe(true)
    expect(result.matchedKey).toBe('some-restored-key')
    // Returned, not read back from state: getState() cannot see state saved
    // during this same step.
    expect(result.primaryKey).toContain(CACHE_PLATFORM_PREFIX)
    expect(core.saveState).toHaveBeenCalledWith(
      'CACHE_RESULT',
      'some-restored-key',
    )
  })

  it('reports a miss without recording a matched key', async () => {
    const result = await restoreCache()
    expect(result.restored).toBe(false)
    expect(result.matchedKey).toBe('')
    expect(result.primaryKey).toContain(CACHE_PLATFORM_PREFIX)
    expect(core.saveState).not.toHaveBeenCalledWith(
      'CACHE_RESULT',
      expect.anything(),
    )
  })

  it('returns false when the cache service is unavailable', async () => {
    mockCache.isFeatureAvailable.mockReturnValue(false)

    expect((await restoreCache()).restored).toBe(false)
    expect(mockCacheRestore).not.toHaveBeenCalled()
  })

  it('returns false rather than throwing when a restore fails', async () => {
    mockCacheRestore.mockRejectedValue(new Error('cache service is down'))

    expect((await restoreCache()).restored).toBe(false)
    expect(core.warning).toHaveBeenCalledWith(
      expect.stringContaining('cache service is down'),
    )
  })
})

// ROCQ_VERSION is read from the input once, when constants.ts is first
// imported, so exercising another version means loading cache.ts afresh.
async function loadCacheFor(rocqVersion: string) {
  jest.resetModules()
  jest.unstable_mockModule('@actions/core', () => core)
  jest.unstable_mockModule('@actions/cache', () => mockCache)
  jest.unstable_mockModule('../src/opam.js', () => ({
    opamClean: mockOpamClean,
    opamPin: jest.fn(),
    opamInstall: jest.fn(),
    opamInstalledVersion: jest.fn(),
    configureDune: jest.fn(),
    setupOpamEnv: jest.fn(),
  }))
  jest.unstable_mockModule('../src/constants.js', () => ({
    ...realConstants,
    ROCQ_VERSION: rocqVersion,
    IS_LINUX: false,
    DUNE_CACHE_ROOT: duneCacheRoot,
  }))
  core.getInput.mockImplementation((name: string) => {
    if (name === 'rocq-version') return rocqVersion
    if (name === 'cache-key-opam-files') return emptyOpamGlob
    return ''
  })
  mockCacheRestore.mockResolvedValue(undefined)
  mockCache.isFeatureAvailable.mockReturnValue(true)
  return import('../src/cache.js')
}

describe('weekly cache key', () => {
  afterEach(() => {
    jest.resetAllMocks()
  })

  // Two runs in the same week must share a key, and a run in the next week
  // must not, or "weekly" would keep serving last week's Rocq.
  it('dates the key to the current Monday', async () => {
    const { restoreCache: restore } = await loadCacheFor('weekly')

    await restore()

    const [, cacheKey] = mockCacheRestore.mock.calls[0]
    expect(cacheKey).toMatch(/-rocq-weekly-\d{4}-\d{2}-\d{2}-/)
  })

  it('caches the cloned rocq repositories alongside the opam root', async () => {
    const { restoreCache: restore } = await loadCacheFor('weekly')

    await restore()

    const [paths] = mockCacheRestore.mock.calls[0]
    expect(paths).toContain(path.join(os.homedir(), 'rocq-weekly'))
  })

  it('does not cache the weekly clones for a stable version', async () => {
    const { restoreCache: restore } = await loadCacheFor('latest')

    await restore()

    const [paths] = mockCacheRestore.mock.calls[0]
    expect(paths).not.toContain(path.join(os.homedir(), 'rocq-weekly'))
  })
})

describe('shouldSaveCache', () => {
  const savedEvent = process.env.GITHUB_EVENT_NAME

  // `save-if` is the only input these read; everything else falls through to ''.
  function withSaveIf(value: string): void {
    core.getInput.mockImplementation((name: string) => {
      if (name === 'save-if') {
        return value
      }
      return ''
    })
  }

  afterEach(() => {
    if (savedEvent === undefined) {
      delete process.env.GITHUB_EVENT_NAME
    } else {
      process.env.GITHUB_EVENT_NAME = savedEvent
    }
  })

  it('never saves when save-if is false', () => {
    withSaveIf('false')
    process.env.GITHUB_EVENT_NAME = 'push'

    expect(shouldSaveCache()).toBe(false)
  })

  it('saves on a pull request when save-if is true', () => {
    withSaveIf('true')
    process.env.GITHUB_EVENT_NAME = 'pull_request'

    expect(shouldSaveCache()).toBe(true)
  })

  it('does not save on a pull request under auto', () => {
    withSaveIf('auto')
    process.env.GITHUB_EVENT_NAME = 'pull_request'

    expect(shouldSaveCache()).toBe(false)
  })

  it('does not save on a pull_request_target under auto', () => {
    withSaveIf('auto')
    process.env.GITHUB_EVENT_NAME = 'pull_request_target'

    expect(shouldSaveCache()).toBe(false)
  })

  it('saves on a push under auto', () => {
    withSaveIf('auto')
    process.env.GITHUB_EVENT_NAME = 'push'

    expect(shouldSaveCache()).toBe(true)
  })

  it('defaults to auto when the input is unset', () => {
    withSaveIf('')
    process.env.GITHUB_EVENT_NAME = 'pull_request'

    expect(shouldSaveCache()).toBe(false)
  })

  it('warns and falls back to auto on an unrecognized value', () => {
    withSaveIf('sometimes')
    process.env.GITHUB_EVENT_NAME = 'pull_request'

    expect(shouldSaveCache()).toBe(false)
    expect(core.warning).toHaveBeenCalledWith(
      expect.stringContaining('Unrecognized save-if value'),
    )
  })
})

describe('stripBinaryAnnotations', () => {
  let opamRoot: string
  let pkgDir: string

  beforeEach(async () => {
    // The root is passed in explicitly rather than derived from HOME:
    // os.homedir() does not always follow a reassigned process.env.HOME,
    // and this function deletes files, so it must never be aimed by
    // ambient state.
    opamRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'rocq-strip-'))
    pkgDir = path.join(opamRoot, 'default', 'lib', 'pkg')
    await fs.mkdir(pkgDir, { recursive: true })
  })

  afterEach(async () => {
    await fs.rm(opamRoot, { recursive: true, force: true })
  })

  async function write(name: string): Promise<string> {
    const file = path.join(pkgDir, name)
    await fs.writeFile(file, 'x'.repeat(64))
    return file
  }

  it('removes .cmt and .cmti but leaves build artifacts alone', async () => {
    const cmt = await write('a.cmt')
    const cmti = await write('a.cmti')
    const cmx = await write('a.cmx')
    const cmi = await write('a.cmi')
    const cmxs = await write('a.cmxs')
    const vo = await write('a.vo')

    core.getInput.mockImplementation(() => '')
    await stripBinaryAnnotations(opamRoot)

    await expect(fs.access(cmt)).rejects.toThrow()
    await expect(fs.access(cmti)).rejects.toThrow()
    await expect(fs.access(cmx)).resolves.toBeUndefined()
    await expect(fs.access(cmi)).resolves.toBeUndefined()
    await expect(fs.access(cmxs)).resolves.toBeUndefined()
    await expect(fs.access(vo)).resolves.toBeUndefined()
  })

  it('keeps annotations when strip-binary-annotations is false', async () => {
    const cmt = await write('a.cmt')

    core.getInput.mockImplementation((name: string) =>
      name === 'strip-binary-annotations' ? 'false' : '',
    )
    await stripBinaryAnnotations(opamRoot)

    await expect(fs.access(cmt)).resolves.toBeUndefined()
  })
})
