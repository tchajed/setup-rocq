import { jest } from '@jest/globals'
import * as fs from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import * as core from '../__fixtures__/core.js'

const mockOpamInstall =
  jest.fn<(pkg: string, options?: string[]) => Promise<void>>()
const mockOpamPin =
  jest.fn<(pkg: string, target: string, options?: string[]) => Promise<void>>()
const mockConfigureDune = jest.fn<() => Promise<void>>()
const mockSetupOpamEnv = jest.fn<() => Promise<void>>()
const mockOpam = {
  opamInstall: mockOpamInstall,
  opamPin: mockOpamPin,
  configureDune: mockConfigureDune,
  setupOpamEnv: mockSetupOpamEnv,
}

jest.unstable_mockModule('@actions/core', () => core)
jest.unstable_mockModule('../src/opam.js', () => mockOpam)

core.group.mockImplementation(
  async (_name: string, fn: () => Promise<void>) => {
    await fn()
  },
)

const { installRocq } = await import('../src/rocq.js')

describe('rocq.ts', () => {
  beforeEach(() => {
    mockOpamInstall.mockResolvedValue(undefined)
    mockOpamPin.mockResolvedValue(undefined)
    mockConfigureDune.mockResolvedValue(undefined)
    mockSetupOpamEnv.mockResolvedValue(undefined)
    core.getInput.mockImplementation((name: string) => {
      if (name === 'cache-key-opam-files') {
        return path.join(os.tmpdir(), 'setup-rocq-empty', '*.opam')
      }
      return ''
    })
  })

  afterEach(() => {
    jest.resetAllMocks()
    core.group.mockImplementation(
      async (_name: string, fn: () => Promise<void>) => {
        await fn()
      },
    )
  })

  it('installs pinned Rocq packages from project opam files', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'rocq-install-'))
    const opamFile = path.join(tempDir, 'project.opam')
    await fs.writeFile(
      opamFile,
      `opam-version: "2.0"
pin-depends: [
  ["coq.dev" "git+https://github.com/example/rocq.git#custom"]
]
`,
    )

    core.getInput.mockImplementation((name: string) => {
      if (name === 'cache-key-opam-files') {
        return opamFile
      }
      return ''
    })

    await installRocq('latest')

    expect(mockOpamInstall).toHaveBeenNthCalledWith(1, 'dune.3.22.1')
    expect(mockOpamPin).toHaveBeenCalledWith(
      'coq.dev',
      'git+https://github.com/example/rocq.git#custom',
    )
    expect(mockOpamInstall).toHaveBeenNthCalledWith(2, 'coq.dev', [
      '--unset-root',
    ])
    expect(mockConfigureDune).toHaveBeenCalled()
    expect(mockSetupOpamEnv).toHaveBeenCalled()
  })
})
