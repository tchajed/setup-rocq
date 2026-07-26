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

const mockExec = jest.fn<(cmd: string, args?: string[]) => Promise<number>>()
const mockGetExecOutput =
  jest.fn<
    (
      cmd: string,
      args?: string[],
    ) => Promise<{ exitCode: number; stdout: string; stderr: string }>
  >()

jest.unstable_mockModule('@actions/core', () => core)
jest.unstable_mockModule('../src/opam.js', () => mockOpam)
jest.unstable_mockModule('@actions/exec', () => ({
  exec: mockExec,
  getExecOutput: mockGetExecOutput,
}))

core.group.mockImplementation(
  async (_name: string, fn: () => Promise<void>) => {
    await fn()
  },
)

const { installRocq, compareDottedVersions, getInstalledRocqVersion } =
  await import('../src/rocq.js')

describe('rocq.ts', () => {
  beforeEach(() => {
    mockOpamInstall.mockResolvedValue(undefined)
    mockOpamInstalledVersion.mockResolvedValue(null)
    mockOpamPin.mockResolvedValue(undefined)
    mockConfigureDune.mockResolvedValue(undefined)
    mockSetupOpamEnv.mockResolvedValue(undefined)
    mockExec.mockResolvedValue(0)
    mockGetExecOutput.mockResolvedValue({
      exitCode: 0,
      stdout: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef\n',
      stderr: '',
    })
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

  // The bug this guards: rocq-stdlib.dev was left unpinned while
  // coq-stdlib.dev was pinned to Monday's commit, so the weekly switch
  // took its library from the dev repo's moving branch instead of the
  // commit the run reported, and opam could mark it dirty on any sync.
  it('pins every weekly dev package to a commit, including rocq-stdlib', async () => {
    await installRocq('weekly')

    const stdlibTarget = `git+file://${path.join(os.homedir(), 'rocq-weekly', 'stdlib')}#deadbeefdeadbeefdeadbeefdeadbeefdeadbeef`
    expect(mockOpamPin).toHaveBeenCalledWith('rocq-stdlib.dev', stdlibTarget)
    expect(mockOpamPin).toHaveBeenCalledWith('coq-stdlib.dev', stdlibTarget)

    const rocqTarget = `git+file://${path.join(os.homedir(), 'rocq-weekly', 'rocq')}#deadbeefdeadbeefdeadbeefdeadbeefdeadbeef`
    for (const pkg of [
      'rocq-runtime.dev',
      'rocq-core.dev',
      'coqide-server.dev',
      'coq-core.dev',
    ]) {
      expect(mockOpamPin).toHaveBeenCalledWith(pkg, rocqTarget)
    }
  })

  it('pins rocq-stdlib alongside coq-stdlib for the dev version', async () => {
    await installRocq('dev')

    expect(mockOpamPin).toHaveBeenCalledWith(
      'rocq-stdlib.dev',
      'git+https://github.com/rocq-prover/stdlib.git',
    )
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

describe('getInstalledRocqVersion', () => {
  afterEach(() => {
    jest.resetAllMocks()
  })

  it('reads the version from rocq-core', async () => {
    mockOpamInstalledVersion.mockImplementation(async (pkg) =>
      pkg === 'rocq-core' ? '9.1.0' : null,
    )

    expect(await getInstalledRocqVersion()).toBe('9.1.0')
  })

  // The 8.x line and the dev/weekly pins install the coq metapackage, which
  // carries the release number when rocq-core is absent.
  it('falls back to coq when rocq-core is absent', async () => {
    mockOpamInstalledVersion.mockImplementation(async (pkg) =>
      pkg === 'coq' ? '8.20.1' : null,
    )

    expect(await getInstalledRocqVersion()).toBe('8.20.1')
  })

  it('prefers rocq-core over the compat metapackages', async () => {
    mockOpamInstalledVersion.mockImplementation(async (pkg) =>
      pkg === 'rocq-core' ? '9.1.0' : '8.20.1',
    )

    expect(await getInstalledRocqVersion()).toBe('9.1.0')
  })

  it('returns null when no Rocq package is installed', async () => {
    mockOpamInstalledVersion.mockResolvedValue(null)

    expect(await getInstalledRocqVersion()).toBeNull()
  })
})

describe('configureDune ordering', () => {
  beforeEach(() => {
    // resetAllMocks() in earlier suites drops these
    core.group.mockImplementation(
      async (_name: string, fn: () => Promise<void>) => {
        await fn()
      },
    )
    core.getInput.mockImplementation((name: string) =>
      name === 'cache-key-opam-files'
        ? path.join(os.tmpdir(), 'setup-rocq-empty', '*.opam')
        : '',
    )
  })

  afterEach(() => {
    jest.resetAllMocks()
  })

  // Rocq is itself a dune project, so the cache-enabled config has to exist
  // before anything is built or the Rocq build populates nothing.
  it('configures dune before installing anything', async () => {
    const order: string[] = []
    mockConfigureDune.mockImplementation(async () => {
      order.push('configureDune')
    })
    mockOpamInstall.mockImplementation(async () => {
      order.push('opamInstall')
    })
    mockOpamInstalledVersion.mockResolvedValue(null)

    await installRocq('latest')

    expect(order[0]).toBe('configureDune')
  })
})
