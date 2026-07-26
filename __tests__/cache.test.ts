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

const { restoreCache, shouldSaveCache, stripBinaryAnnotations } =
  await import('../src/cache.js')

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

it('uses rocq-* package pins in the cache key', async () => {
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
  expect(cacheKey).toContain('-rocq-pinned-')
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
