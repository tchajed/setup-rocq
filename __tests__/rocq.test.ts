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
const mockOpamInstalledVersion =
  jest.fn<(pkg: string) => Promise<string | null>>()
const mockOpam = {
  opamInstall: mockOpamInstall,
  opamPin: mockOpamPin,
  opamInstalledVersion: mockOpamInstalledVersion,
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

const { installRocq, compareDottedVersions } = await import('../src/rocq.js')

describe('rocq.ts', () => {
  beforeEach(() => {
    mockOpamInstall.mockResolvedValue(undefined)
    mockOpamInstalledVersion.mockResolvedValue(null)
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
    expect(mockOpamInstall).toHaveBeenNthCalledWith(
      2,
      ['coq.dev'],
      ['--unset-root'],
    )
    expect(mockConfigureDune).toHaveBeenCalled()
    expect(mockSetupOpamEnv).toHaveBeenCalled()
  })

  it('installs latest via rocq-core and rocq-stdlib', async () => {
    await installRocq('latest')

    expect(mockOpamInstall).toHaveBeenNthCalledWith(
      2,
      ['rocq-core', 'rocq-stdlib'],
      ['--unset-root'],
    )
  })

  it('installs specific 9.x versions via rocq-core with unconstrained rocq-stdlib', async () => {
    await installRocq('9.2.0')

    expect(mockOpamInstall).toHaveBeenNthCalledWith(
      2,
      ['rocq-core.9.2.0', 'rocq-stdlib'],
      ['--unset-root'],
    )
  })

  it('installs specific 8.x versions via the coq package', async () => {
    await installRocq('8.20.1')

    expect(mockOpamInstall).toHaveBeenNthCalledWith(2, 'coq.8.20.1', [
      '--unset-root',
    ])
  })

  describe('dune', () => {
    it('installs the pinned version when dune is not installed', async () => {
      mockOpamInstalledVersion.mockResolvedValue(null)

      await installRocq('latest')

      expect(mockOpamInstall).toHaveBeenNthCalledWith(1, 'dune.3.22.1')
    })

    // The bug this guards: a restored cache whose switch the project's own
    // `opam install` already moved to a newer dune.  Requesting the pinned
    // version there is a downgrade, which recompiles all of Rocq twice per
    // run and uninstalls packages that require the newer dune.
    it('keeps a newer dune from a restored cache', async () => {
      mockOpamInstalledVersion.mockResolvedValue('3.23.1')

      await installRocq('latest')

      expect(mockOpamInstall).not.toHaveBeenCalledWith('dune.3.22.1')
      expect(mockOpamInstall).toHaveBeenNthCalledWith(
        1,
        ['rocq-core', 'rocq-stdlib'],
        ['--unset-root'],
      )
    })

    it('keeps dune when it is exactly the pinned version', async () => {
      mockOpamInstalledVersion.mockResolvedValue('3.22.1')

      await installRocq('latest')

      expect(mockOpamInstall).not.toHaveBeenCalledWith('dune.3.22.1')
    })

    it('upgrades an older dune to the pinned version', async () => {
      mockOpamInstalledVersion.mockResolvedValue('3.19.0')

      await installRocq('latest')

      expect(mockOpamInstall).toHaveBeenNthCalledWith(1, 'dune.3.22.1')
    })

    it('installs the pinned version when the installed version is unparsable', async () => {
      mockOpamInstalledVersion.mockResolvedValue('3.23.1+beta')

      await installRocq('latest')

      expect(mockOpamInstall).toHaveBeenNthCalledWith(1, 'dune.3.22.1')
    })
  })

  describe('compareDottedVersions', () => {
    it('orders by numeric component, not lexicographically', () => {
      // '3.9.0' > '3.10.0' as strings
      expect(compareDottedVersions('3.9.0', '3.10.0')).toBeLessThan(0)
      expect(compareDottedVersions('3.23.1', '3.22.1')).toBeGreaterThan(0)
      expect(compareDottedVersions('3.22.1', '3.22.1')).toBe(0)
    })

    it('treats a missing component as zero', () => {
      expect(compareDottedVersions('3.22', '3.22.0')).toBe(0)
      expect(compareDottedVersions('3.22', '3.22.1')).toBeLessThan(0)
    })

    it('returns null for a version it cannot parse', () => {
      expect(compareDottedVersions('3.22.1+dev', '3.22.1')).toBeNull()
      expect(compareDottedVersions('3.22.1', 'dev')).toBeNull()
    })
  })
})
