import { jest } from '@jest/globals'
import * as fs from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import * as core from '../__fixtures__/core.js'

jest.unstable_mockModule('@actions/core', () => core)

const { getPinnedRocqPackages, getPinnedRocqInstallPackage } =
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

  it('prefers coq.dev when choosing a pinned Rocq package to install', () => {
    expect(
      getPinnedRocqInstallPackage([
        { pkg: 'coq.dev', target: 'git+https://example.com/rocq.git#main' },
        {
          pkg: 'rocq-runtime.dev',
          target: 'git+https://example.com/rocq.git#main',
        },
      ]),
    ).toBe('coq.dev')
  })
})
