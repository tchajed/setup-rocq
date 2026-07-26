import { jest } from '@jest/globals'
import * as fs from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import * as core from '../__fixtures__/core.js'

jest.unstable_mockModule('@actions/core', () => core)

const { getPinnedRocqPackages, getPinnedRocqInstallPackages } =
  await import('../src/rocq-pin.js')

describe('rocq-pin.ts', () => {
  beforeEach(() => {
    core.getInput.mockImplementation((name: string) => {
      if (name === 'cache-key-opam-files') {
        return path.join(os.tmpdir(), 'setup-rocq-empty', '*.opam')
      }
      return ''
    })
  })

  afterEach(() => {
    jest.resetAllMocks()
  })

  it('finds Rocq pin-depends entries in opam files', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'rocq-pin-'))
    const opamFile = path.join(tempDir, 'project.opam')
    await fs.writeFile(
      opamFile,
      `opam-version: "2.0"
pin-depends: [
  ["coq.dev" "git+https://github.com/example/rocq.git#feature"]
  ["zarith" "git+https://github.com/example/zarith.git#feature"]
]
`,
    )

    core.getInput.mockImplementation((name: string) => {
      if (name === 'cache-key-opam-files') {
        return opamFile
      }
      return ''
    })

    await expect(getPinnedRocqPackages()).resolves.toEqual([
      {
        pkg: 'coq.dev',
        target: 'git+https://github.com/example/rocq.git#feature',
      },
    ])
  })

  it('finds rocq-* pin-depends entries in opam files', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'rocq-pin-'))
    const opamFile = path.join(tempDir, 'project.opam')
    await fs.writeFile(
      opamFile,
      `opam-version: "2.0"
pin-depends: [
  ["rocq-core.dev" "git+https://github.com/example/rocq.git#feature"]
  ["rocq-stdlib.dev" "git+https://github.com/example/stdlib.git#feature"]
  ["zarith" "git+https://github.com/example/zarith.git#feature"]
]
`,
    )

    core.getInput.mockImplementation((name: string) => {
      if (name === 'cache-key-opam-files') {
        return opamFile
      }
      return ''
    })

    await expect(getPinnedRocqPackages()).resolves.toEqual([
      {
        pkg: 'rocq-core.dev',
        target: 'git+https://github.com/example/rocq.git#feature',
      },
      {
        pkg: 'rocq-stdlib.dev',
        target: 'git+https://github.com/example/stdlib.git#feature',
      },
    ])
  })

  it('prefers coq.dev when choosing pinned Rocq packages to install', () => {
    expect(
      getPinnedRocqInstallPackages([
        { pkg: 'coq.dev', target: 'git+https://example.com/rocq.git#main' },
        {
          pkg: 'rocq-runtime.dev',
          target: 'git+https://example.com/rocq.git#main',
        },
      ]),
    ).toEqual(['coq.dev'])
  })

  it('installs all pins when rocq-core is pinned without coq', () => {
    expect(
      getPinnedRocqInstallPackages([
        {
          pkg: 'rocq-core.dev',
          target: 'git+https://example.com/rocq.git#main',
        },
        {
          pkg: 'rocq-stdlib.dev',
          target: 'git+https://example.com/stdlib.git#main',
        },
      ]),
    ).toEqual(['rocq-core.dev', 'rocq-stdlib.dev'])
  })

  it('throws for multiple pins without coq or rocq-core', () => {
    expect(() =>
      getPinnedRocqInstallPackages([
        {
          pkg: 'rocq-runtime.dev',
          target: 'git+https://example.com/rocq.git#main',
        },
        {
          pkg: 'rocq-stdlib.dev',
          target: 'git+https://example.com/stdlib.git#main',
        },
      ]),
    ).toThrow(/could not determine which package to install/)
  })
})

describe('Rocq package recognition', () => {
  async function pinsFrom(pinDepends: string) {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'rocq-pin-'))
    const opamFile = path.join(tempDir, 'project.opam')
    await fs.writeFile(
      opamFile,
      `opam-version: "2.0"\npin-depends: [\n${pinDepends}\n]\n`,
    )
    core.getInput.mockImplementation((name: string) =>
      name === 'cache-key-opam-files' ? opamFile : '',
    )
    return getPinnedRocqPackages()
  }

  afterEach(() => {
    jest.resetAllMocks()
  })

  // These ship from the Rocq source tree and name a Rocq release, but were
  // dropped by a pattern that only knew coq and the rocq-* names.
  it.each(['coq-core.dev', 'coq-stdlib.dev', 'coqide-server.dev'])(
    'recognizes the compat package %s',
    async (pkg) => {
      const url = 'git+https://github.com/rocq-prover/rocq.git#main'
      const pins = await pinsFrom(`  ["${pkg}" "${url}"]`)
      expect(pins).toEqual([{ pkg, target: url }])
    },
  )

  it('recognizes the rocq-prover metapackage', async () => {
    const url = 'git+https://github.com/rocq-prover/rocq.git#main'
    const pins = await pinsFrom(`  ["rocq-prover.dev" "${url}"]`)
    expect(pins).toEqual([{ pkg: 'rocq-prover.dev', target: url }])
  })

  // A "starts with coq" test would sweep these in and install a library in
  // place of the Rocq compiler.
  it.each(['coq-mathcomp-ssreflect', 'coq-iris.dev', 'rocq-elpi.dev'])(
    'does not treat the library %s as a Rocq release',
    async (pkg) => {
      const pins = await pinsFrom(
        `  ["${pkg}" "git+https://example.com/x#main"]`,
      )
      expect(pins).toEqual([])
    },
  )

  it('installs the rocq-prover metapackage in preference to its parts', () => {
    const target = 'git+https://github.com/rocq-prover/rocq.git#main'
    expect(
      getPinnedRocqInstallPackages([
        { pkg: 'rocq-core.dev', target },
        { pkg: 'rocq-prover.dev', target },
        { pkg: 'rocq-runtime.dev', target },
      ]),
    ).toEqual(['rocq-prover.dev'])
  })
})
